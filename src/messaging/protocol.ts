import type { AppError } from '../proxy/errors';
import type { ExtensionState } from '../runtime/state';
import type { ProxySettingsV1 } from '../storage/settings';

export type RequestMessage =
  | { type: 'GET_STATE' }
  | { type: 'UPDATE_SETTINGS'; settings: ProxySettingsV1 }
  | { type: 'TEST_CONNECTION' };

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export type StateApiResponse = ApiResponse<ExtensionState>;
