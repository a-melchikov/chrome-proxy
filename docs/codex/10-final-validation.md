# Prompt 10 — Финальный review, hardening, README и manual test checklist

## Роль

Не переписывай проект с нуля.

Сначала senior-level review против:

- `AGENTS.md`;
- `docs/REQUIREMENTS.md`;
- `docs/ARCHITECTURE.md`.

Затем исправь реальные дефекты MVP.

## 1. Requirement audit

Проверить каждый блок.

### Proxy

- один proxy;
- `login:password@host:port`;
- IPv4 + hostname;
- encoded credentials;
- IPv6 reject;
- port.

### States

- default OFF;
- all;
- bypass;
- allowlist;
- restart persistence.

### OFF

- `proxy.settings.clear`;
- no permanent direct mode.

### Fail closed

- no DIRECT fallback for proxied branch;
- PAC matched branch only `PROXY`;
- `mandatory=true`.

### Rules

- textarea;
- normalization;
- line errors;
- domain + subdomains;
- IP/CIDR;
- current site;
- URL/port reject.

### Auth

- `webRequestAuthProvider`;
- isProxy;
- host/port;
- retry guard;
- no site credential leak.

### Test

- ipify;
- 5s;
- latency;
- IP;
- ON;
- temporary OFF;
- recovery;
- mutex.

### Control

- policy;
- other extension.

### UI

- compact;
- masking/reveal;
- autosave;
- toolbar.

### Incognito

- documented manual enable.

## 2. Security audit

Запустить:

```bash
rg -n "password|proxyInput|console\.|logger|Authorization|authCredentials" .
```

Проверить:

- no credential logs;
- fixtures fake;
- README no secret;
- PAC no credentials;
- safe errors;
- no remote code;
- no eval/new Function from user input;
- safe PAC escaping.

Dependencies:

- no accidental heavy runtime libs;
- no unused;
- icon tooling dev-only.

## 3. Race audit

Проверить:

1. OFF test + user enable;
2. OFF test + proxy change;
3. rapid mode;
4. rapid valid proxy edits;
5. popup closes during test;
6. service worker restart with marker;
7. control lost during/after apply.

Все mutations serial, cleanup in finally.

## 4. Parser edge tests

Proxy:

```text
u:p@host:1
u:p@host:65535
u:p@host:65536
u:p@001.002.003.004:8000
u:p@localhost:8000
u:p@a.b.example.com:8000
u%40x:p%253A@proxy.example.com:8000
```

Leading-zero IPv4: strict deterministic accept/reject, покрыть test.

Rules:

```text
example.com
EXAMPLE.COM
*.example.com
example.com.
0.0.0.0/0
10.1.2.3/8
127.0.0.1
169.254.1.1
```

Trailing-dot hostname deterministic canonicalize/reject.

## 5. Automated validation

Обязательно:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm zip
```

Если lint уже есть — выполнить.

Открыть production generated manifest.

## 6. README.md

Создать пользовательский README.

Разделы:

- Chrome Proxy;
- возможности;
- требования;
- установка dev;
- production build;
- Load unpacked;
- proxy format с fake example;
- URL encoding example;
- modes;
- connection test;
- Incognito;
- security note storage.local;
- localhost/PAC limitation;
- development commands.

Явно написать:

```text
Latency — время HTTPS-запроса, не ICMP ping.
```

README не должен дублировать архитектуру полностью.

## 7. docs/MANUAL_TEST.md

Создать checklist.

Не отмечать выполненными пункты, требующие real credentials, если их нет.

### Install

- Load unpacked;
- popup;
- no manifest errors;
- service worker no errors.

### Invalid input

- invalid proxy;
- ON unavailable;
- special encoding.

### All mode

С real proxy:

- enter;
- ON;
- external IP becomes proxy IP;
- HTTPS opens;
- toolbar ON.

### Auth failure

- wrong password;
- test shows truthful auth/network error;
- no infinite loop/dialog.

### Bypass

- bypass site direct;
- other site proxy.

### Allowlist

- listed proxy;
- unlisted direct;
- unreachable proxy does not direct fallback on listed.

### Current site

- add HTTP(S);
- duplicate;
- chrome:// reject.

### OFF

- release setting;
- default/system network returns.

### OFF test

- press Check while OFF;
- receive latency/IP;
- after test remains OFF;
- no lingering proxy.

### Recovery

- simulate marker/interruption if practical;
- service worker reload cleans temp.

### Control conflict

- second proxy extension/policy if safe test profile available.

### Incognito

- user enables Allow in Incognito;
- verify.

### Restart

- ON persists;
- OFF persists;
- toolbar restored.

## 8. No fake manual success

Если real proxy отсутствует, написать:

```text
Automated validation passed.
Manual proxy smoke tests are prepared but not executed because no proxy credentials were supplied to the environment.
```

## 9. Architecture grep

```bash
rg -n "proxy\.settings\.(set|clear)" .
```

Ожидать только adapter/controller/background infrastructure.

```bash
rg -n "onAuthRequired|authCredentials" .
```

Проверить isProxy/host/port.

## 10. Cleanup

Удалить:

- starter demo;
- dead code;
- completed TODO;
- debug sensitive logs;
- unused imports/deps.

## Финальный отчёт

1. найдено/исправлено;
2. ключевая структура;
3. results test/typecheck/build/zip;
4. automated coverage;
5. реально выполненные manual checks;
6. manual checks, требующие пользователя;
7. known limitations;
8. exact Load unpacked path.
