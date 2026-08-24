# Prompt 04 — Безопасная proxy authentication через onAuthRequired

## Цель

Реализовать auth subsystem Manifest V3:

- `webRequest.onAuthRequired`;
- `webRequestAuthProvider`;
- credentials только нужному proxy;
- no credentials to websites;
- retry guard;
- signal для connection tester;
- no secret logging.

## 1. Manifest audit

Должны быть:

```text
webRequest
webRequestAuthProvider
<all_urls>
```

Не должно быть `webRequestBlocking`.

## 2. Auth context

Runtime API:

```ts
interface ProxyAuthContext {
  host: string;
  port: number;
  username: string;
  password: string;
  source: 'enabled-proxy' | 'temporary-test';
}
```

Методы:

```text
setContext
clearContext
getContext
```

Не дублировать credentials в отдельном persistent storage.

## 3. Listener helper

Подготовить:

```text
registerProxyAuthHandler(...)
```

Фактическая регистрация внутри WXT background main.

Использовать auth-provider-compatible blocking mode, предпочтительно `asyncBlocking`, если текущие typings поддерживают.

Не добавлять `webRequestBlocking`.

## 4. Challenge filtering

Credentials только если:

```text
details.isProxy === true
context exists
challenger.host == context.host
challenger.port == context.port
```

Host compare canonical/lowercase.

Site `WWW-Authenticate` -> no credentials.

Host/port mismatch -> no credentials.

## 5. Retry guard

Bounded state по `requestId`.

Semantics:

```text
first challenge -> credentials
second+ same request/context -> stop/cancel, mark auth failure
```

Очистка TTL 30–60 seconds или completion/error events.

Map не растёт бесконечно.

При смене auth context старые retry entries сбрасываются.

## 6. Auth failure signal

Connection tester должен отличать вероятный wrong password от generic fetch failure.

API типа:

```text
consumeRecentAuthFailure(host, port, since)
```

Repeated proxy challenge создаёт short-lived signal без credentials.

Message:

```text
Proxy authentication failed: proxy requested authentication again after credentials were supplied.
```

Не обещать HTTP 407, если tester его не получил.

## 7. Context lifecycle

Enabled + applied -> active context.

OFF -> null.

OFF temporary test -> temporary context.

Cleanup -> null / затем normal reconcile может восстановить enabled context.

Если desired ON blocked by other extension — не активировать credentials context как будто proxy наш.

## 8. Logging

Никаких username/password/proxyInput/Auth header.

Допустимо логировать только safe reason.

## 9. Tests

Core decision function:

1. `isProxy=false`;
2. no context;
3. host mismatch;
4. port mismatch;
5. exact first -> credentials;
6. repeat requestId -> failure;
7. different requestId -> credentials;
8. context switch resets guard;
9. decoded special chars returned correctly;
10. serialized errors no password.

## Проверки

```bash
pnpm test
pnpm typecheck
pnpm build
```

В отчёте: listener mode, retry limit, подтверждение no `webRequestBlocking` и no credentials to WWW-Authenticate.
