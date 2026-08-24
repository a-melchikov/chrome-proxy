# Prompt 09 — Toolbar icons/badge, runtime polish и edge cases

## Цель

Довести runtime UX:

- toolbar показывает state;
- ON/OFF/error различимы;
- service worker restart устойчив;
- external proxy control отражается;
- static PNG icons;
- popup остаётся compact.

## 1. Toolbar mapping

Effective OFF:

- off icon;
- badge empty;
- title `Chrome Proxy — Off`.

Effective ON:

- on icon;
- badge `ON`;
- title `Chrome Proxy — On`.

Requested ON but blocked/error:

- error/warning icon;
- badge `!`;
- title без host/login.

## 2. Icon assets

Static PNG:

```text
16
32
48
128
```

Наборы:

```text
icon-off-*
icon-on-*
icon-error-*
```

Один простой symbol, визуально разные states.

No remote images.

Если binary generation неудобна, создай deterministic dev script и запусти его. Маленькая dev-only image package допустима, если не попадает runtime bundle.

Generated PNG должны существовать после clean checkout/install/build.

## 3. WXT manifest/action

Настроить default icons через WXT.

После build проверить paths generated manifest.

Runtime `action.setIcon` использует local paths.

## 4. Badge/title

Использовать:

```text
browser.action.setBadgeText
browser.action.setTitle
browser.action.setIcon
```

Toolbar error не должен ломать proxy initialization — это projection state.

## 5. Sync points

Обновлять toolbar после:

- initialization;
- settings apply;
- ON/OFF;
- test cleanup;
- proxy.settings.onChange.

Не хранить отдельный источник истины `toolbarEnabled`.

## 6. Service worker restart

Проверить, что после restart:

- settings из storage;
- auth context восстанавливается для owned ON;
- runtime state recomputed;
- toolbar restored;
- recovery marker handled;
- ephemeral retry/test memory может быть пустой.

## 7. External control

Если другое extension/policy забирает control:

- effective false;
- auth context clear;
- toolbar `!`;
- popup desired ON + control error;
- no aggressive infinite reapply loop.

Если control возвращается, выбери deterministic behavior: один safe reconcile при transition либо wait user/startup. Не допускай event recursion.

## 8. Incognito

Не пытаться включить `Allow in Incognito` программно.

Проверить manifest incognito behavior.

## 9. Error leakage audit

Все user-visible errors:

- no password;
- no raw proxyInput;
- no stack in popup;
- no credentials in title/badge/log.

Добавить regression test с fake known password.

## 10. UI edge cases

Проверить:

- long username;
- long hostname;
- 100+ rules;
- long errors;
- 320px width.

Textarea max-height + scroll.

## 11. Performance

- no PAC regeneration on each React render;
- no polling GET_STATE;
- no background interval.

## 12. Tests

- toolbar OFF/ON/error;
- no secret title;
- startup refresh;
- lost control;
- recovery completion;
- long values no crash/layout-state issue.

Если fake browser не поддерживает action — injected adapter.

## 13. Build inspection

Проверить:

- generated manifest icon paths;
- PNG exist in output;
- permissions не расширились;
- no remote code.

## Проверки

```bash
pnpm test
pnpm typecheck
pnpm build
```

В отчёте перечисли toolbar mapping и icon files.
