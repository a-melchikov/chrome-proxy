import { describe, expect, it } from 'vitest';
import { handleRuntimeMessage } from '../src/messaging/handler';
import {
  ProxyAuthManager,
  type ProxyAuthContext,
} from '../src/proxy/auth';
import type {
  BrowserControlLevel,
  ProxySettingsAdapter,
  ProxySettingsChangeListener,
} from '../src/proxy/browser-adapter';
import type { ProxyConfig } from '../src/proxy/config';
import { ProxyController } from '../src/proxy/controller';
import { failure, success, type Result } from '../src/proxy/errors';
import { ExtensionRuntime } from '../src/runtime/extension-runtime';
import {
  DEFAULT_PROXY_SETTINGS,
  type ProxySettingsV1,
  type SettingsRepository,
} from '../src/storage/settings';

const enabledSettings: ProxySettingsV1 = {
  version: 1,
  proxyInput: 'fixture-user:fixture-pass@proxy.example.test:8080',
  enabled: true,
  routingMode: 'all',
  rulesText: '',
};

describe('ExtensionRuntime initialization', () => {
  it('reconciles fresh defaults to OFF', async () => {
    const harness = createHarness(success({ ...DEFAULT_PROXY_SETTINGS }));

    const state = await harness.runtime.initialize();

    expect(state).toMatchObject({
      settings: DEFAULT_PROXY_SETTINGS,
      effectiveEnabled: false,
      control: 'available',
      applyStatus: 'idle',
      warnings: [],
    });
    expect(harness.adapter.clearCalls).toBe(1);
    expect(harness.adapter.setCalls).toEqual([]);
    expect(harness.authManager.getContext()).toBeNull();
  });

  it('applies enabled all mode and activates auth', async () => {
    const harness = createHarness(success(enabledSettings));

    const state = await harness.runtime.initialize();

    expect(state).toMatchObject({
      effectiveEnabled: true,
      control: 'owned',
      applyStatus: 'applied',
    });
    expect(harness.adapter.setCalls).toEqual([
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
    expect(harness.authManager.getContext()).toEqual(enabledAuthContext);
  });

  it('applies enabled bypass mode', async () => {
    const settings: ProxySettingsV1 = {
      ...enabledSettings,
      routingMode: 'bypass',
      rulesText: 'example.com\n10.0.0.1\n192.168.0.0/16',
    };
    const harness = createHarness(success(settings));

    await harness.runtime.initialize();

    expect(harness.adapter.setCalls[0]).toEqual({
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
  });

  it('applies enabled allowlist PAC mode', async () => {
    const settings: ProxySettingsV1 = {
      ...enabledSettings,
      routingMode: 'allowlist',
      rulesText: 'example.com\nlocalhost',
    };
    const harness = createHarness(success(settings));

    const state = await harness.runtime.initialize();
    const config = harness.adapter.setCalls[0];

    expect(config?.mode).toBe('pac_script');

    if (config?.mode === 'pac_script') {
      expect(config.pacScript.mandatory).toBe(true);
      expect(config.pacScript.data).toContain(
        'return "PROXY proxy.example.test:8080";',
      );
    }

    expect(state.warnings).toMatchObject([
      { code: 'IMPLICIT_LOOPBACK_BYPASS', rule: 'localhost' },
    ]);
  });

  it('fails closed for invalid persisted enabled settings', async () => {
    const harness = createHarness(
      failure('INVALID_SETTINGS', 'Stored proxy settings are invalid.'),
      'controlled_by_this_extension',
    );
    harness.authManager.setContext(enabledAuthContext);

    const state = await harness.runtime.initialize();

    expect(harness.adapter.setCalls).toEqual([]);
    expect(harness.adapter.clearCalls).toBe(1);
    expect(harness.authManager.getContext()).toBeNull();
    expect(state).toMatchObject({
      settings: DEFAULT_PROXY_SETTINGS,
      effectiveEnabled: false,
      applyStatus: 'error',
      lastError: { code: 'INVALID_SETTINGS' },
    });
  });

  it('is idempotent within one service worker lifecycle', async () => {
    const harness = createHarness(success(enabledSettings));

    await Promise.all([
      harness.runtime.initialize(),
      harness.runtime.initialize(),
      harness.runtime.initialize(),
    ]);

    expect(harness.repository.loadCalls).toBe(1);
    expect(harness.adapter.setCalls).toHaveLength(1);
  });
});

describe('ExtensionRuntime settings transactions', () => {
  it('rejects an invalid update without persisting or applying it', async () => {
    const harness = createHarness(success({ ...DEFAULT_PROXY_SETTINGS }));
    await harness.runtime.initialize();
    harness.adapter.resetMutationCalls();

    const result = await harness.runtime.updateSettings({
      ...enabledSettings,
      proxyInput: 'invalid-proxy',
    });

    expect(result.ok).toBe(false);
    expect(harness.repository.saveCalls).toEqual([]);
    expect(harness.adapter.setCalls).toEqual([]);
    expect(harness.adapter.clearCalls).toBe(0);
  });

  it('persists desired ON but reports blocked control as ineffective', async () => {
    const harness = createHarness(
      success({ ...DEFAULT_PROXY_SETTINGS }),
      'controlled_by_other_extensions',
    );
    await harness.runtime.initialize();

    const result = await harness.runtime.updateSettings(enabledSettings);

    expect(result.ok).toBe(true);
    expect(harness.repository.saveCalls).toEqual([enabledSettings]);
    expect(harness.adapter.setCalls).toEqual([]);

    if (result.ok) {
      expect(result.value).toMatchObject({
        settings: enabledSettings,
        effectiveEnabled: false,
        control: 'controlled-by-other-extension',
        applyStatus: 'blocked',
        lastError: { code: 'PROXY_CONTROLLED_BY_OTHER_EXTENSION' },
      });
    }
  });

  it('turns OFF by clearing the setting and auth context', async () => {
    const harness = createHarness(success(enabledSettings));
    await harness.runtime.initialize();

    const disabledSettings: ProxySettingsV1 = {
      ...enabledSettings,
      enabled: false,
    };
    const result = await harness.runtime.updateSettings(disabledSettings);

    expect(result.ok).toBe(true);
    expect(harness.adapter.clearCalls).toBe(1);
    expect(harness.authManager.getContext()).toBeNull();

    if (result.ok) {
      expect(result.value).toMatchObject({
        settings: disabledSettings,
        effectiveEnabled: false,
        control: 'available',
        applyStatus: 'idle',
      });
    }
  });

  it('serializes concurrent updates', async () => {
    const harness = createHarness(success({ ...DEFAULT_PROXY_SETTINGS }));
    await harness.runtime.initialize();
    harness.adapter.resetMutationCalls();
    harness.adapter.mutationDelayMs = 5;

    const firstSettings: ProxySettingsV1 = {
      ...enabledSettings,
      proxyInput: 'fixture-user:fixture-pass@first-proxy.example.test:8080',
    };
    const secondSettings: ProxySettingsV1 = {
      ...enabledSettings,
      proxyInput: 'fixture-user:fixture-pass@second-proxy.example.test:8080',
    };

    const [first, second] = await Promise.all([
      harness.runtime.updateSettings(firstSettings),
      harness.runtime.updateSettings(secondSettings),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(harness.adapter.maximumConcurrentMutations).toBe(1);
    expect(harness.repository.saveCalls).toEqual([
      firstSettings,
      secondSettings,
    ]);
    expect(
      harness.adapter.setCalls.map((config) =>
        config.mode === 'fixed_servers'
          ? config.rules.singleProxy.host
          : 'unexpected-pac',
      ),
    ).toEqual([
      'first-proxy.example.test',
      'second-proxy.example.test',
    ]);
    expect((await harness.runtime.getState()).settings).toEqual(secondSettings);
  });
});

describe('ExtensionRuntime external control changes', () => {
  it('marks ON ineffective when control is lost without reapplying', async () => {
    const harness = createHarness(success(enabledSettings));
    await harness.runtime.initialize();

    const state = await harness.runtime.handleProxySettingsChange({
      levelOfControl: 'controlled_by_other_extensions',
      value: { mode: 'system' },
    });

    expect(state).toMatchObject({
      effectiveEnabled: false,
      control: 'controlled-by-other-extension',
      applyStatus: 'blocked',
      lastError: { code: 'PROXY_CONTROLLED_BY_OTHER_EXTENSION' },
    });
    expect(harness.authManager.getContext()).toBeNull();
    expect(harness.adapter.setCalls).toHaveLength(1);
  });

  it('restores auth context when an enabled setting remains owned', async () => {
    const harness = createHarness(success(enabledSettings));
    await harness.runtime.initialize();
    harness.authManager.clearContext();

    const state = await harness.runtime.handleProxySettingsChange({
      levelOfControl: 'controlled_by_this_extension',
      value: harness.adapter.setCalls[0],
    });

    expect(state).toMatchObject({
      effectiveEnabled: true,
      control: 'owned',
      applyStatus: 'applied',
    });
    expect(harness.authManager.getContext()).toEqual(enabledAuthContext);
    expect(harness.adapter.setCalls).toHaveLength(1);
  });

  it('ignores incognito-specific change events', async () => {
    const harness = createHarness(success(enabledSettings));
    const initialized = await harness.runtime.initialize();

    const state = await harness.runtime.handleProxySettingsChange({
      levelOfControl: 'controlled_by_other_extensions',
      value: { mode: 'system' },
      incognitoSpecific: true,
    });

    expect(state).toEqual(initialized);
    expect(harness.authManager.getContext()).toEqual(enabledAuthContext);
  });
});

describe('runtime messaging contract', () => {
  it('returns authoritative state for GET_STATE', async () => {
    const harness = createHarness(success({ ...DEFAULT_PROXY_SETTINGS }));

    const response = await handleRuntimeMessage(harness.runtime, {
      type: 'GET_STATE',
    });

    expect(response).toMatchObject({
      ok: true,
      data: { effectiveEnabled: false, applyStatus: 'idle' },
    });
  });

  it('rejects malformed messages and reserves TEST_CONNECTION', async () => {
    const harness = createHarness(success({ ...DEFAULT_PROXY_SETTINGS }));

    await expect(handleRuntimeMessage(harness.runtime, null)).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_MESSAGE',
        message: 'Background message is invalid.',
      },
    });
    await expect(
      handleRuntimeMessage(harness.runtime, { type: 'TEST_CONNECTION' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONNECTION_TEST_NOT_AVAILABLE' },
    });
  });
});

const enabledAuthContext: ProxyAuthContext = {
  host: 'proxy.example.test',
  port: 8080,
  username: 'fixture-user',
  password: 'fixture-pass',
  source: 'enabled-proxy',
};

function createHarness(
  loaded: Result<ProxySettingsV1>,
  level: BrowserControlLevel = 'controllable_by_this_extension',
) {
  const repository = new FakeSettingsRepository(loaded);
  const adapter = new FakeProxyAdapter(level);
  const authManager = new ProxyAuthManager();
  const proxyController = new ProxyController(adapter, authManager);
  const runtime = new ExtensionRuntime({
    settingsRepository: repository,
    proxyController,
    authContext: authManager,
  });

  return { runtime, repository, adapter, authManager };
}

class FakeSettingsRepository implements SettingsRepository {
  readonly saveCalls: ProxySettingsV1[] = [];

  loadCalls = 0;

  constructor(private loaded: Result<ProxySettingsV1>) {}

  async load(): Promise<Result<ProxySettingsV1>> {
    this.loadCalls += 1;
    return this.loaded.ok
      ? success({ ...this.loaded.value })
      : { ok: false, error: { ...this.loaded.error } };
  }

  async save(settings: ProxySettingsV1): Promise<Result<ProxySettingsV1>> {
    const saved = { ...settings };
    this.saveCalls.push(saved);
    this.loaded = success(saved);
    return success({ ...saved });
  }
}

class FakeProxyAdapter implements ProxySettingsAdapter {
  readonly setCalls: ProxyConfig[] = [];

  clearCalls = 0;

  mutationDelayMs = 0;

  maximumConcurrentMutations = 0;

  private concurrentMutations = 0;

  constructor(private level: BrowserControlLevel) {}

  async get() {
    return { levelOfControl: this.level, value: { mode: 'system' } };
  }

  async set(config: ProxyConfig) {
    await this.trackMutation(async () => {
      this.setCalls.push(config);
      this.level = 'controlled_by_this_extension';
    });
  }

  async clear() {
    await this.trackMutation(async () => {
      this.clearCalls += 1;

      if (
        this.level === 'controlled_by_this_extension' ||
        this.level === 'controllable_by_this_extension'
      ) {
        this.level = 'controllable_by_this_extension';
      }
    });
  }

  subscribe(_listener: ProxySettingsChangeListener) {
    return () => undefined;
  }

  resetMutationCalls() {
    this.setCalls.length = 0;
    this.clearCalls = 0;
    this.maximumConcurrentMutations = 0;
  }

  private async trackMutation(operation: () => Promise<void>) {
    this.concurrentMutations += 1;
    this.maximumConcurrentMutations = Math.max(
      this.maximumConcurrentMutations,
      this.concurrentMutations,
    );

    try {
      if (this.mutationDelayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, this.mutationDelayMs);
        });
      }

      await operation();
    } finally {
      this.concurrentMutations -= 1;
    }
  }
}
