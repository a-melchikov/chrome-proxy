import { browser } from 'wxt/browser';
import {
  AppValidationError,
  failure,
  success,
  type Result,
} from '../proxy/errors';
import { parseProxyInput } from '../proxy/parser';
import { normalizeRules } from '../rules/normalizer';

export type RoutingMode = 'all' | 'bypass' | 'allowlist';

export interface ProxySettingsV1 {
  version: 1;
  proxyInput: string;
  enabled: boolean;
  routingMode: RoutingMode;
  rulesText: string;
}

export type ProxySettingsUpdate = Partial<
  Omit<ProxySettingsV1, 'version'>
>;

export const SETTINGS_STORAGE_KEY = 'settings';

export const DEFAULT_PROXY_SETTINGS: Readonly<ProxySettingsV1> = Object.freeze({
  version: 1,
  proxyInput: '',
  enabled: false,
  routingMode: 'all',
  rulesText: '',
});

const ROUTING_MODES: readonly RoutingMode[] = [
  'all',
  'bypass',
  'allowlist',
];

export function validateSettings(value: unknown): Result<ProxySettingsV1> {
  if (!isRecord(value)) {
    return invalidSettings();
  }

  const { version, proxyInput, enabled, routingMode, rulesText } = value;

  if (
    version !== 1 ||
    typeof proxyInput !== 'string' ||
    typeof enabled !== 'boolean' ||
    !isRoutingMode(routingMode) ||
    typeof rulesText !== 'string'
  ) {
    return invalidSettings();
  }

  if (proxyInput.length === 0) {
    if (enabled) {
      return invalidSettings(
        'Proxy cannot be enabled without a valid proxy configuration.',
      );
    }
  } else {
    const proxy = parseProxyInput(proxyInput);

    if (!proxy.ok) {
      return proxy;
    }
  }

  const rules = normalizeRules(rulesText);

  if (!rules.ok) {
    return rules;
  }

  return success({
    version: 1,
    proxyInput,
    enabled,
    routingMode,
    rulesText: rules.value.text,
  });
}

export async function loadSettings(): Promise<ProxySettingsV1> {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  const validated = validateSettings(stored[SETTINGS_STORAGE_KEY]);

  return validated.ok ? validated.value : createDefaultSettings();
}

export async function saveSettings(
  settings: ProxySettingsV1,
): Promise<ProxySettingsV1> {
  const validated = validateSettings(settings);

  if (!validated.ok) {
    throw new AppValidationError(validated.error);
  }

  await browser.storage.local.set({
    [SETTINGS_STORAGE_KEY]: validated.value,
  });

  return validated.value;
}

export async function updateSettings(
  update: ProxySettingsUpdate,
): Promise<ProxySettingsV1> {
  const current = await loadSettings();

  return saveSettings({
    ...current,
    ...update,
    version: 1,
  });
}

function createDefaultSettings(): ProxySettingsV1 {
  return { ...DEFAULT_PROXY_SETTINGS };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRoutingMode(value: unknown): value is RoutingMode {
  return (
    typeof value === 'string' &&
    ROUTING_MODES.includes(value as RoutingMode)
  );
}

function invalidSettings(
  message = 'Stored proxy settings are invalid.',
): Result<never> {
  return failure('INVALID_SETTINGS', message);
}
