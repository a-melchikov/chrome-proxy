import { describe, expect, it } from 'vitest';
import {
  createProxyAuthContext,
  decideProxyAuthChallenge,
  ProxyAuthManager,
  type ProxyAuthChallenge,
  type ProxyAuthContext,
} from '../src/proxy/auth';
import {
  decisionToBlockingResponse,
  PROXY_AUTH_LISTENER_MODE,
} from '../src/proxy/auth-listener';
import { parseProxyInput } from '../src/proxy/parser';

const context: ProxyAuthContext = {
  host: 'proxy.example.test',
  port: 8080,
  username: 'fixture-user',
  password: 'fixture-password',
  source: 'enabled-proxy',
};

describe('proxy auth challenge decisions', () => {
  it('uses the MV3 auth-provider async blocking mode', () => {
    expect(PROXY_AUTH_LISTENER_MODE).toBe('asyncBlocking');
  });

  it('never provides credentials to site WWW-Authenticate challenges', () => {
    const decision = decideProxyAuthChallenge(
      challenge({ isProxy: false }),
      context,
      false,
    );

    expect(decision).toEqual({
      kind: 'ignore',
      reason: 'not-proxy-authentication',
    });
    expect(decisionToBlockingResponse(decision)).toEqual({});
  });

  it('ignores a proxy challenge without active context', () => {
    expect(decideProxyAuthChallenge(challenge(), null, false)).toEqual({
      kind: 'ignore',
      reason: 'no-active-context',
    });
  });

  it.each([
    [
      challenge({ challenger: { host: 'other-proxy.example.test', port: 8080 } }),
      'proxy-host-mismatch',
    ],
    [
      challenge({ challenger: { host: 'proxy.example.test', port: 3128 } }),
      'proxy-port-mismatch',
    ],
  ] as const)('ignores mismatched proxy endpoints', (details, reason) => {
    expect(decideProxyAuthChallenge(details, context, false)).toEqual({
      kind: 'ignore',
      reason,
    });
  });

  it('returns credentials for the exact proxy with canonical host comparison', () => {
    expect(
      decideProxyAuthChallenge(
        challenge({
          challenger: { host: 'PROXY.EXAMPLE.TEST', port: 8080 },
        }),
        context,
        false,
      ),
    ).toEqual({
      kind: 'provide-credentials',
      authCredentials: {
        username: 'fixture-user',
        password: 'fixture-password',
      },
    });
  });

  it('cancels a repeated challenge with a safe typed error', () => {
    const decision = decideProxyAuthChallenge(challenge(), context, true);

    expect(decision).toEqual({
      kind: 'cancel',
      error: {
        code: 'PROXY_AUTH_FAILED',
        message:
          'Proxy authentication failed: proxy requested authentication again after credentials were supplied.',
      },
    });
    expect(decisionToBlockingResponse(decision)).toEqual({ cancel: true });
    expect(JSON.stringify(decision)).not.toContain('fixture-password');
  });
});

