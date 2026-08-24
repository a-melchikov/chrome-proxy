import type { AppError } from '../proxy/errors';
import type { ProxyControlState } from '../proxy/controller';
import type { ProxyConfigWarning } from '../proxy/warnings';
import {
  DEFAULT_PROXY_SETTINGS,
  type ProxySettingsV1,
} from '../storage/settings';

export type ProxyApplyStatus = 'idle' | 'applied' | 'blocked' | 'error';

export type SerializedAppError = AppError;

export interface ExtensionState {
  settings: ProxySettingsV1;
  effectiveEnabled: boolean;
  control: ProxyControlState;
  applyStatus: ProxyApplyStatus;
  testInProgress: boolean;
  warnings: ProxyConfigWarning[];
  lastError?: SerializedAppError;
}

export function createInitialExtensionState(): ExtensionState {
  return {
    settings: { ...DEFAULT_PROXY_SETTINGS },
    effectiveEnabled: false,
    control: 'available',
    applyStatus: 'idle',
    testInProgress: false,
    warnings: [],
  };
}

export function cloneExtensionState(state: ExtensionState): ExtensionState {
  return {
    ...state,
    settings: { ...state.settings },
    warnings: state.warnings.map((warning) => ({ ...warning })),
    ...(state.lastError === undefined
      ? { lastError: undefined }
      : { lastError: { ...state.lastError } }),
  };
}
