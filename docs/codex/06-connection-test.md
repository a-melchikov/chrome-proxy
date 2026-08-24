# Prompt 06 — Connection tester, HTTP latency, external IP и OFF recovery

## Цель

Реализовать production-safe проверку proxy.

Endpoint:

```text
https://api.ipify.org?format=json
```

Timeout:

```text
5000 ms
```

UI пока не обязателен; background `TEST_CONNECTION` должен работать полностью.

## 1. Result model

Typed result:

```ts
interface ConnectionTestSuccess {
  ok: true;
  latencyMs: number;
  ip: string;
}

interface ConnectionTestFailure {
  ok: false;
  error: {
    code:
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
    message: string;
  };
}
```

Можно встроить в общий AppError contract.

## 2. Fetch

Использовать:

- `fetch('https://api.ipify.org?format=json')`;
- `cache: 'no-store'`;
- AbortController;
- 5000ms timeout;
- `performance.now()` для latency;
- validate `response.ok`;
- parse JSON;
- validate non-empty string `ip`.

Latency округлить до целого >= 0.

В коде/README называть latency, не ICMP ping.

## 3. Test при enabled=true

Если desired ON и effective proxy owned/applied:

- не менять proxy setting;
- auth context должен быть активен;
- выполнить fetch.

Если desired ON, но setting контролируется другим extension/policy:

- не делать fetch как будто это наш proxy;
- вернуть control error.

Если state stale — refresh/reconcile перед test.

## 4. Test при enabled=false

### Preconditions

- сохранённый `proxyInput` валиден;
- control позволяет temporary set;
- user routing mode/rules для test не важны: тестируем сам proxy.

### Temporary config

Использовать `fixed_servers + singleProxy`, без bypass/PAC.

Никакого `DIRECT` fallback.

### Recovery marker

До `proxy.settings.set` записать в `storage.local`:

```ts
{
  version: 1,
  active: true,
  startedAt: Date.now(),
  restoreAction: 'clear'
}
```

Отдельный key, например `proxyTestRecovery`.

Credentials в marker не хранить.

### Exact sequence

Под общим mutex:

```text
validate
check control
write recovery marker
set temporary proxy
set temporary auth context
fetch
finally:
  clear temporary auth context
  clear proxy setting
  delete recovery marker only after successful cleanup
  refresh runtime state
```

Если clear cleanup упал:

- marker оставить;
- state/error `RECOVERY_FAILED`;
- не заявлять, что OFF восстановлен.

## 5. Startup recovery

Изменить initialization:

```text
register listeners
read recovery marker
if marker:
  mutex
  cleanup temporary own proxy
  remove marker only after successful cleanup
load desired settings
normal reconcile
```

Если desired сейчас ON:

```text
cleanup temp
then apply desired ON config
```

Не восстанавливать effective config другого extension через `set(value)`.

OFF restore semantics — убрать собственное temporary control через `clear`.

## 6. Auth failure detection

Перед fetch запомнить test start time + host/port.

Если fetch упал и AuthManager сообщает repeated proxy challenge после start:

```text
PROXY_AUTH_FAILED
```

Иначе:

- AbortError -> TIMEOUT;
- generic fetch -> NETWORK_ERROR.

Не мапить любой `Failed to fetch` в auth error.

## 7. Concurrency

Одновременно один test.

`TEST_CONNECTION` во время active test -> `TEST_ALREADY_RUNNING` или reuse same promise. Второй temporary mutation запрещён.

UPDATE_SETTINGS/enable/disable во время OFF test должны быть serialized и выполниться только после cleanup.

Runtime содержит `testInProgress`.

## 8. Messaging

Реализовать `TEST_CONNECTION`.

Response без stack/secrets.

Connection result можно не persist; recovery marker persist обязателен.

## 9. Tests

### Enabled

- ON -> no set/clear;
- success -> IP + latency;
- timeout;
- malformed response;
- auth signal;
- blocked control -> no fetch.

### Disabled

Проверить порядок:

```text
marker write
temp set
auth set
fetch
auth clear
proxy clear
marker remove
```

И `finally` при network fail/timeout/invalid JSON/throw.

Marker остаётся при failed cleanup.

### Recovery

- marker + OFF -> clear;
- marker + ON -> clear then desired set;
- no marker -> no recovery clear.

### Concurrency

- two tests -> one;
- update waits until cleanup.

## Проверки

```bash
pnpm test
pnpm typecheck
pnpm build
```

В отчёте: cleanup order, error mapping, auth failure detection, recovery key.
