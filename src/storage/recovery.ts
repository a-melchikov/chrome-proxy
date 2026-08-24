import { browser } from 'wxt/browser';
import { failure, success, type Result } from '../proxy/errors';

export const PROXY_TEST_RECOVERY_KEY = 'proxyTestRecovery';

export interface ProxyTestRecoveryMarker {
  version: 1;
  active: true;
  startedAt: number;
  restoreAction: 'clear';
}

export interface RecoveryRepository {
  load(): Promise<Result<ProxyTestRecoveryMarker | null>>;
  write(marker: ProxyTestRecoveryMarker): Promise<Result<void>>;
  remove(): Promise<Result<void>>;
}

export function createBrowserRecoveryRepository(): RecoveryRepository {
  return {
    load: loadRecoveryMarker,
    write: writeRecoveryMarker,
    remove: removeRecoveryMarker,
  };
}

async function loadRecoveryMarker(): Promise<
  Result<ProxyTestRecoveryMarker | null>
> {
  let stored: Record<string, unknown>;

  try {
    stored = await browser.storage.local.get(PROXY_TEST_RECOVERY_KEY);
  } catch {
    return recoveryFailure('Chrome failed to read the proxy recovery marker.');
  }

  const marker = stored[PROXY_TEST_RECOVERY_KEY];

  if (marker === undefined) {
    return success(null);
  }

  if (!isRecoveryMarker(marker)) {
    return recoveryFailure('The proxy recovery marker is invalid.');
  }

  return success({ ...marker });
}

async function writeRecoveryMarker(
  marker: ProxyTestRecoveryMarker,
): Promise<Result<void>> {
  try {
    await browser.storage.local.set({
      [PROXY_TEST_RECOVERY_KEY]: marker,
    });
    return success(undefined);
  } catch {
    return recoveryFailure('Chrome failed to save the proxy recovery marker.');
  }
}

async function removeRecoveryMarker(): Promise<Result<void>> {
  try {
    await browser.storage.local.remove(PROXY_TEST_RECOVERY_KEY);
    return success(undefined);
  } catch {
    return recoveryFailure(
      'Chrome failed to remove the proxy recovery marker.',
    );
  }
}

function isRecoveryMarker(value: unknown): value is ProxyTestRecoveryMarker {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    value.active === true &&
    typeof value.startedAt === 'number' &&
    Number.isFinite(value.startedAt) &&
    value.startedAt >= 0 &&
    value.restoreAction === 'clear'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recoveryFailure(message: string): Result<never> {
  return failure('RECOVERY_FAILED', message);
}
