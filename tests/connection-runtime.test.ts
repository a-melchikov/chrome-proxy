import { describe, expect, it } from 'vitest';
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
import { success, type Result } from '../src/proxy/errors';
import type {
  ConnectionProbe,
  ConnectionTestResult,
} from '../src/proxy/tester';
import { ExtensionRuntime } from '../src/runtime/extension-runtime';
import type {
  ProxyTestRecoveryMarker,
  RecoveryRepository,
} from '../src/storage/recovery';
import type {
  ProxySettingsV1,
  SettingsRepository,
} from '../src/storage/settings';

const enabledSettings: ProxySettingsV1 = {
  version: 1,
  proxyInput: 'fixture-user:fixture-pass@proxy.example.test:8080',
  enabled: true,
  routingMode: 'all',
  rulesText: '',
};

const disabledSettings: ProxySettingsV1 = {
  ...enabledSettings,
  enabled: false,
};

const successResult: ConnectionTestResult = {
  ok: true,
  latencyMs: 37,
  ip: '203.0.113.9',
};

describe('enabled connection test', () => {
  it('uses the already applied proxy without set or clear', async () => {
    const harness = createHarness({ settings: enabledSettings });
    await harness.runtime.initialize();
    harness.resetEvents();

    await expect(harness.runtime.testConnection()).resolves.toEqual(
      successResult,
    );

    expect(harness.adapter.setCalls).toEqual([]);
    expect(harness.adapter.clearCalls).toBe(0);
    expect(harness.probe.runCalls).toBe(1);
    expect(harness.authManager.getContext()).toMatchObject({
      source: 'enabled-proxy',
    });
  });

  it.each(['TIMEOUT', 'INVALID_RESPONSE'] as const)(
    'returns %s without mutating the active setting',
    async (code) => {
      const harness = createHarness({
        settings: enabledSettings,
        probeResult: testFailure(code),
      });
      await harness.runtime.initialize();
      harness.resetEvents();

      await expect(harness.runtime.testConnection()).resolves.toMatchObject({
        ok: false,
        error: { code },
      });
      expect(harness.adapter.setCalls).toEqual([]);
      expect(harness.adapter.clearCalls).toBe(0);
    },
  );

  it('maps a repeated proxy challenge after test start to auth failure', async () => {
    let authManager: LoggingAuthManager;
    const harness = createHarness({
      settings: enabledSettings,
      probeResult: testFailure('NETWORK_ERROR'),
      onProbe: () => {
        authManager.handleChallenge(proxyChallenge);
        authManager.handleChallenge(proxyChallenge);
      },
    });
    authManager = harness.authManager;
    await harness.runtime.initialize();

    await expect(harness.runtime.testConnection()).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROXY_AUTH_FAILED' },
    });
  });

  it.each([
    ['controlled_by_other_extensions', 'PROXY_CONTROLLED_BY_OTHER_EXTENSION'],
    ['not_controllable', 'PROXY_NOT_CONTROLLABLE'],
  ] as const)('blocks fetch when control is %s', async (level, code) => {
    const harness = createHarness({ settings: enabledSettings, level });
    await harness.runtime.initialize();
    harness.resetEvents();

    await expect(harness.runtime.testConnection()).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
    expect(harness.probe.runCalls).toBe(0);
    expect(harness.adapter.setCalls).toEqual([]);
    expect(harness.adapter.clearCalls).toBe(0);
  });
});

