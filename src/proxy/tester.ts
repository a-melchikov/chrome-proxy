import type { AppError } from './errors';

export const CONNECTION_TEST_ENDPOINT =
  'https://api.ipify.org?format=json';
export const CONNECTION_TEST_TIMEOUT_MS = 5_000;

export type ConnectionTestErrorCode =
  | 'PROXY_NOT_CONFIGURED'
  | 'INVALID_PROXY'
  | 'PROXY_NOT_CONTROLLABLE'
  | 'PROXY_CONTROLLED_BY_OTHER_EXTENSION'
  | 'PROXY_AUTH_FAILED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'TEST_ALREADY_RUNNING'
  | 'RECOVERY_FAILED'
  | 'UNKNOWN';

export interface ConnectionTestSuccess {
  ok: true;
  latencyMs: number;
  ip: string;
}

export interface ConnectionTestFailure {
  ok: false;
  error: Pick<AppError, 'message'> & { code: ConnectionTestErrorCode };
}

export type ConnectionTestResult =
  | ConnectionTestSuccess
  | ConnectionTestFailure;

export interface ConnectionProbe {
  run(): Promise<ConnectionTestResult>;
}

export interface ConnectionProbeOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export function createConnectionProbe(
  options: ConnectionProbeOptions = {},
): ConnectionProbe {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS;

  return {
    async run(): Promise<ConnectionTestResult> {
      const controller = new AbortController();
      const startedAt = now();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImplementation(CONNECTION_TEST_ENDPOINT, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          return connectionTestFailure(
            'INVALID_RESPONSE',
            'The external IP service returned an unsuccessful response.',
          );
        }

        let payload: unknown;

        try {
          payload = await response.json();
        } catch {
          return connectionTestFailure(
            'INVALID_RESPONSE',
            'The external IP service returned invalid JSON.',
          );
        }

        if (!isRecord(payload) || typeof payload.ip !== 'string') {
          return connectionTestFailure(
            'INVALID_RESPONSE',
            'The external IP service response does not contain an IP address.',
          );
        }

        const ip = payload.ip.trim();

        if (ip.length === 0) {
          return connectionTestFailure(
            'INVALID_RESPONSE',
            'The external IP service response contains an empty IP address.',
          );
        }

        return {
          ok: true,
          latencyMs: Math.max(0, Math.round(now() - startedAt)),
          ip,
        };
      } catch (error) {
        return isAbortError(error)
          ? connectionTestFailure(
              'TIMEOUT',
              `The connection test timed out after ${timeoutMs} ms.`,
            )
          : connectionTestFailure(
              'NETWORK_ERROR',
              'The connection test request failed.',
            );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function connectionTestFailure(
  code: ConnectionTestErrorCode,
  message: string,
): ConnectionTestFailure {
  return { ok: false, error: { code, message } };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
