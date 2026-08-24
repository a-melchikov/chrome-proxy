# Prompt 07 — Компактный popup: proxy, ON/OFF, mode, status и test

## Цель

Создать основной popup.

Пользователь должен:

- видеть authoritative/effective state;
- вводить proxy;
- включать/выключать;
- выбирать mode;
- запускать test;
- видеть latency/IP/error;
- понимать policy/other-extension conflict.

Rules textarea можно подключить базово; current-site финализируется prompt 08.

## 1. UX

Ширина около `340px`.

Не создавать:

- tabs/sidebar;
- nested cards;
- hero;
- gradients;
- onboarding;
- лишний whitespace.

Иерархия:

```text
Chrome Proxy                 toggle

Proxy
[ field                         eye ]

Режим
[ select ]

Rules area

Connection
status / latency / IP
[ Проверить ]
```

## 2. Initial state

На mount:

```text
GET_STATE
```

До ответа compact loading, без ложного ON.

Fresh install -> OFF, empty proxy, all.

Toggle disabled, пока proxy draft invalid.

## 3. Proxy input

Одно логическое поле.

Hidden summary:

```text
user:••••••@proxy.example.com:8000
```

Explicit eye reveal:

```text
user:p%40ss@proxy.example.com:8000
```

Никогда автоматически не раскрывать password при focus.

Допустим надёжный UX:

- unfocused hidden -> readonly masked summary;
- edit hidden -> `type=password`, вся строка скрыта;
- reveal -> `type=text`;
- blur -> partial masked summary.

Критично:

- bullets не становятся persisted value;
- raw encoded config не портится;
- eye имеет `aria-label`.

## 4. Proxy autosave

Typing:

- local draft;
- validate;
- invalid -> inline error, no UPDATE;
- old working proxy remains.

Valid:

- debounce ~300ms;
- send UPDATE_SETTINGS;
- authoritative response refreshes state.

При OFF valid config только сохраняется.

При ON background reapply.

Не делать auto connection test.

## 5. Toggle

ON:

- valid proxy required;
- no pending invalid draft;
- send `enabled=true`;
- не считать success до authoritative response.

Разделить desired и effective semantics.

OFF:

- `enabled=false`;
- background clear;
- authoritative OFF.

## 6. Mode

Options:

```text
Все сайты
Все, кроме списка
Только сайты из списка
```

OFF не является mode — toggle отдельный.

Mode auto-save.

При ON reapply, при OFF только persist.

## 7. Rules visibility

Mode all -> rules hidden, stored rules не удалять.

Bypass label:

```text
Не использовать proxy для
```

Allowlist:

```text
Использовать proxy только для
```

## 8. Connection

Button `Проверить`.

Disabled если:

- invalid proxy;
- test in progress;
- initial state loading.

During:

```text
Проверка…
```

Success:

```text
Подключено
230 ms
IP: 45.92.20.7
```

Можно label `Latency`, не `Ping`.

Error:

```text
Ошибка подключения
PROXY_AUTH_FAILED
Proxy authentication failed ...
```

No stack.

## 9. Control conflict

Other extension:

```text
Прокси контролируется другим расширением.
```

Policy/not controllable:

```text
Chrome не разрешает расширению изменять настройки прокси.
```

Не пытаться автоматически обходить policy.

## 10. Autosave races

Защититься от stale responses.

Пример request A/request B: поздний response A не должен overwrite B.

Использовать sequence id или serial mutation queue.

Без state library.

## 11. Accessibility

- labels;
- focus visible;
- aria-label eye/toggle;
- error associations;
- не только цвет.

## 12. CSS

- system font;
- controls ~30–36px;
- gaps 8–12px;
- moderate radius;
- no external fonts;
- textarea max-height later.

## 13. Tests

- loading -> state;
- invalid proxy -> no update;
- valid -> debounced update;
- masked UI does not expose password;
- explicit reveal;
- toggle disabled invalid;
- success result;
- error result;
- blocked control;
- stale response protection.

Не делать snapshot-heavy tests.

## Проверки

```bash
pnpm test
pnpm typecheck
pnpm build
```

Quick visual smoke можно сделать, но реальный proxy test не заявлять без credentials.
