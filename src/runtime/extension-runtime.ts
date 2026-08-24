import {
  createProxyAuthContext,
  type ProxyAuthContextStore,
  type RecentProxyAuthFailure,
} from '../proxy/auth';
import type { ProxySettingsChange } from '../proxy/browser-adapter';
import { buildDesiredProxyState, type DesiredProxyState } from '../proxy/config';
import {
  getProxyControlError,
  mapControlLevel,
  type ProxyControlState,
  type ProxyMutationResult,
} from '../proxy/controller';
import { failure, success, type AppError, type Result } from '../proxy/errors';
import { parseProxyInput, type ParsedProxy } from '../proxy/parser';
import {
  connectionTestFailure,
  createConnectionProbe,
  type ConnectionProbe,
  type ConnectionTestFailure,
  type ConnectionTestResult,
} from '../proxy/tester';
import type { RecoveryRepository } from '../storage/recovery';
import {
  DEFAULT_PROXY_SETTINGS,
  validateSettings,
  type ProxySettingsV1,
  type SettingsRepository,
} from '../storage/settings';
import { AsyncMutex } from './mutex';
import {
  cloneExtensionState,
  createInitialExtensionState,
  type ExtensionState,
} from './state';

export interface RuntimeProxyController {
  getControlState(): Promise<ProxyControlState>;
  applyDesiredState(
    desired: DesiredProxyState,
  ): Promise<Result<ProxyMutationResult>>;
  disable(): Promise<Result<ProxyMutationResult>>;
  applyTemporaryProxy(
    proxy: ParsedProxy,
  ): Promise<Result<ProxyMutationResult>>;
}

export interface RuntimeAuthContext extends ProxyAuthContextStore {
  consumeRecentAuthFailure(
    host: string,
    port: number,
    since: number,
  ): RecentProxyAuthFailure | null;
}

export interface ExtensionRuntimeDependencies {
  settingsRepository: SettingsRepository;
  proxyController: RuntimeProxyController;
  authContext: RuntimeAuthContext;
  recoveryRepository?: RecoveryRepository;
  connectionProbe?: ConnectionProbe;
  mutex?: AsyncMutex;
  now?: () => number;
}

export class ExtensionRuntime {
  private state = createInitialExtensionState();

  private initialization: Promise<ExtensionState> | null = null;

  private readonly mutex: AsyncMutex;

  private readonly connectionProbe: ConnectionProbe;

  private readonly now: () => number;

  private testActive = false;

  private recoveryBlocked = false;

  constructor(private readonly dependencies: ExtensionRuntimeDependencies) {
    this.mutex = dependencies.mutex ?? new AsyncMutex();
    this.connectionProbe =
      dependencies.connectionProbe ?? createConnectionProbe();
    this.now = dependencies.now ?? Date.now;
  }

  initialize(): Promise<ExtensionState> {
    if (this.initialization === null) {
      this.initialization = this.mutex.runExclusive(async () => {
        try {
          const recovered = await this.recoverTemporaryProxyUnlocked();

          if (!recovered.ok) {
            return this.setRecoveryFailure(recovered.error);
          }

          this.recoveryBlocked = false;

          const loaded = await this.dependencies.settingsRepository.load();

          if (!loaded.ok) {
            return this.deactivateInvalidSettings(loaded.error);
          }

          return this.reconcileUnlocked(loaded.value);
        } catch {
          this.dependencies.authContext.clearContext();
          this.state = {
            ...createInitialExtensionState(),
            applyStatus: 'error',
            lastError: {
              code: 'RUNTIME_INITIALIZATION_FAILED',
              message: 'Background initialization failed.',
            },
          };
          return this.snapshot();
        }
      });
    }

    return this.initialization;
  }

  async getState(): Promise<ExtensionState> {
    await this.initialize();
    return this.snapshot();
  }

