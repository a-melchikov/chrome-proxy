# Prompt 03 — Proxy configuration engine: fixed_servers, bypass и PAC

## Цель

Реализовать:

- mode -> Chrome ProxyConfig;
- all;
- bypass;
- allowlist PAC;
- control-level adapter;
- fail-closed semantics;
- unit tests.

Auth и connection test пока не делать.

## 1. Browser adapter

Тонкий adapter вокруг:

```text
browser.proxy.settings.get
browser.proxy.settings.set
browser.proxy.settings.clear
browser.proxy.settings.onChange
```

Чтобы controller можно было тестировать через fake adapter.

Browser calls не выполнять на import.

## 2. Control level

Map:

```text
not_controllable
controlled_by_other_extensions
controllable_by_this_extension
controlled_by_this_extension
```

Set разрешён только когда extension может владеть setting.

Errors:

```text
PROXY_NOT_CONTROLLABLE
PROXY_CONTROLLED_BY_OTHER_EXTENSION
```

## 3. All config

Exact shape:

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

Не использовать fallbackProxy, credentials, DIRECT.

## 4. Bypass config

`singleProxy` + `bypassList`.

`example.com` -> Chrome bypass entries:

```text
example.com
*.example.com
```

IP/CIDR — корректно.

Не добавлять `<-loopback>`.

Empty list допустим.

## 5. PAC generator

Pure:

```ts
generateAllowlistPac(parsedProxy, normalizedRules): string
```

Config:

```ts
{
  mode: 'pac_script',
  pacScript: {
    data,
    mandatory: true,
  },
}
```

Proxy return:

```text
PROXY host:port
```

Никаких credentials и `; DIRECT`.

Hostname rule:

```text
example.com
```

match exact + arbitrary subdomains, но не `notexample.com` и не `example.com.evil.org`.

IPv4 exact.

CIDR через PAC-compatible `isInNet(host, network, dottedMask)` или проверенный эквивалент.

Empty allowlist -> `DIRECT`.

User-derived literals безопасно сериализовать.

## 6. Loopback warning metadata

Не пытаться обойти Chrome implicit bypass.

Добавить helper, выявляющий potential loopback/link-local allowlist rules:

- localhost;
- 127/8;
- 169.254/16.

Это warning, не validation error.

## 7. Desired state builder

API:

```ts
type DesiredProxyState =
  | { kind: 'disabled' }
  | { kind: 'configured'; config: ProxyConfig; parsedProxy: ParsedProxy; warnings: ... };
```

`enabled=true` + invalid proxy/rules -> typed error, не DIRECT.

## 8. Controller primitives

Минимум:

```text
applyDesiredSettings()
disable()
getControlState()
```

Все mutations через adapter.

Temporary connection test ещё не делать.

## 9. Tests

All:

- exact shape.

Bypass:

- hostname exact + wildcard;
- IP/CIDR;
- dedupe;
- no `<-loopback>`.

PAC:

- mandatory true;
- no credentials;
- exact/subdomain/negative;
- IP;
- CIDR mask;
- empty -> DIRECT;
- proxied branch no `; DIRECT`;
- safe serialization.

Control:

- controllable/owned -> set;
- other/not controllable -> no set + error;
- disable -> clear.

## Проверки

```bash
pnpm test
pnpm typecheck
pnpm build
```

В отчёте покажи sample fixed config и PAC только с fake values.