describe('ProxyAuthManager', () => {
  it('provides credentials once per request and signals a repeated challenge', () => {
    let now = 10_000;
    const manager = new ProxyAuthManager({ now: () => now });
    manager.setContext(context);

    expect(manager.handleChallenge(challenge()).kind).toBe(
      'provide-credentials',
    );

    now += 10;
    const repeated = manager.handleChallenge(challenge());
    expect(repeated.kind).toBe('cancel');

    const failure = manager.consumeRecentAuthFailure(
      'PROXY.EXAMPLE.TEST',
      8080,
      10_000,
    );
    expect(failure).toEqual({
      code: 'PROXY_AUTH_FAILED',
      message:
        'Proxy authentication failed: proxy requested authentication again after credentials were supplied.',
      host: 'proxy.example.test',
      port: 8080,
      occurredAt: 10_010,
    });
    expect(JSON.stringify(failure)).not.toContain('fixture-password');
    expect(
      manager.consumeRecentAuthFailure('proxy.example.test', 8080, 10_000),
    ).toBeNull();
  });

  it('provides credentials independently to different request IDs', () => {
    const manager = new ProxyAuthManager();
    manager.setContext(context);

    expect(manager.handleChallenge(challenge({ requestId: 'request-1' })).kind).toBe(
      'provide-credentials',
    );
    expect(manager.handleChallenge(challenge({ requestId: 'request-2' })).kind).toBe(
      'provide-credentials',
    );
  });

  it('resets the retry guard when context changes', () => {
    const manager = new ProxyAuthManager();
    manager.setContext(context);
    manager.handleChallenge(challenge());

    manager.setContext({
      ...context,
      username: 'replacement-fixture-user',
      password: 'replacement-fixture-password',
      source: 'temporary-test',
    });

    expect(manager.handleChallenge(challenge())).toMatchObject({
      kind: 'provide-credentials',
      authCredentials: {
        username: 'replacement-fixture-user',
        password: 'replacement-fixture-password',
      },
    });
  });

  it('does not reset the retry guard for the same context', () => {
    const manager = new ProxyAuthManager();
    manager.setContext(context);
    manager.handleChallenge(challenge());

    manager.setContext({ ...context });

    expect(manager.handleChallenge(challenge()).kind).toBe('cancel');
  });

  it('clears retry state when a request completes', () => {
    const manager = new ProxyAuthManager();
    manager.setContext(context);
    manager.handleChallenge(challenge());
    manager.clearRequest('request-1');

    expect(manager.handleChallenge(challenge()).kind).toBe(
      'provide-credentials',
    );
  });

  it('expires retry entries and auth failure signals', () => {
    let now = 1_000;
    const manager = new ProxyAuthManager({
      now: () => now,
      retryTtlMs: 100,
      failureTtlMs: 200,
    });
    manager.setContext(context);
    manager.handleChallenge(challenge());

    now = 1_101;
    expect(manager.handleChallenge(challenge()).kind).toBe(
      'provide-credentials',
    );
    expect(manager.handleChallenge(challenge()).kind).toBe('cancel');

    now = 1_302;
    expect(
      manager.consumeRecentAuthFailure('proxy.example.test', 8080, 1_000),
    ).toBeNull();
  });

  it('returns decoded special characters from parsed proxy credentials', () => {
    const parsed = parseProxyInput(
      'fixture%40corp.test:p%3Aa%25b@proxy.example.test:8080',
    );

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const manager = new ProxyAuthManager();
    manager.setContext(createProxyAuthContext(parsed.value, 'enabled-proxy'));

    expect(manager.handleChallenge(challenge())).toMatchObject({
      kind: 'provide-credentials',
      authCredentials: {
        username: 'fixture@corp.test',
        password: 'p:a%b',
      },
    });
  });

  it('retains no active context after clear', () => {
    const manager = new ProxyAuthManager();
    manager.setContext({ ...context, host: 'PROXY.EXAMPLE.TEST' });
    expect(manager.getContext()?.host).toBe('proxy.example.test');

    manager.clearContext();

    expect(manager.getContext()).toBeNull();
    expect(manager.handleChallenge(challenge())).toEqual({
      kind: 'ignore',
      reason: 'no-active-context',
    });
  });

  it('keeps a credential-free failure signal available after context cleanup', () => {
    const manager = new ProxyAuthManager();
    manager.setContext(context);
    manager.handleChallenge(challenge());
    manager.handleChallenge(challenge());
    manager.clearContext();

    const failure = manager.consumeRecentAuthFailure(
      'proxy.example.test',
      8080,
      0,
    );

    expect(failure?.code).toBe('PROXY_AUTH_FAILED');
    expect(JSON.stringify(failure)).not.toContain('fixture-password');
  });

  it('bounds retry state and evicts the oldest request', () => {
    const manager = new ProxyAuthManager({ maxRetryEntries: 2 });
    manager.setContext(context);
    manager.handleChallenge(challenge({ requestId: 'request-1' }));
    manager.handleChallenge(challenge({ requestId: 'request-2' }));
    manager.handleChallenge(challenge({ requestId: 'request-3' }));

    expect(manager.handleChallenge(challenge({ requestId: 'request-1' })).kind).toBe(
      'provide-credentials',
    );
    expect(manager.handleChallenge(challenge({ requestId: 'request-3' })).kind).toBe(
      'cancel',
    );
  });
});

function challenge(
  overrides: Partial<ProxyAuthChallenge> = {},
): ProxyAuthChallenge {
  return {
    requestId: 'request-1',
    isProxy: true,
    challenger: {
      host: 'proxy.example.test',
      port: 8080,
    },
    ...overrides,
  };
}