  async updateSettings(candidate: unknown): Promise<Result<ExtensionState>> {
    const validated = validateSettings(candidate);

    if (!validated.ok) {
      return validated;
    }

    await this.initialize();

    if (this.recoveryBlocked) {
      return failure(
        'RECOVERY_FAILED',
        'Proxy settings cannot be changed until recovery succeeds.',
      );
    }

    return this.mutex.runExclusive(async () => {
      if (this.recoveryBlocked) {
        return failure(
          'RECOVERY_FAILED',
          'Proxy settings cannot be changed until recovery succeeds.',
        );
      }

      const saved = await this.dependencies.settingsRepository.save(
        validated.value,
      );

      if (!saved.ok) {
        return saved;
      }

      const state = await this.reconcileUnlocked(saved.value);
      return success(state);
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.testActive) {
      return connectionTestFailure(
        'TEST_ALREADY_RUNNING',
        'A connection test is already running.',
      );
    }

    this.testActive = true;

    try {
      await this.initialize();
      this.state = { ...this.state, testInProgress: true };

      return await this.mutex.runExclusive(async () => {
        try {
          return await this.testConnectionUnlocked();
        } catch {
          return connectionTestFailure(
            'UNKNOWN',
            'The connection test failed unexpectedly.',
          );
        }
      });
    } finally {
      this.testActive = false;
      this.state = { ...this.state, testInProgress: false };
    }
  }

  async handleProxySettingsChange(
    change: ProxySettingsChange,
  ): Promise<ExtensionState> {
    await this.initialize();

    if (change.incognitoSpecific === true) {
      return this.snapshot();
    }

    if (this.recoveryBlocked) {
      return this.snapshot();
    }

    return this.mutex.runExclusive(() => {
      if (this.recoveryBlocked) {
        return this.snapshot();
      }

      const control = mapControlLevel(change.levelOfControl);

      if (!this.state.settings.enabled) {
        this.dependencies.authContext.clearContext();
        this.state = {
          ...this.state,
          effectiveEnabled: false,
          control,
          applyStatus: 'idle',
          lastError: undefined,
        };
        return this.snapshot();
      }

      if (control === 'owned') {
        const desired = buildDesiredProxyState(this.state.settings);

        if (desired.ok && desired.value.kind === 'configured') {
          this.dependencies.authContext.setContext(
            createProxyAuthContext(
              desired.value.parsedProxy,
              'enabled-proxy',
            ),
          );
        } else {
          this.dependencies.authContext.clearContext();
        }

        this.state = {
          ...this.state,
          effectiveEnabled: true,
          control,
          applyStatus: 'applied',
          lastError: undefined,
        };
        return this.snapshot();
      }

      this.dependencies.authContext.clearContext();
      const controlError = getProxyControlError(control);
      const error =
        controlError === null
          ? {
              code: 'PROXY_CONTROL_LOST' as const,
              message: 'The extension no longer controls proxy settings.',
            }
          : controlError;

      this.state = {
        ...this.state,
        effectiveEnabled: false,
        control,
        applyStatus: isBlockedError(error) ? 'blocked' : 'error',
        lastError: error,
      };

      return this.snapshot();
    });
  }

  private async testConnectionUnlocked(): Promise<ConnectionTestResult> {
    if (this.state.lastError?.code === 'RECOVERY_FAILED') {
      return toConnectionFailure(this.state.lastError);
    }

    const parsed = parseProxyInput(this.state.settings.proxyInput);

    if (this.state.settings.proxyInput.length === 0) {
      return connectionTestFailure(
        'PROXY_NOT_CONFIGURED',
        'A proxy must be configured before testing the connection.',
      );
    }

    if (!parsed.ok) {
      return connectionTestFailure(
        'INVALID_PROXY',
        'The saved proxy configuration is invalid.',
      );
    }

    if (this.state.settings.enabled) {
      const refreshed = await this.refreshEnabledForTestUnlocked(parsed.value);

      if (!refreshed.ok) {
        return toConnectionFailure(refreshed.error);
      }

      return this.runProbeWithAuthDetection(parsed.value);
    }

    return this.testDisabledProxyUnlocked(parsed.value);
  }

  private async refreshEnabledForTestUnlocked(
    proxy: ParsedProxy,
  ): Promise<Result<void>> {
    let control: ProxyControlState;

    try {
      control = await this.dependencies.proxyController.getControlState();
    } catch {
      return failure(
        'UNKNOWN',
        'Chrome proxy control state could not be refreshed.',
      );
    }

    const controlError = getProxyControlError(control);

    if (controlError !== null) {
      this.dependencies.authContext.clearContext();
      this.state = {
        ...this.state,
        effectiveEnabled: false,
        control,
        applyStatus: 'blocked',
        lastError: { ...controlError },
      };
      return { ok: false, error: controlError };
    }

    if (control === 'available') {
      const reconciled = await this.reconcileUnlocked(this.state.settings);

      if (!reconciled.effectiveEnabled) {
        return reconciled.lastError === undefined
          ? failure('UNKNOWN', 'The enabled proxy could not be applied.')
          : { ok: false, error: { ...reconciled.lastError } };
      }

      return success(undefined);
    }

    this.dependencies.authContext.setContext(
      createProxyAuthContext(proxy, 'enabled-proxy'),
    );
    this.state = {
      ...this.state,
      effectiveEnabled: true,
      control: 'owned',
      applyStatus: 'applied',
      lastError: undefined,
    };
    return success(undefined);
  }

  private async testDisabledProxyUnlocked(
    proxy: ParsedProxy,
  ): Promise<ConnectionTestResult> {
    let control: ProxyControlState;

    try {
      control = await this.dependencies.proxyController.getControlState();
    } catch {
      return connectionTestFailure(
        'UNKNOWN',
        'Chrome proxy control state could not be read.',
      );
    }

    const controlError = getProxyControlError(control);

    if (controlError !== null) {
      return toConnectionFailure(controlError);
    }

    this.dependencies.authContext.clearContext();

    const recoveryRepository = this.dependencies.recoveryRepository;

    if (recoveryRepository === undefined) {
      return connectionTestFailure(
        'RECOVERY_FAILED',
        'Proxy recovery storage is unavailable.',
      );
    }

    const markerWritten = await recoveryRepository.write({
      version: 1,
      active: true,
      startedAt: this.now(),
      restoreAction: 'clear',
    });

    if (!markerWritten.ok) {
      return toConnectionFailure(markerWritten.error);
    }

    let result: ConnectionTestResult = connectionTestFailure(
      'UNKNOWN',
      'The temporary proxy test did not start.',
    );
    let cleanupFailure: ConnectionTestFailure | null = null;

    try {
      const applied = await this.dependencies.proxyController.applyTemporaryProxy(
        proxy,
      );

      result = applied.ok
        ? await this.runProbeWithAuthDetection(proxy)
        : toConnectionFailure(applied.error);
    } finally {
      let cleared: Result<ProxyMutationResult>;

      try {
        cleared = await this.dependencies.proxyController.disable();
      } catch {
        cleared = failure(
          'RECOVERY_FAILED',
          'The temporary proxy configuration could not be cleared.',
        );
      }

      if (!cleared.ok) {
        cleanupFailure = connectionTestFailure(
          'RECOVERY_FAILED',
          'The temporary proxy configuration could not be cleared.',
        );
        this.setRecoveryFailure(cleanupFailure.error);
      } else {
        const removed = await recoveryRepository.remove();

        if (!removed.ok) {
          cleanupFailure = toConnectionFailure(removed.error);
          this.setRecoveryFailure(removed.error);
        } else {
          this.state = {
            ...this.state,
            effectiveEnabled: false,
            control: cleared.value.control,
            applyStatus: 'idle',
            lastError: undefined,
          };
        }
      }
    }

    return cleanupFailure ?? result;
  }

  private async runProbeWithAuthDetection(
    proxy: ParsedProxy,
  ): Promise<ConnectionTestResult> {
    const startedAt = this.now();
    const result = await this.connectionProbe.run();

    if (
      !result.ok &&
      (result.error.code === 'TIMEOUT' ||
        result.error.code === 'NETWORK_ERROR')
    ) {
      const authFailure =
        this.dependencies.authContext.consumeRecentAuthFailure(
          proxy.host,
          proxy.port,
          startedAt,
        );

      if (authFailure !== null) {
        return connectionTestFailure(
          'PROXY_AUTH_FAILED',
          authFailure.message,
        );
      }
    }

    return result;
  }

  private async recoverTemporaryProxyUnlocked(): Promise<Result<void>> {
    const recoveryRepository = this.dependencies.recoveryRepository;

    if (recoveryRepository === undefined) {
      return success(undefined);
    }

    const marker = await recoveryRepository.load();

    if (!marker.ok) {
      return marker;
    }

    if (marker.value === null) {
      return success(undefined);
    }

    this.dependencies.authContext.clearContext();

    let cleared: Result<ProxyMutationResult>;

    try {
      cleared = await this.dependencies.proxyController.disable();
    } catch {
      return failure(
        'RECOVERY_FAILED',
        'Startup recovery could not clear the temporary proxy.',
      );
    }

    if (!cleared.ok) {
      return failure(
        'RECOVERY_FAILED',
        'Startup recovery could not clear the temporary proxy.',
      );
    }

    const removed = await recoveryRepository.remove();
    return removed.ok ? success(undefined) : removed;
  }

  private setRecoveryFailure(error: AppError): ExtensionState {
    this.recoveryBlocked = true;
    this.dependencies.authContext.clearContext();
    this.state = {
      ...this.state,
      effectiveEnabled: false,
      applyStatus: 'error',
      lastError: {
        code: 'RECOVERY_FAILED',
        message: error.message,
      },
    };
    return this.snapshot();
  }

  private async reconcileUnlocked(
    settings: ProxySettingsV1,
  ): Promise<ExtensionState> {
    const desired = buildDesiredProxyState(settings);

    if (!desired.ok) {
      return this.deactivateInvalidSettings(desired.error);
    }

    let mutation: Result<ProxyMutationResult>;

    try {
      mutation = await this.dependencies.proxyController.applyDesiredState(
        desired.value,
      );
    } catch {
      this.dependencies.authContext.clearContext();
      this.state = {
        settings: { ...settings },
        effectiveEnabled: false,
        control: this.state.control,
        applyStatus: 'error',
        testInProgress: this.state.testInProgress,
        warnings: desiredWarnings(desired.value),
        lastError: {
          code: 'PROXY_CONTROL_STATE_FAILED',
          message: 'Chrome proxy control state could not be read.',
        },
      };
      return this.snapshot();
    }

    if (!mutation.ok) {
      const control = await this.resolveControlAfterFailure(mutation.error);
      this.state = {
        settings: { ...settings },
        effectiveEnabled: false,
        control,
        applyStatus: isBlockedError(mutation.error) ? 'blocked' : 'error',
        testInProgress: this.state.testInProgress,
        warnings: desiredWarnings(desired.value),
        lastError: { ...mutation.error },
      };
      return this.snapshot();
    }

    const configured = desired.value.kind === 'configured';
    this.state = {
      settings: { ...settings },
      effectiveEnabled: configured,
      control: configured ? 'owned' : mutation.value.control,
      applyStatus: configured ? 'applied' : 'idle',
      testInProgress: this.state.testInProgress,
      warnings: desiredWarnings(desired.value),
      lastError: undefined,
    };

    return this.snapshot();
  }

  private async deactivateInvalidSettings(
    error: AppError,
  ): Promise<ExtensionState> {
    this.dependencies.authContext.clearContext();

    let control = this.state.control;

    try {
      const disabled = await this.dependencies.proxyController.disable();

      control = disabled.ok
        ? disabled.value.control
        : await this.resolveControlAfterFailure(disabled.error);
    } catch {
      // The state remains fail-closed even if Chrome control cannot be queried.
    }

    this.state = {
      settings: { ...DEFAULT_PROXY_SETTINGS },
      effectiveEnabled: false,
      control,
      applyStatus: 'error',
      testInProgress: this.state.testInProgress,
      warnings: [],
      lastError: { ...error },
    };
    return this.snapshot();
  }

  private async resolveControlAfterFailure(
    error: AppError,
  ): Promise<ProxyControlState> {
    switch (error.code) {
      case 'PROXY_CONTROLLED_BY_OTHER_EXTENSION':
        return 'controlled-by-other-extension';
      case 'PROXY_NOT_CONTROLLABLE':
        return 'not-controllable';
      default:
        try {
          return await this.dependencies.proxyController.getControlState();
        } catch {
          return this.state.control;
        }
    }
  }

  private snapshot(): ExtensionState {
    return cloneExtensionState(this.state);
  }
}

function desiredWarnings(desired: DesiredProxyState) {
  return desired.kind === 'configured'
    ? desired.warnings.map((warning) => ({ ...warning }))
    : [];
}

function isBlockedError(error: AppError): boolean {
  return (
    error.code === 'PROXY_CONTROLLED_BY_OTHER_EXTENSION' ||
    error.code === 'PROXY_NOT_CONTROLLABLE'
  );
}

function toConnectionFailure(error: AppError): ConnectionTestFailure {
  switch (error.code) {
    case 'PROXY_NOT_CONFIGURED':
    case 'INVALID_PROXY':
    case 'PROXY_NOT_CONTROLLABLE':
    case 'PROXY_CONTROLLED_BY_OTHER_EXTENSION':
    case 'PROXY_AUTH_FAILED':
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
    case 'INVALID_RESPONSE':
    case 'TEST_ALREADY_RUNNING':
    case 'RECOVERY_FAILED':
    case 'UNKNOWN':
      return connectionTestFailure(error.code, error.message);
    default:
      return connectionTestFailure(
        'UNKNOWN',
        'The connection test could not be completed.',
      );
  }
}
