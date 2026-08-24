import { describe, expect, it } from 'vitest';
import {
  buildAllProxyConfig,
  buildBypassList,
  buildBypassProxyConfig,
  buildDesiredProxyState,
} from '../src/proxy/config';
import type { ParsedProxy } from '../src/proxy/parser';
import { getAllowlistWarnings } from '../src/proxy/warnings';
import type { Rule } from '../src/rules/parser';
import type { ProxySettingsV1 } from '../src/storage/settings';

const proxy: ParsedProxy = {
  username: 'fixture-user',
  password: 'fixture-pass',
  host: 'proxy.example.test',
  port: 8080,
  scheme: 'http',
};

describe('fixed server configuration', () => {
  it('builds the exact all-sites config without fallback or credentials', () => {
    const config = buildAllProxyConfig(proxy);

    expect(config).toEqual({
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: 'http',
          host: 'proxy.example.test',
          port: 8080,
        },
      },
    });
    expect(JSON.stringify(config)).not.toContain('fixture-user');
    expect(JSON.stringify(config)).not.toContain('fixture-pass');
    expect(JSON.stringify(config)).not.toContain('fallbackProxy');
    expect(JSON.stringify(config)).not.toContain('DIRECT');
  });

  it('expands and deduplicates bypass entries', () => {
    const rules: Rule[] = [
      { type: 'hostname', value: 'example.com' },
      { type: 'hostname', value: 'example.com' },
      { type: 'ipv4', value: '10.0.0.1' },
      { type: 'cidr', network: '192.168.0.0', prefix: 16 },
    ];

    expect(buildBypassList(rules)).toEqual([
      'example.com',
      '*.example.com',
      '10.0.0.1',
      '192.168.0.0/16',
    ]);

    const config = buildBypassProxyConfig(proxy, rules);

    expect(config).toEqual({
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: 'http',
          host: 'proxy.example.test',
          port: 8080,
        },
        bypassList: [
          'example.com',
          '*.example.com',
          '10.0.0.1',
          '192.168.0.0/16',
        ],
      },
    });
    expect(config.rules.bypassList).not.toContain('<-loopback>');
  });

  it('allows an empty bypass list', () => {
    expect(buildBypassProxyConfig(proxy, []).rules.bypassList).toEqual([]);
  });
});

describe('desired proxy state', () => {
  const baseSettings: ProxySettingsV1 = {
    version: 1,
    proxyInput: 'fixture-user:fixture-pass@proxy.example.test:8080',
    enabled: true,
    routingMode: 'all',
    rulesText: '',
  };

  it('returns disabled without trying to repair invalid disabled input', () => {
    expect(
      buildDesiredProxyState({
        ...baseSettings,
        enabled: false,
        proxyInput: 'invalid-disabled-draft',
        rulesText: 'https://invalid.example',
      }),
    ).toEqual({ ok: true, value: { kind: 'disabled' } });
  });

  it.each([
    [
      { ...baseSettings, proxyInput: 'not-a-proxy' },
      'INVALID_PROXY_FORMAT',
    ],
    [
      { ...baseSettings, rulesText: 'https://invalid.example' },
      'INVALID_RULE',
    ],
  ] as const)('fails closed for invalid enabled settings', (settings, code) => {
    const result = buildDesiredProxyState(settings);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe(code);
    }
  });

  it('includes loopback warnings only for allowlist mode', () => {
    const result = buildDesiredProxyState({
      ...baseSettings,
      routingMode: 'allowlist',
      rulesText: 'localhost\n127.1.2.3\n169.254.20.1\nexample.com',
    });

    expect(result.ok).toBe(true);

    if (result.ok && result.value.kind === 'configured') {
      expect(result.value.warnings.map((warning) => warning.rule)).toEqual([
        'localhost',
        '127.1.2.3',
        '169.254.20.1',
      ]);
    }
  });
});

describe('loopback warning metadata', () => {
  it('detects localhost and overlapping loopback/link-local networks', () => {
    const warnings = getAllowlistWarnings([
      { type: 'hostname', value: 'localhost' },
      { type: 'ipv4', value: '127.255.1.2' },
      { type: 'ipv4', value: '169.254.30.40' },
      { type: 'cidr', network: '126.0.0.0', prefix: 7 },
      { type: 'cidr', network: '169.254.8.0', prefix: 24 },
      { type: 'hostname', value: 'example.com' },
      { type: 'ipv4', value: '192.168.1.1' },
    ]);

    expect(warnings.map((warning) => warning.rule)).toEqual([
      'localhost',
      '127.255.1.2',
      '169.254.30.40',
      '126.0.0.0/7',
      '169.254.8.0/24',
    ]);
    expect(warnings.every((warning) => warning.code === 'IMPLICIT_LOOPBACK_BYPASS')).toBe(
      true,
    );
  });
});
