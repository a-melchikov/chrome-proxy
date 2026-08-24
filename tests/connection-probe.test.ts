import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTION_TEST_ENDPOINT,
  createConnectionProbe,
} from '../src/proxy/tester';

describe('connection probe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a trimmed IP and rounded non-negative HTTP latency', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ip: ' 203.0.113.7 ' }),
    );
    const times = [100, 112.6];
    const probe = createConnectionProbe({
      fetch: fetchMock,
      now: () => times.shift() ?? 0,
    });

    await expect(probe.run()).resolves.toEqual({
      ok: true,
      latencyMs: 13,
      ip: '203.0.113.7',
    });
    expect(fetchMock).toHaveBeenCalledWith(CONNECTION_TEST_ENDPOINT, {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    [new Response('', { status: 503 }), 'INVALID_RESPONSE'],
    [new Response('{broken', { status: 200 }), 'INVALID_RESPONSE'],
    [jsonResponse({ ip: '   ' }), 'INVALID_RESPONSE'],
    [jsonResponse({ address: '203.0.113.7' }), 'INVALID_RESPONSE'],
  ] as const)('rejects malformed service responses', async (response, code) => {
    const probe = createConnectionProbe({
      fetch: vi.fn<typeof fetch>(async () => response),
    });

    await expect(probe.run()).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it('maps an aborted request to TIMEOUT', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const pending = createConnectionProbe({ fetch: fetchMock }).run();

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: 'TIMEOUT' },
    });
  });

  it('maps a generic fetch rejection to NETWORK_ERROR', async () => {
    const probe = createConnectionProbe({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('synthetic network failure');
      }),
    });

    await expect(probe.run()).resolves.toMatchObject({
      ok: false,
      error: { code: 'NETWORK_ERROR' },
    });
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
