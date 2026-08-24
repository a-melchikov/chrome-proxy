import { failure, success, type Result } from './errors';
import { generateAllowlistPac } from './pac';
import { parseProxyInput, type ParsedProxy } from './parser';
import {
  getAllowlistWarnings,
  type ProxyConfigWarning,
} from './warnings';
import { normalizeRules } from '../rules/normalizer';
import type { Rule } from '../rules/parser';
import type { ProxySettingsV1 } from '../storage/settings';

export interface HttpProxyServer {
  scheme: 'http';
  host: string;
  port: number;
}

export interface AllProxyConfig {
  mode: 'fixed_servers';
  rules: {
    singleProxy: HttpProxyServer;
  };
}

export interface BypassProxyConfig {
  mode: 'fixed_servers';
  rules: {
    singleProxy: HttpProxyServer;
    bypassList: string[];
  };
}

export interface AllowlistProxyConfig {
  mode: 'pac_script';
  pacScript: {
    data: string;
    mandatory: true;
  };
}

export type ProxyConfig =
  | AllProxyConfig
  | BypassProxyConfig
  | AllowlistProxyConfig;

export type DesiredProxyState =
  | { kind: 'disabled' }
  | {
      kind: 'configured';
      config: ProxyConfig;
      parsedProxy: ParsedProxy;
      warnings: ProxyConfigWarning[];
    };

export function buildAllProxyConfig(proxy: ParsedProxy): AllProxyConfig {
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: buildProxyServer(proxy),
    },
  };
}

export function buildBypassProxyConfig(
  proxy: ParsedProxy,
  rules: readonly Rule[],
): BypassProxyConfig {
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: buildProxyServer(proxy),
      bypassList: buildBypassList(rules),
    },
  };
}

export function buildAllowlistProxyConfig(
  proxy: ParsedProxy,
  rules: readonly Rule[],
): AllowlistProxyConfig {
  return {
    mode: 'pac_script',
    pacScript: {
      data: generateAllowlistPac(proxy, rules),
      mandatory: true,
    },
  };
}

export function buildBypassList(rules: readonly Rule[]): string[] {
  const entries = new Set<string>();

  for (const rule of rules) {
    switch (rule.type) {
      case 'hostname':
        entries.add(rule.value);
        entries.add(`*.${rule.value}`);
        break;
      case 'ipv4':
        entries.add(rule.value);
        break;
      case 'cidr':
        entries.add(`${rule.network}/${rule.prefix}`);
        break;
    }
  }

  return [...entries];
}

export function buildDesiredProxyState(
  settings: ProxySettingsV1,
): Result<DesiredProxyState> {
  if (!settings.enabled) {
    return success({ kind: 'disabled' });
  }

  const parsedProxy = parseProxyInput(settings.proxyInput);

  if (!parsedProxy.ok) {
    return parsedProxy;
  }

  const normalizedRules = normalizeRules(settings.rulesText);

  if (!normalizedRules.ok) {
    return normalizedRules;
  }

  const { rules } = normalizedRules.value;
  let config: ProxyConfig;
  let warnings: ProxyConfigWarning[] = [];

  switch (settings.routingMode) {
    case 'all':
      config = buildAllProxyConfig(parsedProxy.value);
      break;
    case 'bypass':
      config = buildBypassProxyConfig(parsedProxy.value, rules);
      break;
    case 'allowlist':
      config = buildAllowlistProxyConfig(parsedProxy.value, rules);
      warnings = getAllowlistWarnings(rules);
      break;
    default:
      return failure('INVALID_SETTINGS', 'Proxy routing mode is invalid.');
  }

  return success({
    kind: 'configured',
    config,
    parsedProxy: parsedProxy.value,
    warnings,
  });
}

function buildProxyServer(proxy: ParsedProxy): HttpProxyServer {
  return {
    scheme: 'http',
    host: proxy.host,
    port: proxy.port,
  };
}
