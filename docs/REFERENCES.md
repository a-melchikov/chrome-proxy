# Технические источники

Проверено при подготовке плана: 2026-08-24.

## Chrome Extensions

### Proxy API

https://developer.chrome.com/docs/extensions/reference/api/proxy

Ключевые моменты: `fixed_servers`, `singleProxy`, `bypassList`, `pac_script`, `PacScript.mandatory`, `proxy.settings.get/set/clear`.

### Chrome setting control level

https://developer.chrome.com/docs/extensions/reference/api/types

Значения: `not_controllable`, `controlled_by_other_extensions`, `controllable_by_this_extension`, `controlled_by_this_extension`.

### webRequest / onAuthRequired

https://developer.chrome.com/docs/extensions/reference/api/webRequest

Для MV3 proxy authentication:

- `webRequest`;
- `webRequestAuthProvider`;
- `onAuthRequired`;
- `details.isProxy`;
- `details.challenger.host`;
- `details.challenger.port`;
- auth-provider blocking/asyncBlocking mode.

Не использовать обычный `webRequestBlocking` permission для personal MV3 extension.

### Storage

https://developer.chrome.com/docs/extensions/reference/api/storage

`storage.local` не является криптографически защищённым password vault.

### Toolbar action

https://developer.chrome.com/docs/extensions/reference/api/action

Использовать `action.setIcon`, `action.setBadgeText`, `action.setTitle`.

### Tabs

https://developer.chrome.com/docs/extensions/reference/api/tabs

Для current-site action предпочитать `activeTab`, если он покрывает доступ к active tab URL после user gesture.

## Chromium proxy implementation notes

https://chromium.googlesource.com/chromium/src/+/main/net/docs/proxy.md

Важно:

- Chrome имеет implicit bypass для localhost/link-local;
- `<-loopback>` может отменять часть implicit manual bypass rules;
- PAC не может отменить implicit loopback bypass;
- в MVP `<-loopback>` намеренно не используется.

## WXT

Installation:

https://wxt.dev/guide/installation

CLI init:

https://wxt.dev/api/cli/wxt-init

Entrypoints:

https://wxt.dev/guide/essentials/entrypoints

Manifest:

https://wxt.dev/guide/essentials/config/manifest.html

Extension APIs:

https://wxt.dev/guide/essentials/extension-apis

Unit testing:

https://wxt.dev/guide/essentials/unit-testing

Использовать:

```ts
import { browser } from 'wxt/browser';
```

Vitest:

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
});
```

## Codex

AGENTS.md support:

https://github.com/openai/codex/blob/main/docs/agents_md.md

AGENTS.md implementation details:

https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs

General model guidance:

https://developers.openai.com/api/docs/guides/latest-model
