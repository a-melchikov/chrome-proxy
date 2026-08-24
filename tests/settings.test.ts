import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_PROXY_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  saveSettings,
  updateSettings,
  validateSettings,
  type ProxySettingsV1,
} from '../src/storage/settings';

const validSettings: ProxySettingsV1 = {
  version: 1,
  proxyInput: 'fixture-user:fixture-pass@proxy.test:8080',
  enabled: true,
  routingMode: 'bypass',
  rulesText: 'EXAMPLE.COM\n*.example.com\n192.168.1.123/24',
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe('settings validation', () => {
  it('accepts defaults', () => {
    expect(validateSettings(DEFAULT_PROXY_SETTINGS)).toEqual({
      ok: true,
      value: DEFAULT_PROXY_SETTINGS,
    });
  });

  it('normalizes valid rule text', () => {
    const result = validateSettings(validSettings);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.rulesText).toBe('example.com\n192.168.1.0/24');
    }
  });

  it('rejects enabling without a proxy configuration', () => {
    const result = validateSettings({
      ...DEFAULT_PROXY_SETTINGS,
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_SETTINGS',
        message: 'Proxy cannot be enabled without a valid proxy configuration.',
      },
    });
  });
});

describe('settings repository', () => {
  it('returns independent defaults when storage is empty', async () => {
    const first = await loadSettings();
    first.routingMode = 'allowlist';

    expect(await loadSettings()).toEqual(DEFAULT_PROXY_SETTINGS);
  });

  it('roundtrips settings under the single settings key', async () => {
    const saved = await saveSettings(validSettings);
    const stored = await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY);

    expect(saved.rulesText).toBe('example.com\n192.168.1.0/24');
    expect(stored).toEqual({ [SETTINGS_STORAGE_KEY]: saved });
    expect(await loadSettings()).toEqual(saved);
  });

  it('updates settings from the current persisted value', async () => {
    await saveSettings(validSettings);

    const updated = await updateSettings({
      enabled: false,
      routingMode: 'allowlist',
    });

    expect(updated).toMatchObject({
      enabled: false,
      routingMode: 'allowlist',
      proxyInput: validSettings.proxyInput,
    });
    expect(await loadSettings()).toEqual(updated);
  });

  it.each([
    null,
    { version: 1, enabled: true },
    { ...DEFAULT_PROXY_SETTINGS, enabled: 'yes' },
    { ...DEFAULT_PROXY_SETTINGS, version: 2 },
  ])('falls back to defaults for malformed stored shape', async (stored) => {
    await fakeBrowser.storage.local.set({ [SETTINGS_STORAGE_KEY]: stored });

    expect(await loadSettings()).toEqual(DEFAULT_PROXY_SETTINGS);
  });

  it('falls back to defaults for an invalid routing mode', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: {
        ...DEFAULT_PROXY_SETTINGS,
        enabled: true,
        proxyInput: validSettings.proxyInput,
        routingMode: 'unexpected',
      },
    });

    expect(await loadSettings()).toEqual(DEFAULT_PROXY_SETTINGS);
  });

  it('does not load a corrupted enabled proxy configuration', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: {
        ...DEFAULT_PROXY_SETTINGS,
        enabled: true,
        proxyInput: 'not-a-proxy',
      },
    });

    expect(await loadSettings()).toEqual(DEFAULT_PROXY_SETTINGS);
  });
});
