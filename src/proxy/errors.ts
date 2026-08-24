export type AppErrorCode =
  | 'INVALID_PROXY_FORMAT'
  | 'INVALID_PROXY_USERNAME'
  | 'INVALID_PROXY_PASSWORD'
  | 'INVALID_PROXY_HOST'
  | 'INVALID_PROXY_PORT'
  | 'INVALID_PROXY_ENCODING'
  | 'INVALID_RULE'
  | 'INVALID_SETTINGS'
  | 'PROXY_NOT_CONTROLLABLE'
  | 'PROXY_CONTROLLED_BY_OTHER_EXTENSION'
  | 'PROXY_APPLY_FAILED'
  | 'PROXY_CLEAR_FAILED'
  | 'PROXY_AUTH_FAILED';

export interface AppError {
  code: AppErrorCode;
  message: string;
  line?: number;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure(
  code: AppErrorCode,
  message: string,
  details: { line?: number } = {},
): Result<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...details,
    },
  };
}

export class AppValidationError extends Error {
  readonly code: AppErrorCode;

  readonly line?: number;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'AppValidationError';
    this.code = error.code;
    this.line = error.line;
  }
}
