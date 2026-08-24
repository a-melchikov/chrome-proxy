# Prompt 01 — Bootstrap WXT/React/TypeScript проекта

## Перед началом

Прочитай `AGENTS.md`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/REFERENCES.md`.

Этот этап создаёт только технический фундамент. Не реализуй proxy engine, PAC, auth, connection test и полноценный popup.

## Цель

Получить чистый WXT + React + TypeScript + Manifest V3 проект, который:

- использует pnpm;
- таргетит Chrome;
- имеет background и popup entrypoints;
- содержит permissions, необходимые будущему MVP;
- имеет test/typecheck/build pipeline;
- успешно строится;
- не содержит лишнего starter demo.

## Исходное состояние

Repository уже может быть non-empty из-за `AGENTS.md` и `docs/**`.

Не удаляй их.

Если `wxt init .` отказывается работать, не обходи это удалением docs. Используй temporary directory:

```bash
pnpm dlx wxt@latest init <temp-dir> --template react --pm pnpm
```

Сверь реальный `--help`, если синтаксис изменился, и перенеси scaffold аккуратно.

## 1. package.json

Имя:

```text
chrome-proxy
```

Scripts как минимум:

```json
{
  "dev": "wxt",
  "build": "wxt build",
  "zip": "wxt zip",
  "postinstall": "wxt prepare",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
}
```

Если WXT starter требует слегка иной корректный typecheck — адаптируй, но `pnpm typecheck` обязан существовать.

Не добавлять Firefox scripts.

## 2. Vitest

Добавь `vitest.config.ts` через актуальный:

```ts
import { WxtVitest } from 'wxt/testing/vitest-plugin';
```

Добавь минимальный smoke unit test, чтобы `pnpm test` реально проверял pipeline.

Не реализуй product logic в smoke test.

## 3. WXT config / manifest

Название:

```text
Chrome Proxy
```

Описание короткое техническое.

Manifest V3 / Chrome.

Permissions:

```text
proxy
storage
webRequest
webRequestAuthProvider
activeTab
```

Host permissions:

```text
<all_urls>
```

Не добавлять:

```text
webRequestBlocking
tabs
declarativeNetRequest
scripting
```

без доказанной необходимости.

Задать incognito behavior, совместимый с наследованием `regular` settings, без отдельной split-config логики.

## 4. Entrypoints

Должны быть:

```text
entrypoints/background.ts
entrypoints/popup/index.html
entrypoints/popup/main.tsx
entrypoints/popup/App.tsx
entrypoints/popup/style.css
```

Background:

- `defineBackground`;
- никаких browser APIs на module top-level;
- только безопасный placeholder initialization;
- никаких credential logs.

Popup:

- монтирует React;
- показывает заголовок `Chrome Proxy` и нейтральный placeholder;
- ширина около 340px;
- не строить реальный settings UI.

## 5. Source skeleton

Допустимо создать каркас:

```text
src/proxy
src/rules
src/storage
src/messaging
src/runtime
src/ui
```

без fake future implementations.

## 6. TypeScript

Strict mode не ослаблять.

Не выключать type safety глобально.

## 7. Git ignore

Игнорировать:

```text
node_modules
.output
.wxt
coverage
```

и local browser profile artifacts, если они создаются.

Lockfile коммитится.

## 8. Generated manifest audit

После production build открыть generated `manifest.json`.

Проверить:

- `manifest_version = 3`;
- name;
- popup;
- background service worker;
- expected permissions;
- `<all_urls>`;
- отсутствует `webRequestBlocking`;
- нет Firefox-specific мусора.

Generated manifest вручную не редактировать.

## Критерии приёмки

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

должны пройти.

После этапа не должно быть:

- proxy parser;
- PAC;
- onAuthRequired logic;
- connection test;
- полноценного UI.

## Отчёт

Укажи:

- установленную версию WXT;
- production output path;
- фактический permissions list generated manifest;
- какие starter-файлы удалены.
