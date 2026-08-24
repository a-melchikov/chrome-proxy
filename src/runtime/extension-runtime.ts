import {
  createProxyAuthContext,
  type ProxyAuthContextStore,
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
}

export interface ExtensionRuntimeDependencies {
  settingsRepository: SettingsRepository;
  proxyController: RuntimeProxyController;
  authContext: ProxyAuthContextStore;
  mutex?: AsyncMutex;
  recover?: () => Promise<void>;
}

export class ExtensionRuntime {
  private state = createInitialExtensionState();

  private initialization: Promise<ExtensionState> | null = null;

  private readonly mutex: AsyncMutex;

  private readonly recover: () => Promise<void>;

  constructor(private readonly dependencies: ExtensionRuntimeDependencies) {
    this.mutex = dependencies.mutex ?? new AsyncMutex();
    this.recover = dependencies.recover ?? (() => Promise.resolve());
  }

  initialize(): Promise<ExtensionState> {
    if (this.initialization === null) {
      this.initialization = this.mutex.runExclusive(async () => {
        try {
          await this.recover();
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

    return this.mutex.runExclusive(async () => {
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

  async handleProxySettingsChange(
    change: ProxySettingsChange,
  ): Promise<ExtensionState> {
    await this.initialize();

    if (change.incognitoSpecific === true) {
      return this.snapshot();
    }

    return this.mutex.runExclusive(() => {
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
