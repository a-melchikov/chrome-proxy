# Chrome Proxy — архитектура MVP

## 1. Цель архитектуры

Расширение маленькое по UI, но `chrome.proxy` — глобальный browser setting. Поэтому главный принцип:

> React popup — UI-клиент. Background service worker — единственный владелец proxy state и всех proxy mutations.

Это предотвращает гонки между автосохранением, enable/disable, сменой режима, connection test, service worker restart, proxy auth и внешним изменением proxy другим extension/policy.

## 2. Ожидаемая структура

```text
chrome-proxy/
├── AGENTS.md
├── docs/
│   ├── REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── CODEX_WORKFLOW.md
│   ├── REFERENCES.md
│   └── codex/
├── entrypoints/
│   ├── background.ts
│   └── popup/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       └── style.css
├── src/
│   ├── proxy/
│   │   ├── parser.ts
│   │   ├── config.ts
│   │   ├── pac.ts
│   │   ├── auth.ts
│   │   ├── tester.ts
│   │   ├── controller.ts
│   │   └── errors.ts
│   ├── rules/
│   │   ├── parser.ts
│   │   ├── normalizer.ts
│   │   └── ipv4.ts
│   ├── storage/
│   │   ├── settings.ts
│   │   └── recovery.ts
│   ├── messaging/
│   │   └── protocol.ts
│   ├── runtime/
│   │   ├── state.ts
│   │   └── mutex.ts
│   └── ui/
├── public/
│   └── icons/
├── tests/
├── vitest.config.ts
├── wxt.config.ts
└── package.json
```

Названия можно немного корректировать, но границы ответственности сохранить.

## 3. Persisted settings

Один versioned object:

```ts
interface ProxySettingsV1 {
  version: 1;
  proxyInput: string;
  enabled: boolean;
  routingMode: 'all' | 'bypass' | 'allowlist';
  rulesText: string;
}
```

Default:

```ts
{
  version: 1,
  proxyInput: '',
  enabled: false,
  routingMode: 'all',
  rulesText: '',
}
```

Хранилище: `browser.storage.local`, ключ `settings`.

Не разносить основные поля по разным keys без необходимости.

### Invalid drafts

Popup может временно содержать невалидный proxy/rules draft.

Невалидный draft:

- не заменяет persisted last-valid settings;
- не меняет Chrome proxy;
- может потеряться при закрытии popup — это допустимо для MVP.

## 4. Parsed proxy

Pure parser:

```ts
interface ParsedProxy {
  username: string;
  password: string;
  host: string;
  port: number;
  scheme: 'http';
}
```

Не сохранять `ParsedProxy` отдельно. Источник истины:

```text
proxyInput -> parseProxyInput() -> ParsedProxy
```

Практичный parsing pipeline:

1. reject input со scheme;
2. `new URL('http://' + input)`;
3. проверить обязательные поля;
4. явно декодировать username/password;
5. проверить malformed encoding;
6. reject IPv6;
7. проверить host/port product constraints.

Нельзя полагаться только на permissive URL parser.

## 5. Rule model

После normalization:

```ts
type Rule =
  | { type: 'hostname'; value: string }
  | { type: 'ipv4'; value: string }
  | { type: 'cidr'; network: string; prefix: number };
```

`localhost` — hostname.

`*.example.com` канонизируется к `example.com`.

Семантика matcher:

```text
host === example.com
OR host заканчивается на ".example.com"
```

CIDR только IPv4.

## 6. Chrome config generation

### All

```ts
{
  mode: 'fixed_servers',
  rules: {
    singleProxy: {
      scheme: 'http',
      host,
      port,
    },
  },
}
```

### Bypass

Тот же `singleProxy` + `bypassList`.

Для `example.com` генерируются:

```text
example.com
*.example.com
```

IP/CIDR передаются в поддерживаемом Chrome формате.

Не добавлять `<-loopback>`.

### Allowlist PAC

Self-contained PAC:

```js
function FindProxyForURL(url, host) {
  if (/* user rule matches */) {
    return "PROXY proxy.example.com:8000";
  }
  return "DIRECT";
}
```

Инварианты:

- credentials отсутствуют;
- `mandatory: true`;
- match hostname exact + subdomains;
- IPv4 exact;
- IPv4 CIDR;
- generated literals safe-escaped;
- proxied branch не возвращает `; DIRECT`.

## 7. Background components

### ProxyController

Владеет:

- apply;
- disable;
- control state;
- startup reconcile;
- temporary test mutation;
- proxy-setting change events.

Любой `settings.set/clear` проходит через controller/adapter.

### Async mutex

Сериализовать:

```text
enable
disable
settings update
temporary test
startup recovery
```

