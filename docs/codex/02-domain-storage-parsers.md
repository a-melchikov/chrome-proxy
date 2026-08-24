# Prompt 02 — Domain model, storage и parsers

## Цель

Создать типизированный core без React:

- persisted settings;
- runtime validation/defaults;
- storage repository;
- proxy parser;
- safe masking;
- rules parser/normalizer;
- IPv4/CIDR utilities;
- error contract;
- unit tests.

Не реализовывать Chrome proxy mutations, PAC и auth.

## 1. Settings

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

Данные из storage runtime-валидируются.

Повреждённый stored object не должен приводить к включению proxy.

## 2. Storage repository

Реализовать:

```text
loadSettings()
saveSettings()
updateSettings()
```

через `browser.storage.local`, ключ `settings`.

Не логировать `proxyInput`.

`setAccessLevel(TRUSTED_CONTEXTS)` можно добавить как hardening, если typings/runtime позволяют без усложнения.

## 3. Error contract

Стабильные codes, например:

```text
INVALID_PROXY_FORMAT
INVALID_PROXY_USERNAME
INVALID_PROXY_PASSWORD
INVALID_PROXY_HOST
INVALID_PROXY_PORT
INVALID_PROXY_ENCODING
INVALID_RULE
```

Safe message не содержит raw password/full proxy URL.

## 4. Proxy parser

Input:

```text
login:password@host:port
```

Success:

```text
user:pass@45.92.20.7:8000
user:p%40ss@proxy.example.com:3128
user%40corp.local:p%3Aa%25b@proxy.example.com:8080
```

Parsed:

```ts
{
  username: decodedUsername,
  password: decodedPassword,
  host: canonicalHost,
  port: number,
  scheme: 'http'
}
```

Reject:

```text
http://user:pass@host:8000
https://user:pass@host:8000
user@host:8000
:pass@host:8000
user:@host:8000
user:pass@:8000
user:pass@host
user:pass@host:0
user:pass@host:65536
user:pass@[2001:db8::1]:8000
user:p%ZZ@host:8000
```

Host:

- IPv4 или hostname;
- lowercase canonical;
- ASCII/Punycode если URL нормализует IDN;
- no whitespace/empty labels;
- no URL/path;
- IPv6 reject.

## 5. Masking

Pure helper:

```ts
maskProxyInput(raw): string
```

Пример:

```text
user:p%40ss@45.92.20.7:8000
```

->

```text
user:••••••@45.92.20.7:8000
```

Bullet representation никогда не сохраняется обратно.

Invalid raw masking не должен случайно раскрывать password area.

## 6. Rules parser

Input multiline.

Allow:

```text
example.com
*.example.com
localhost
127.0.0.1
192.168.0.0/16
```

Reject:

```text
https://example.com
example.com/path
example.com:443
192.168.0.1/33
192.168.999.1
2001:db8::1
hello world
```

Errors содержат original line number.

Если хотя бы одна строка invalid — no partial success.

## 7. Normalization

Input:

```text
 GitHub.COM

*.github.com
example.com
github.com
```

Result:

```text
github.com
example.com
```

Сохраняй order первого появления.

`*.example.com` semantic equivalent `example.com`.

## 8. IPv4/CIDR

Pure utilities:

- parse IPv4;
- validate prefix `0..32`;
- canonicalize network;
- prefix -> dotted mask.

`192.168.1.123/24` предпочтительно канонизировать к `192.168.1.0/24`.

## 9. Tests

Обязательно table-driven cases.

Proxy:

- IPv4;
- hostname;
- encoded @/:/%;
- scheme reject;
- missing user/password/port;
- port range;
- malformed encoding;
- IPv6 reject;
- path/query reject.

Mask:

- valid encoded password;
- invalid input;
- output не содержит known decoded password.

Rules:

- case;
- wildcard;
- dedupe;
- blank;
- line numbers;
- URL/port reject;
- IPv4;
- CIDR;
- invalid CIDR;
- IPv6.

Storage:

- defaults;
- roundtrip;
- malformed stored shape;
- invalid routing mode.

## Критерии

```bash
pnpm test
pnpm typecheck
pnpm build
```

Core parsers не импортируют React/browser APIs. Storage не содержит routing business logic.
