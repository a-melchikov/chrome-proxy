# AGENTS.md — Chrome Proxy

## Назначение проекта

`chrome-proxy` — компактное расширение только для Google Chrome на Manifest V3.

Основной сценарий:

- пользователь задаёт один HTTP proxy строкой `login:password@host:port`;
- proxy можно быстро включить и выключить;
- есть три режима маршрутизации при включённом proxy:
  - все сайты;
  - все сайты, кроме списка;
  - только сайты из списка;
- proxy поддерживает authentication через `webRequest.onAuthRequired`;
- есть проверка соединения с измерением HTTP latency и внешнего IP;
- всё управление находится в небольшом popup.

Перед изменением реализации обязательно прочитай:

1. `docs/REQUIREMENTS.md`
2. `docs/ARCHITECTURE.md`
3. текущий файл `AGENTS.md`
4. конкретный файл задания из `docs/codex/`

Если требования конкретного prompt конфликтуют с `REQUIREMENTS.md` или `ARCHITECTURE.md`, не меняй архитектуру молча. Сначала опиши конфликт в итоговом отчёте и выбери вариант, который сохраняет продуктовые инварианты.

## Технологический стек

Использовать:

- WXT;
- React;
- TypeScript в strict mode;
- Vite через WXT;
- Manifest V3;
- `pnpm`;
- Vitest;
- WXT Vitest plugin;
- обычный CSS без UI-фреймворка.

Не добавлять без реальной необходимости:

- Tailwind;
- Redux/Zustand;
- React Router;
- backend;
- telemetry/analytics;
- remote code;
- options page;
- content scripts;
- declarativeNetRequest;
- поддержку Firefox/Edge/Brave;
- публикацию в Chrome Web Store.

## Главные архитектурные инварианты

### Background владеет proxy

Только background service worker имеет право:

- вызывать `browser.proxy.settings.set`;
- вызывать `browser.proxy.settings.clear`;
- выполнять временное переключение proxy для проверки соединения;
- обрабатывать proxy authentication;
- восстанавливать proxy после аварийной проверки;
- вычислять runtime status фактического proxy control.

React popup не должен напрямую изменять `browser.proxy.settings`.

### Storage

Пользовательские настройки хранить в `browser.storage.local`.

Основной persisted объект должен быть единым и версионируемым:

```ts
interface ProxySettings {
  version: 1;
  proxyInput: string;
  enabled: boolean;
  routingMode: 'all' | 'bypass' | 'allowlist';
  rulesText: string;
}
```

Не хранить отдельно декодированный пароль без необходимости. Источник истины для proxy credentials — сохранённая proxy-строка.

Известный продуктовый компромисс: пароль хранится в `storage.local`. Это не encrypted secret storage. Не пытайся скрыть этот факт дополнительной псевдокриптографией.

### Credentials

Никогда:

- не выводи полный proxy URL в console;
- не выводи login/password в ошибки;
- не вставляй реальные credentials в тесты;
- не возвращай credentials в popup без необходимости;
- не передавай credentials обычному `WWW-Authenticate`.

`onAuthRequired` должен предоставлять credentials только когда:

- `details.isProxy === true`;
- challenger host совпадает с настроенным proxy host;
- challenger port совпадает с настроенным proxy port;
- proxy настроен и сейчас должен использоваться, включая временную проверку.

Добавь защиту от бесконечного auth-loop: после повторного challenge одного request не продолжай бесконечно возвращать те же credentials.

### Proxy parser

Поддерживаем только вход:

```text
login:password@host:port
```

Без `http://`.

Поддержать:

- IPv4;
- hostname;
- URL-encoded специальные символы в username/password.

Не поддерживать IPv6 в MVP.

Валидация:

- username не пустой;
- password не пустой;
- host не пустой;
- host — валидный IPv4 или hostname;
- port — целое число `1..65535`;
- malformed percent-encoding даёт понятную ошибку;
- схема proxy всегда `http`.

### Rule parser

Одна запись на строку.

Поддерживаются:

- hostname;
- `*.hostname`;
- IPv4;
- IPv4 CIDR;
- `localhost`.

Не поддерживаются:

- URL;
- путь;
- порт сайта;
- IPv6.

Семантика `example.com`:

```text
example.com
*.example.com
```

Нормализация:

- trim;
- hostname lowercase;
- пустые строки удалить;
- дубли удалить;
- `*.example.com` можно канонизировать в `example.com`;
- textarea после успешной валидации получает канонический нормализованный текст.

Если хотя бы одна строка невалидна, новые правила не применяются.

### Маршрутизация

`enabled=false`:

- расширение не должно принудительно ставить `DIRECT`;
- нужно `browser.proxy.settings.clear({ scope: 'regular' })`.

`routingMode='all'`:

- `fixed_servers`;
- один HTTP `singleProxy`;
- никакого fallback `DIRECT`.

`routingMode='bypass'`:

- `fixed_servers`;
- один HTTP `singleProxy`;
- `bypassList` строится из нормализованных правил;
- hostname расширяется на сам домен и поддомены;
- никакого fallback на direct для остальных сайтов.

`routingMode='allowlist'`:

- `pac_script`;
- правила из списка возвращают `PROXY host:port`;
- всё остальное возвращает `DIRECT`;
- `PacScript.mandatory = true`;
- строка proxy в PAC не содержит credentials;
- auth выполняется отдельно через `onAuthRequired`;
- не возвращать `PROXY ...; DIRECT`.

### Loopback limitation

Chrome имеет implicit bypass для localhost/link-local.

В MVP:

- не использовать `<-loopback>`;
- не пытаться обходить встроенную защиту Chrome;
- явно учитывать, что PAC не умеет отменить implicit loopback bypass;
- если `localhost` или loopback IP указан в allowlist, можно показать warning, но это не должно ломать список.

### Control level

Перед изменением proxy учитывай:

- `not_controllable`;
- `controlled_by_other_extensions`;
- `controllable_by_this_extension`;
- `controlled_by_this_extension`.

Если proxy контролируется политикой или другим расширением:

- не симулируй успешное применение;
- верни техническую ошибку в popup;
- не перезаписывай runtime state как `connected`.

### Проверка соединения

Endpoint:

```text
https://api.ipify.org?format=json
```

Timeout: 5000 ms.

Показывать:

- успех/ошибка;
- latency в ms;
- внешний IP при успехе;
- технический error code/message при ошибке.

Это HTTP latency, не ICMP ping.

Если proxy включён:

- тест идёт через текущую активную конфигурацию.

Если proxy выключен:

1. проверить control level;
2. сохранить recovery marker;
3. временно поставить `fixed_servers` для тестируемого proxy без bypass;
4. выполнить fetch;
5. в `finally` вызвать `proxy.settings.clear`;
6. удалить recovery marker.

Если service worker был прерван в середине временного теста, при следующей инициализации recovery должен очищать временный proxy.

Все операции изменения proxy сериализовать.

## WXT

Используй явные импорты:

```ts
import { browser } from 'wxt/browser';
```

Не вызывай browser APIs на верхнем уровне WXT entrypoint. Runtime listeners регистрируй внутри `defineBackground`.

Background `main` WXT не делай `async`; асинхронную инициализацию запускай из него отдельно с обработкой ошибок.

## Качество кода

- TypeScript strict.
- Предпочитай discriminated unions для сообщений и ошибок.
- Не использовать `any`, кроме объективно неполных browser typings.
- Pure functions для parsing/normalization/PAC generation.
- Browser API оборачивать в небольшие сервисы/адаптеры.
- Не смешивать React UI с бизнес-логикой Chrome proxy.
- Ошибки имеют стабильные машинные коды.
- Пользовательский текст может быть техническим, но без секретов.

## Тесты

После каждого этапа запускать:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Unit tests обязательны для:

- proxy parser;
- rule parser/normalizer;
- CIDR;
- PAC generation;
- mode -> Chrome config mapping;
- auth challenge filtering/retry guard;
- settings validation;
- connection-test state machine/recovery.

Фактическое управление proxy обязательно проверить manual smoke test в настоящем Chrome на финальном этапе.

## Работа по staged prompts

Файлы `docs/codex/01-*.md` … `10-*.md` выполняются строго по порядку.

При выполнении конкретного этапа:

- реализуй только его цель и необходимые зависимости;
- не переписывай заранее следующие этапы;
- не удаляй рабочую реализацию предыдущего этапа;
- сначала изучи текущий diff/структуру;
- после изменения запусти проверки;
- не делай `git commit`, `git push`, release или публикацию;
- после выполнения этапа только предложи подходящее сообщение коммита в формате Conventional Commits согласно разделу «Формат ответа Codex после каждого этапа».

## Формат ответа Codex после каждого этапа

Кратко выведи:

1. `Что изменено`
2. `Ключевые решения`
3. `Проверки` с фактически выполненными командами и результатом
4. `Риски/ограничения`
5. `Готовность к следующему prompt`
6. `Предлагаемый commit` — предложи один вариант сообщения коммита в формате Conventional Commits, соответствующий фактически выполненным изменениям. Не выполняй `git commit` самостоятельно.

Формат commit message:

```text
<type>(<scope>): <description>
```

Используй подходящий type:

feat — новая функциональность;
fix — исправление ошибки;
refactor — изменение структуры без изменения поведения;
test — изменение тестов;
docs — документация;
chore — инфраструктура, tooling, dependencies;
build — изменения процесса сборки;
ci — CI/CD.

scope используй только если он естественно описывает изменённую область, например:

feat(proxy): add authenticated proxy configuration
feat(popup): add proxy settings interface
fix(auth): prevent repeated proxy auth challenges
test(proxy): add PAC generation coverage
chore: bootstrap WXT project

Описание:

на английском языке;
в lowercase;
без точки в конце;
коротко описывает главное изменение текущего этапа;
не упоминает изменения, которые фактически не были сделаны.