describe('disabled connection test', () => {
  it('uses the temporary all-sites proxy and cleans it up in order', async () => {
    const harness = createHarness({ settings: disabledSettings });
    await harness.runtime.initialize();
    harness.resetEvents();

    await expect(harness.runtime.testConnection()).resolves.toEqual(
      successResult,
    );

    expect(harness.events.slice(1)).toEqual([
      'marker write',
      'proxy set',
      'auth set temporary-test',
      'fetch',
      'auth clear',
      'proxy clear',
      'marker remove',
    ]);
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
    expect(harness.recovery.marker).toBeNull();
    expect((await harness.runtime.getState()).testInProgress).toBe(false);
  });

  it.each(['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'] as const)(
    'runs cleanup after %s',
    async (code) => {
      const harness = createHarness({
        settings: disabledSettings,
        probeResult: testFailure(code),
      });
      await harness.runtime.initialize();
      harness.resetEvents();

      await expect(harness.runtime.testConnection()).resolves.toMatchObject({
        ok: false,
        error: { code },
      });
      expect(harness.events).toContain('proxy clear');
      expect(harness.events.at(-1)).toBe('marker remove');
      expect(harness.recovery.marker).toBeNull();
    },
  );

  it('runs cleanup when the probe throws unexpectedly', async () => {
    const deferred = createDeferred<ConnectionTestResult>();
    const harness = createHarness({
      settings: disabledSettings,
      probePromise: deferred.promise,
    });
    await harness.runtime.initialize();
    harness.resetEvents();

    const testing = harness.runtime.testConnection();
    await harness.probe.started.promise;
    deferred.reject(new Error('synthetic probe failure'));

    await expect(testing).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN' },
    });
    expect(harness.events).toContain('proxy clear');
    expect(harness.events.at(-1)).toBe('marker remove');
  });

  it('leaves the marker and reports recovery failure when clear fails', async () => {
    const harness = createHarness({ settings: disabledSettings });
    await harness.runtime.initialize();
    harness.resetEvents();
    harness.adapter.failClear = true;

    await expect(harness.runtime.testConnection()).resolves.toMatchObject({
      ok: false,
      error: { code: 'RECOVERY_FAILED' },
    });
    expect(harness.recovery.marker).not.toBeNull();
    expect(harness.events).not.toContain('marker remove');
    await expect(harness.runtime.getState()).resolves.toMatchObject({
      applyStatus: 'error',
      lastError: { code: 'RECOVERY_FAILED' },
    });
  });
});

describe('startup temporary proxy recovery', () => {
  it('clears a marked temporary proxy before reconciling OFF', async () => {
    const harness = createHarness({
      settings: disabledSettings,
      marker: recoveryMarker,
      level: 'controlled_by_this_extension',
    });

    await harness.runtime.initialize();

    expect(harness.events).toEqual([
      'marker load',
      'auth clear',
      'auth clear',
      'proxy clear',
      'marker remove',
      'auth clear',
      'proxy clear',
    ]);
    expect(harness.recovery.marker).toBeNull();
  });

  it('clears a marked temporary proxy before applying desired ON', async () => {
    const harness = createHarness({
      settings: enabledSettings,
      marker: recoveryMarker,
      level: 'controlled_by_this_extension',
    });

    await harness.runtime.initialize();

    expect(indexOf(harness.events, 'proxy clear')).toBeLessThan(
      indexOf(harness.events, 'proxy set'),
    );
    expect(indexOf(harness.events, 'marker remove')).toBeLessThan(
      indexOf(harness.events, 'proxy set'),
    );
  });

  it('does not perform a recovery clear without a marker', async () => {
    const harness = createHarness({ settings: enabledSettings });

    await harness.runtime.initialize();

    expect(harness.adapter.clearCalls).toBe(0);
    expect(harness.adapter.setCalls).toHaveLength(1);
  });
});

describe('connection test concurrency', () => {
  it('allows only one active test and exposes testInProgress', async () => {
    const deferred = createDeferred<ConnectionTestResult>();
    const harness = createHarness({
      settings: disabledSettings,
      probePromise: deferred.promise,
    });
    await harness.runtime.initialize();
    harness.resetEvents();

    const first = harness.runtime.testConnection();
    await harness.probe.started.promise;

    await expect(harness.runtime.getState()).resolves.toMatchObject({
      testInProgress: true,
    });
    await expect(harness.runtime.testConnection()).resolves.toMatchObject({
      ok: false,
      error: { code: 'TEST_ALREADY_RUNNING' },
    });

    deferred.resolve(successResult);
    await expect(first).resolves.toEqual(successResult);
    expect(harness.probe.runCalls).toBe(1);
  });

  it('queues a settings update until temporary cleanup completes', async () => {
    const deferred = createDeferred<ConnectionTestResult>();
    const harness = createHarness({
      settings: disabledSettings,
      probePromise: deferred.promise,
    });
    await harness.runtime.initialize();
    harness.resetEvents();

    const testing = harness.runtime.testConnection();
    await harness.probe.started.promise;
    const updating = harness.runtime.updateSettings(enabledSettings);
    await Promise.resolve();

    expect(harness.repository.saveCalls).toEqual([]);
    deferred.resolve(successResult);
    await testing;
    await updating;

    expect(indexOf(harness.events, 'marker remove')).toBeLessThan(
      indexOf(harness.events, 'settings save'),
    );
  });
});

interface HarnessOptions {
  settings: ProxySettingsV1;
  level?: BrowserControlLevel;
  marker?: ProxyTestRecoveryMarker | null;
  probeResult?: ConnectionTestResult;
  probePromise?: Promise<ConnectionTestResult>;
  onProbe?: () => void;
}

