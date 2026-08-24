import type { AppError } from './errors';
import type { ParsedProxy } from './parser';
import { canonicalizeHost } from '../rules/hostname';

export type ProxyAuthContextSource = 'enabled-proxy' | 'temporary-test';

export interface ProxyAuthContext {
  host: string;
  port: number;
  username: string;
  password: string;
  source: ProxyAuthContextSource;
}

export interface ProxyAuthChallenge {
  requestId: string;
  isProxy: boolean;
  challenger: {
    host: string;
    port: number;
  };
}

export type ProxyAuthDecision =
  | {
      kind: 'ignore';
      reason:
        | 'not-proxy-authentication'
        | 'no-active-context'
        | 'proxy-host-mismatch'
        | 'proxy-port-mismatch';
    }
  | {
      kind: 'provide-credentials';
      authCredentials: {
        username: string;
        password: string;
      };
    }
  | {
      kind: 'cancel';
      error: AppError;
    };

export interface RecentProxyAuthFailure {
  code: 'PROXY_AUTH_FAILED';
  message: string;
  host: string;
  port: number;
  occurredAt: number;
}

export interface ProxyAuthContextStore {
  setContext(context: ProxyAuthContext): void;
  clearContext(): void;
  getContext(): ProxyAuthContext | null;
}

export interface ProxyAuthManagerOptions {
  now?: () => number;
  retryTtlMs?: number;
  failureTtlMs?: number;
  maxRetryEntries?: number;
  maxFailureEntries?: number;
}

export const DEFAULT_AUTH_RETRY_TTL_MS = 45_000;
export const DEFAULT_AUTH_FAILURE_TTL_MS = 60_000;
export const DEFAULT_MAX_AUTH_RETRY_ENTRIES = 1_000;
export const DEFAULT_MAX_AUTH_FAILURE_ENTRIES = 100;

const AUTH_FAILURE_MESSAGE =
  'Proxy authentication failed: proxy requested authentication again after credentials were supplied.';

export class ProxyAuthManager implements ProxyAuthContextStore {
  private context: ProxyAuthContext | null = null;

  private readonly attempts = new Map<string, number>();

  private readonly recentFailures = new Map<string, RecentProxyAuthFailure>();

  private readonly now: () => number;

  private readonly retryTtlMs: number;

  private readonly failureTtlMs: number;

  private readonly maxRetryEntries: number;

  private readonly maxFailureEntries: number;

  constructor(options: ProxyAuthManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.retryTtlMs = options.retryTtlMs ?? DEFAULT_AUTH_RETRY_TTL_MS;
    this.failureTtlMs =
      options.failureTtlMs ?? DEFAULT_AUTH_FAILURE_TTL_MS;
    this.maxRetryEntries =
      options.maxRetryEntries ?? DEFAULT_MAX_AUTH_RETRY_ENTRIES;
    this.maxFailureEntries =
      options.maxFailureEntries ?? DEFAULT_MAX_AUTH_FAILURE_ENTRIES;
  }

  setContext(context: ProxyAuthContext): void {
    const canonicalContext = canonicalizeContext(context);

    if (!contextsEqual(this.context, canonicalContext)) {
      this.attempts.clear();
    }

    this.context = canonicalContext;
  }

  clearContext(): void {
    this.context = null;
    this.attempts.clear();
  }

  getContext(): ProxyAuthContext | null {
    return this.context === null ? null : { ...this.context };
  }

  handleChallenge(challenge: ProxyAuthChallenge): ProxyAuthDecision {
    const now = this.now();
    this.pruneExpired(now);

    const alreadyAttempted = this.attempts.has(challenge.requestId);
    const decision = decideProxyAuthChallenge(
      challenge,
      this.context,
      alreadyAttempted,
    );

    if (decision.kind === 'provide-credentials') {
      this.addBounded(
        this.attempts,
        challenge.requestId,
        now,
        this.maxRetryEntries,
      );
    } else if (decision.kind === 'cancel' && this.context !== null) {
      const failure: RecentProxyAuthFailure = {
        code: 'PROXY_AUTH_FAILED',
        message: AUTH_FAILURE_MESSAGE,
        host: this.context.host,
        port: this.context.port,
        occurredAt: now,
      };

      this.addBounded(
        this.recentFailures,
        endpointKey(this.context.host, this.context.port),
        failure,
        this.maxFailureEntries,
      );
    }

    return decision;
  }

  clearRequest(requestId: string): void {
    this.attempts.delete(requestId);
  }

  consumeRecentAuthFailure(
    host: string,
    port: number,
    since: number,
  ): RecentProxyAuthFailure | null {
    const now = this.now();
    this.pruneExpired(now);
    const canonicalHost = normalizeHost(host);
    const key = endpointKey(canonicalHost, port);
    const failure = this.recentFailures.get(key);

    if (failure === undefined || failure.occurredAt < since) {
      return null;
    }

    this.recentFailures.delete(key);
    return { ...failure };
  }

  private pruneExpired(now: number): void {
    const retryCutoff = now - this.retryTtlMs;

    for (const [requestId, attemptedAt] of this.attempts) {
      if (attemptedAt < retryCutoff) {
        this.attempts.delete(requestId);
      }
    }

    const failureCutoff = now - this.failureTtlMs;

    for (const [key, failure] of this.recentFailures) {
      if (failure.occurredAt < failureCutoff) {
        this.recentFailures.delete(key);
      }
    }
  }

  private addBounded<K, V>(
    map: Map<K, V>,
    key: K,
    value: V,
    maximumSize: number,
  ): void {
    map.delete(key);

    while (map.size >= maximumSize) {
      const oldestKey = map.keys().next().value as K | undefined;

      if (oldestKey === undefined) {
        break;
      }

      map.delete(oldestKey);
    }

    map.set(key, value);
  }
}

export function createProxyAuthContext(
  proxy: ParsedProxy,
  source: ProxyAuthContextSource,
): ProxyAuthContext {
  return {
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
    source,
  };
}

export function decideProxyAuthChallenge(
  challenge: ProxyAuthChallenge,
  context: ProxyAuthContext | null,
  alreadyAttempted: boolean,
): ProxyAuthDecision {
  if (!challenge.isProxy) {
    return { kind: 'ignore', reason: 'not-proxy-authentication' };
  }

  if (context === null) {
    return { kind: 'ignore', reason: 'no-active-context' };
  }

  if (normalizeHost(challenge.challenger.host) !== normalizeHost(context.host)) {
    return { kind: 'ignore', reason: 'proxy-host-mismatch' };
  }

  if (challenge.challenger.port !== context.port) {
    return { kind: 'ignore', reason: 'proxy-port-mismatch' };
  }

  if (alreadyAttempted) {
    return {
      kind: 'cancel',
      error: {
        code: 'PROXY_AUTH_FAILED',
        message: AUTH_FAILURE_MESSAGE,
      },
    };
  }

  return {
    kind: 'provide-credentials',
    authCredentials: {
      username: context.username,
      password: context.password,
    },
  };
}

function canonicalizeContext(context: ProxyAuthContext): ProxyAuthContext {
  return {
    ...context,
    host: normalizeHost(context.host),
  };
}

function normalizeHost(host: string): string {
  return canonicalizeHost(host)?.value ?? host.toLowerCase();
}

function contextsEqual(
  left: ProxyAuthContext | null,
  right: ProxyAuthContext,
): boolean {
  return (
    left !== null &&
    left.host === right.host &&
    left.port === right.port &&
    left.username === right.username &&
    left.password === right.password &&
    left.source === right.source
  );
}

function endpointKey(host: string, port: number): string {
  return `${host}:${port}`;
}
