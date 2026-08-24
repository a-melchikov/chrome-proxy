# Prompt 08 — Rules textarea, normalization и «Текущий сайт»

## Цель

Полный site-routing UX:

- textarea;
- line errors;
- normalization;
- invalid draft не ломает active config;
- current hostname одной кнопкой.

## 1. Mode UI

`all`:

- textarea hidden;
- stored rules retained.

`bypass` label:

```text
Не использовать proxy для
```

`allowlist`:

```text
Использовать proxy только для
```

Helper:

```text
Одна запись на строку: hostname, IPv4 или IPv4 CIDR.
example.com включает сам домен и его поддомены.
```

Компактно.

## 2. Draft/debounce

Каждое изменение:

1. local draft;
2. debounce 300–500ms;
3. parse all;
4. invalid -> no UPDATE, show errors, old config remains;
5. valid -> canonical normalized text;
6. UPDATE_SETTINGS;
7. success -> textarea gets canonical text.

Не нормализовать на каждый keypress так, чтобы прыгал cursor.

## 3. Errors

Примеры:

```text
Строка 2: URL не поддерживается; укажи только hostname.
Строка 4: IPv4 CIDR prefix должен быть 0..32.
```

Можно показывать первые 3 + count остальных.

No silent ignore.

## 4. Current site

Показывать только bypass/allowlist.

Button:

```text
+ Текущий сайт
```

Click:

```ts
browser.tabs.query({ active: true, currentWindow: true })
```

Использовать `activeTab`, если достаточно.

Разрешить только `http:` и `https:`.

Добавить `new URL(tab.url).hostname.toLowerCase()`.

Пример:

```text
https://Docs.GitHub.com/en/rest?q=1
```

-> `docs.github.com`.

Не брать path.

Не вычислять eTLD+1.

## 5. Unsupported tab

`chrome://`, `file://`, `about:` -> понятная ошибка:

```text
Текущую вкладку нельзя добавить: нет HTTP/HTTPS hostname.
```

Не просить broad permission сверх необходимого.

## 6. Dedup semantics

Current hostname добавляется в local draft и проходит тот же parser.

`github.com` + current `github.com` -> no duplicate.

`*.github.com` normalized `github.com` -> no duplicate.

`docs.github.com` и `api.github.com` -> разные rules.

## 7. Loopback warning

Allowlist содержит localhost/127/8/169.254/16 -> non-blocking warning:

```text
Chrome может обходить proxy для localhost/link-local адресов независимо от PAC.
```

Rules valid.

Не использовать `<-loopback>`.

## 8. Empty allowlist

Valid, warning:

```text
Список пуст — все сайты будут открываться напрямую.
```

Не менять mode автоматически.

## 9. Empty bypass

Valid. Не менять mode.

## 10. Tests

1. valid canonicalization;
2. invalid URL -> no update;
3. line number;
4. wildcard canonicalization;
5. dedupe;
6. current HTTPS host;
7. duplicate current;
8. chrome:// reject;
9. button hidden in all;
10. empty allowlist warning;
11. loopback warning;
12. old authoritative rules survive invalid draft.

Mock tabs query through WXT fake browser/helper.

## 11. Permission audit

Подтверди, что `activeTab` хватает для popup user gesture.

Если реально нужен `tabs`, проверь официальный Chrome docs/runtime и объясни добавление. Не добавляй заранее.

## Проверки

```bash
pnpm test
pnpm typecheck
pnpm build
```

В отчёте укажи final permission decision.