function createHarness(options: HarnessOptions) {
  const events: string[] = [];
  const repository = new FakeSettingsRepository(options.settings, events);
  const adapter = new FakeProxyAdapter(
    options.level ?? 'controllable_by_this_extension',
    events,
  );
  const authManager = new LoggingAuthManager(events);
  const recovery = new FakeRecoveryRepository(
    options.marker ?? null,
    events,
  );
  const probe = new FakeProbe(
    options.probePromise ??
      Promise.resolve(options.probeResult ?? successResult),
    events,
    options.onProbe,
  );
  const runtime = new ExtensionRuntime({
    settingsRepository: repository,
    proxyController: new ProxyController(adapter, authManager),
    authContext: authManager,
    recoveryRepository: recovery,
    connectionProbe: probe,
  });

  return {
    runtime,
    repository,
    adapter,
    authManager,
    recovery,
    probe,
    events,
    resetEvents() {
      events.length = 0;
      adapter.resetMutationCalls();
    },
  };
}

class FakeSettingsRepository implements SettingsRepository {
  readonly saveCalls: ProxySettingsV1[] = [];

  constructor(
    private settings: ProxySettingsV1,
    private readonly events: string[],
  ) {}

  async load(): Promise<Result<ProxySettingsV1>> {
    return success({ ...this.settings });
  }

  async save(settings: ProxySettingsV1): Promise<Result<ProxySettingsV1>> {
    this.events.push('settings save');
    this.settings = { ...settings };
    this.saveCalls.push({ ...settings });
    return success({ ...settings });
  }
}

class FakeProxyAdapter implements ProxySettingsAdapter {
  readonly setCalls: ProxyConfig[] = [];

  clearCalls = 0;

  failClear = false;

  constructor(
    private level: BrowserControlLevel,
    private readonly events: string[],
  ) {}

  async get() {
    return { levelOfControl: this.level, value: { mode: 'system' } };
  }

  async set(config: ProxyConfig) {
    this.events.push('proxy set');
    this.setCalls.push(config);
    this.level = 'controlled_by_this_extension';
  }

  async clear() {
    this.events.push('proxy clear');

    if (this.failClear) {
      throw new Error('synthetic clear failure');
    }

    this.clearCalls += 1;

    if (this.level === 'controlled_by_this_extension') {
      this.level = 'controllable_by_this_extension';
    }
  }

  subscribe(_listener: ProxySettingsChangeListener) {
    return () => undefined;
  }

  resetMutationCalls() {
    this.setCalls.length = 0;
    this.clearCalls = 0;
  }
}

class LoggingAuthManager extends ProxyAuthManager {
  constructor(private readonly events: string[]) {
    super();
  }

  override setContext(context: ProxyAuthContext): void {
    super.setContext(context);
    this.events.push(`auth set ${context.source}`);
  }

  override clearContext(): void {
    super.clearContext();
    this.events.push('auth clear');
  }
}

class FakeRecoveryRepository implements RecoveryRepository {
  constructor(
    public marker: ProxyTestRecoveryMarker | null,
    private readonly events: string[],
  ) {}

  async load(): Promise<Result<ProxyTestRecoveryMarker | null>> {
    this.events.push('marker load');
    return success(this.marker === null ? null : { ...this.marker });
  }

  async write(marker: ProxyTestRecoveryMarker): Promise<Result<void>> {
    this.events.push('marker write');
    this.marker = { ...marker };
    return success(undefined);
  }

  async remove(): Promise<Result<void>> {
    this.events.push('marker remove');
    this.marker = null;
    return success(undefined);
  }
}

class FakeProbe implements ConnectionProbe {
  runCalls = 0;

  readonly started = createDeferred<void>();

  constructor(
    private readonly result: Promise<ConnectionTestResult>,
    private readonly events: string[],
    private readonly onRun?: () => void,
  ) {}

  async run(): Promise<ConnectionTestResult> {
    this.runCalls += 1;
    this.events.push('fetch');
    this.onRun?.();
    this.started.resolve();
    return this.result;
  }
}

const recoveryMarker: ProxyTestRecoveryMarker = {
  version: 1,
  active: true,
  startedAt: 1_700_000_000_000,
  restoreAction: 'clear',
};

const proxyChallenge = {
  requestId: 'connection-test-request',
  isProxy: true,
  challenger: { host: 'proxy.example.test', port: 8080 },
};

function testFailure(
  code: 'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_RESPONSE',
): ConnectionTestResult {
  return { ok: false, error: { code, message: 'Synthetic test failure.' } };
}

function indexOf(events: string[], event: string): number {
  const index = events.indexOf(event);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
