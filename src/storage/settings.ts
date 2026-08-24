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

export interface SettingsRepository {
  load(): Promise<Result<ProxySettingsV1>>;
  save(settings: ProxySettingsV1): Promise<Result<ProxySettingsV1>>;
}

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
  const loaded = await loadSettingsResult();

  return loaded.ok ? loaded.value : createDefaultSettings();
}

export async function saveSettings(
  settings: ProxySettingsV1,
): Promise<ProxySettingsV1> {
  const saved = await saveSettingsResult(settings);

  if (!saved.ok) {
    throw new AppValidationError(saved.error);
  }

  return saved.value;
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

export function createBrowserSettingsRepository(): SettingsRepository {
  return {
    load: loadSettingsResult,
    save: saveSettingsResult,
  };
}

export async function loadSettingsResult(): Promise<Result<ProxySettingsV1>> {
  let stored: Record<string, unknown>;

  try {
    stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  } catch {
    return failure(
      'SETTINGS_LOAD_FAILED',
      'Chrome failed to load proxy settings.',
    );
  }

  const value = stored[SETTINGS_STORAGE_KEY];

  return value === undefined
    ? success(createDefaultSettings())
    : validateSettings(value);
}

export async function saveSettingsResult(
  settings: ProxySettingsV1,
): Promise<Result<ProxySettingsV1>> {
  const validated = validateSettings(settings);

  if (!validated.ok) {
    return validated;
  }

  try {
    await browser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: validated.value,
    });
  } catch {
    return failure(
      'SETTINGS_SAVE_FAILED',
      'Chrome failed to save proxy settings.',
    );
  }

  return validated;
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
