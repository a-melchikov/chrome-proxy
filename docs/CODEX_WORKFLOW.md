# Workflow разработки через Codex

## Порядок

Выполняй строго по одному файлу:

1. `docs/codex/01-bootstrap.md`
2. `docs/codex/02-domain-storage-parsers.md`
3. `docs/codex/03-proxy-config-engine.md`
4. `docs/codex/04-authentication.md`
5. `docs/codex/05-background-orchestration.md`
6. `docs/codex/06-connection-test.md`
7. `docs/codex/07-popup-core-ui.md`
8. `docs/codex/08-rules-current-site.md`
9. `docs/codex/09-toolbar-runtime-polish.md`
10. `docs/codex/10-final-validation.md`

Не отправляй все десять одновременно.

После каждого этапа:

1. прочитай отчёт Codex;
2. убедись, что `pnpm test`, `pnpm typecheck`, `pnpm build` прошли либо есть реальный blocker;
3. посмотри `git diff`;
4. только затем переходи дальше.

## Что писать Codex

Первый этап:

```text
Выполни задачу из docs/codex/01-bootstrap.md.
Работай непосредственно в текущем репозитории.
Соблюдай AGENTS.md, docs/REQUIREMENTS.md и docs/ARCHITECTURE.md.
Реализуй изменения, запусти указанные проверки и в конце дай отчёт в формате из AGENTS.md.
Не переходи к следующим prompt.
```

Для следующего этапа меняется имя файла:

```text
Выполни задачу из docs/codex/02-domain-storage-parsers.md.
Сначала проверь текущее состояние репозитория и результат предыдущего этапа.
Соблюдай AGENTS.md, docs/REQUIREMENTS.md и docs/ARCHITECTURE.md.
Реализуй изменения, запусти проверки и не выполняй следующие этапы заранее.
```

## Один чат или новый

Предпочтительно один Codex session на весь проект и один prompt за раз.

Если context стал слишком большим:

- открыть новый session из того же repository root;
- отправить следующий prompt;
- `AGENTS.md` и `docs/**` восстановят проектный контекст.

## Не просить только план

Эти десять файлов уже являются staged implementation plan.

Нужно писать `Выполни задачу...`, а не `Составь план...`.

## Проверка diff

После каждого этапа:

```bash
git status
git diff --stat
git diff
```

Красные флаги:

- реализованы будущие 2–3 этапа;
- добавлен Tailwind/крупный UI-kit;
- появился backend;
- WXT заменён;
- появилась Firefox support;
- используется `webRequestBlocking`;
- добавлен `DIRECT` fallback после `PROXY`;
- логируется полный proxy URL;
- React вызывает `browser.proxy.settings`;
- добавлен `<-loopback>`.

## Когда остановиться

Не переходить дальше, если:

- build падает;
- typecheck падает;
- тесты текущей логики падают;
- background ownership нарушен;
- Codex изменил product requirements;
- credentials могут утекать в console/log/error.

Исправление:

```text
Исправь проблемы текущего этапа, не переходя дальше:
1. ...
2. ...
После исправления повторно запусти test/typecheck/build.
```

## Manual test

До prompt 10 достаточно unit/build validation.

На prompt 10 понадобится настоящий proxy `login:password@host:port`.

Не добавляй реальные credentials в repository, `.env`, fixtures или screenshots.

## Сборка

Production output WXT обычно:

```text
.output/chrome-mv3
```

Development output актуального WXT может быть:

```text
.output/chrome-mv3-dev
```

На финальном этапе проверить фактический путь.

Установка:

```text
chrome://extensions
Developer mode
Load unpacked
```

## Git

Рекомендуемый старт:

```bash
git init
git add AGENTS.md docs
git commit -m "docs: add chrome proxy implementation plan"
```

После каждого успешного этапа можно делать commit самостоятельно. Codex не должен коммитить без отдельного запроса.

## Конечный критерий

После prompt 10:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

должны проходить, после чего `.output/chrome-mv3` можно загрузить в Chrome и пройти manual checklist.
