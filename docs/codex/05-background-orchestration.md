# Prompt 05 — Background orchestration, messaging и startup reconciliation

## Цель

Собрать core в реальный MV3 background service worker.

После этапа extension программно умеет:

- загрузить settings;
- включить/выключить proxy;
- применить all/bypass/allowlist;
- proxy auth;
- startup reconcile;
- authoritative state для popup;
- control-level handling.

Connection test — следующий prompt.

## 1. Background entrypoint

`defineBackground`.

`main` не async.

Внутри main:

- register message listener;
- auth listener;
- proxy onChange;
- запустить async initialize через `void ...catch`.

Никаких browser API на top-level.

## 2. Runtime service

Собери responsibilities в `ExtensionRuntime` или аналог:

```text
initialize
getState
updateSettings
reconcile
```

Dependencies:

- settings repository;
- ProxyController;
- AuthManager;
- runtime state;
- mutex.

## 3. Mutex

Простой local serial executor без dependency.

Через него идут proxy-affecting operations.

## 4. Initialization

Пока recovery hook может быть пустым, но sequence предусмотреть.

1. load settings;
2. get control;
3. if OFF -> clear auth, release own setting;
4. if ON -> parse/build/check/apply/auth;
5. update state.

Invalid persisted config:

- no active proxy;
- auth clear;
- safe runtime error.

## 5. Update transaction

Background повторно валидирует candidate.

Preferred:

```text
validate
mutex
persist desired settings
apply/reconcile
update runtime state
return authoritative state
```

Если valid desired ON сохраняется, но policy блокирует apply:

- desired `enabled=true` можно сохранить;
- `effectiveEnabled=false`;
- state содержит blocked error.

Invalid candidate не persist.

## 6. OFF

Только:

```ts
proxy.settings.clear({ scope: 'regular' })
```

Не `mode=direct`.

Auth clear.

## 7. Messaging

Typed messages:

```text
GET_STATE
UPDATE_SETTINGS
TEST_CONNECTION (зарезервировать)
```

Responses:

```ts
type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: SerializedAppError };
```

No stack/secrets.

## 8. ExtensionState

Пример:

```ts
interface ExtensionState {
  settings: ProxySettingsV1;
  effectiveEnabled: boolean;
  control: ProxyControlStatus;
  applyStatus: 'idle' | 'applied' | 'blocked' | 'error';
  lastError?: SerializedAppError;
}
```

Не возвращать parsed password отдельным полем.

## 9. proxy.settings.onChange

External changes:

- refresh control/effective state;
- lost control -> effective false;
- не устраивать бесконечный reapply fight.

Собственный set/clear event не должен создавать recursion.

## 10. Storage changes

Предпочтительно:

```text
popup -> message -> background validates/persists/applies
```

а не popup direct storage write.

Не добавлять double-apply storage listener без необходимости.

## 11. Auth integration

Successful owned enabled apply -> auth context.

OFF/blocked/invalid -> clear.

## 12. Startup idempotency

ChromeSetting может переживать service worker lifecycle.

Initialization не ломает already-correct owned setting.

Повторный set acceptable, если deterministic и control позволяет.

Desired:

```text
enabled=true -> active after restart
enabled=false -> extension releases control
```

## 13. Tests

1. fresh defaults -> OFF;
2. enabled all -> fixed set + auth;
3. bypass;
4. allowlist;
5. invalid persisted enabled -> no set;
6. invalid update -> no persist;
7. other extension controls -> desired saved/effective false;
8. OFF -> clear + auth clear;
9. external lost control -> effective false;
10. concurrent updates serial.

## Проверки

```bash
pnpm test
pnpm typecheck
pnpm build
```

В отчёте покажи state transition table для OFF, ON/owned, ON/blocked, invalid.
