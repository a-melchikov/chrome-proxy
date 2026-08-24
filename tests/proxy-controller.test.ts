import { describe, expect, it } from 'vitest';
import type {
  BrowserControlLevel,
  ProxySettingsAdapter,
  ProxySettingsChangeListener,
} from '../src/proxy/browser-adapter';
import type { ProxyConfig } from '../src/proxy/config';
import {
  mapControlLevel,
  ProxyController,
} from '../src/proxy/controller';
import type { ProxySettingsV1 } from '../src/storage/settings';

const enabledSettings: ProxySettingsV1 = {
  version: 1,
  proxyInput: 'fixture-user:fixture-pass@proxy.example.test:8080',
  enabled: true,
  routingMode: 'all',
  rulesText: '',
};

describe('proxy control mapping', () => {
  it.each([
    ['controllable_by_this_extension', 'available'],
    ['controlled_by_this_extension', 'owned'],
    ['controlled_by_other_extensions', 'controlled-by-other-extension'],
    ['not_controllable', 'not-controllable'],
  ] as const)('maps %s to %s', (raw, expected) => {
    expect(mapControlLevel(raw)).toBe(expected);
  });
});

describe('ProxyController', () => {
  it.each([
    ['controllable_by_this_extension', 'available'],
    ['controlled_by_this_extension', 'owned'],
  ] as const)('sets config when control is %s', async (level, control) => {
    const adapter = new FakeProxyAdapter(level);
    const controller = new ProxyController(adapter);

    expect(await controller.applyDesiredSettings(enabledSettings)).toEqual({
      ok: true,
      value: { action: 'set', control },
    });
    expect(adapter.setCalls).toEqual([
      {
        mode: 'fixed_servers',
        rules: {
          singleProxy: {
            scheme: 'http',
            host: 'proxy.example.test',
            port: 8080,
          },
        },
      },
    ]);
  });

  it.each([
    [
      'controlled_by_other_extensions',
      'PROXY_CONTROLLED_BY_OTHER_EXTENSION',
    ],
    ['not_controllable', 'PROXY_NOT_CONTROLLABLE'],
  ] as const)('does not set when control is %s', async (level, code) => {
    const adapter = new FakeProxyAdapter(level);
    const controller = new ProxyController(adapter);
    const result = await controller.applyDesiredSettings(enabledSettings);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe(code);
    }

    expect(adapter.setCalls).toEqual([]);
  });

  it('clears regular proxy settings when disabled', async () => {
    const adapter = new FakeProxyAdapter('controlled_by_this_extension');
    const controller = new ProxyController(adapter);

    expect(await controller.disable()).toEqual({
      ok: true,
      value: { action: 'clear', control: 'owned' },
    });
    expect(adapter.clearCalls).toBe(1);
  });

  it('does not mutate Chrome when enabled settings are invalid', async () => {
    const adapter = new FakeProxyAdapter('controllable_by_this_extension');
    const controller = new ProxyController(adapter);
    const result = await controller.applyDesiredSettings({
      ...enabledSettings,
      proxyInput: 'invalid-proxy',
    });

    expect(result.ok).toBe(false);
    expect(adapter.getCalls).toBe(0);
    expect(adapter.setCalls).toEqual([]);
    expect(adapter.clearCalls).toBe(0);
  });

  it('returns safe typed errors when adapter mutations fail', async () => {
    const applyAdapter = new FakeProxyAdapter('controllable_by_this_extension');
    applyAdapter.failSet = true;
    const clearAdapter = new FakeProxyAdapter('controlled_by_this_extension');
    clearAdapter.failClear = true;

    await expect(
      new ProxyController(applyAdapter).applyDesiredSettings(enabledSettings),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROXY_APPLY_FAILED' },
    });
    await expect(new ProxyController(clearAdapter).disable()).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROXY_CLEAR_FAILED' },
    });
  });
});

class FakeProxyAdapter implements ProxySettingsAdapter {
  readonly setCalls: ProxyConfig[] = [];

  clearCalls = 0;

  getCalls = 0;

  failSet = false;

  failClear = false;

  constructor(private readonly level: BrowserControlLevel) {}

  async get() {
    this.getCalls += 1;
    return { levelOfControl: this.level, value: { mode: 'system' } };
  }

  async set(config: ProxyConfig) {
    if (this.failSet) {
      throw new Error('Synthetic adapter failure');
    }

    this.setCalls.push(config);
  }

  async clear() {
    if (this.failClear) {
      throw new Error('Synthetic adapter failure');
    }

    this.clearCalls += 1;
  }

  subscribe(_listener: ProxySettingsChangeListener) {
    return () => undefined;
  }
}