Async JS операции могут interleave, поэтому lock обязателен.

### AuthManager

Хранит только runtime context активного proxy:

```ts
interface ProxyAuthContext {
  host: string;
  port: number;
  username: string;
  password: string;
  source: 'enabled-proxy' | 'temporary-test';
}
```

Проверки challenge:

- `isProxy`;
- host;
- port;
- context exists.

Retry guard ограничивает повторную отправку credentials одного `requestId`.

## 8. Messaging

Typed discriminated union:

```ts
type RequestMessage =
  | { type: 'GET_STATE' }
  | { type: 'UPDATE_SETTINGS'; settings: ProxySettingsV1 }
  | { type: 'TEST_CONNECTION' };
```

Response:

```ts
type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: SerializedAppError };
```

Popup не должен выводить sensitive stack/details.

## 9. Extension state

Пример:

```ts
interface ExtensionState {
  settings: ProxySettingsV1;
  effectiveEnabled: boolean;
  control: ProxyControlStatus;
  applyStatus: 'idle' | 'applied' | 'blocked' | 'error';
  testInProgress: boolean;
  lastError?: SerializedAppError;
}
```

`effectiveEnabled` — не копия `settings.enabled`; он отражает фактическое применение и control level.

## 10. Background initialization

WXT entrypoint:

```ts
export default defineBackground(() => {
  // register listeners
  void initialize().catch(handleInitError);
});
```

`main` не `async`.

Порядок после появления recovery:

1. register listeners;
2. read recovery marker;
3. cleanup temporary proxy if needed;
4. load settings;
5. reconcile desired state;
6. update auth context;
7. update toolbar.

## 11. OFF connection test recovery

Durable marker:

```ts
interface ProxyTestRecoveryMarker {
  version: 1;
  active: true;
  startedAt: number;
  restoreAction: 'clear';
}
```

Порядок:

```text
write marker
set temporary proxy
set temporary auth context
fetch ipify
finally:
  clear auth context
  clear proxy
  delete marker after successful cleanup
```

Startup:

```text
marker exists
-> clear own temporary setting
-> delete marker
-> normal reconcile desired settings
```

Не «восстанавливать» effective config другого extension через `set(value)`. OFF restore — убрать собственную temporary setting через `clear`.

## 12. Connection test

Result:

```ts
interface ConnectionTestResult {
  ok: boolean;
  latencyMs?: number;
  ip?: string;
  error?: {
    code:
      | 'TIMEOUT'
      | 'PROXY_AUTH_FAILED'
      | 'PROXY_NOT_CONFIGURED'
      | 'PROXY_NOT_CONTROLLABLE'
      | 'NETWORK_ERROR'
      | 'INVALID_RESPONSE'
      | 'UNKNOWN';
    message: string;
  };
}
```

Fetch:

- `https://api.ipify.org?format=json`;
- `cache: 'no-store'`;
- AbortController 5 s;
- validate JSON;
- HTTP latency вокруг request.

## 13. Control state

Map Chrome `levelOfControl`:

```ts
type ProxyControlStatus =
  | 'available'
  | 'owned'
  | 'controlled-by-other-extension'
  | 'not-controllable';
```

Не скрывать set/clear errors.

## 14. Popup model

Popup имеет:

- authoritative server state;
- local proxy draft;
- local rules draft;
- validation errors;
- reveal state;
- test loading/result.

Flow:

```text
valid local draft
-> UPDATE_SETTINGS
-> background revalidates
-> persist
-> apply/reconcile
-> authoritative response
```

Background повторно валидирует всё.

## 15. Current site

Предпочтительно `activeTab`.

Popup:

```ts
browser.tabs.query({ active: true, currentWindow: true })
```

Разрешить только `http:`/`https:` и непустой hostname.

Добавлять exact current hostname.

## 16. Toolbar

OFF:

- off icon;
- badge empty.

ON:

- on icon;
- badge `ON`.

Requested ON but blocked:

- warning/error icon;
- badge `!`.

Static local PNG assets.

## 17. Security model

Основные риски:

1. credentials в `storage.local`;
2. broad host permission для proxy auth;
3. temporary global proxy во время OFF test;
4. proxy server видит traffic metadata;
5. implicit localhost bypass.

Mitigations:

- no credential logging;
- auth только `isProxy + host + port`;
- recovery marker;
- mutex;
- 5 s timeout;
- no `PROXY; DIRECT`;
- no remote code;
- no telemetry.

## 18. Testing strategy

Pure modules — полноценные unit tests.

Browser-dependent orchestration — injected adapters. Если WXT fake browser не реализует `proxy`, не ломать архитектуру ради mock: тестировать controller через fake adapter.

Финал обязательно включает manual Chrome smoke test с реальным proxy.
