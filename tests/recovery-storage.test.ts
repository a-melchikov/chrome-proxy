import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  PROXY_TEST_RECOVERY_KEY,
  createBrowserRecoveryRepository,
  type ProxyTestRecoveryMarker,
} from '../src/storage/recovery';

const marker: ProxyTestRecoveryMarker = {
  version: 1,
  active: true,
  startedAt: 1_700_000_000_000,
  restoreAction: 'clear',
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe('proxy test recovery repository', () => {
  it('stores and removes a credential-free marker under a separate key', async () => {
    const repository = createBrowserRecoveryRepository();

    await expect(repository.write(marker)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(repository.load()).resolves.toEqual({
      ok: true,
      value: marker,
    });
    expect(
      await fakeBrowser.storage.local.get(PROXY_TEST_RECOVERY_KEY),
    ).toEqual({ [PROXY_TEST_RECOVERY_KEY]: marker });

    await expect(repository.remove()).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(repository.load()).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it('rejects a malformed persisted marker without exposing its data', async () => {
    await fakeBrowser.storage.local.set({
      [PROXY_TEST_RECOVERY_KEY]: {
        ...marker,
        restoreAction: 'set',
        password: 'must-not-be-returned',
      },
    });

    await expect(
      createBrowserRecoveryRepository().load(),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'RECOVERY_FAILED',
        message: 'The proxy recovery marker is invalid.',
      },
    });
  });
});
