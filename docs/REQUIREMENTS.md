# Chrome Proxy — требования MVP

## 1. Общая информация

Название расширения: `Chrome Proxy`.

Название GitHub-проекта: `chrome-proxy`.

Целевая платформа:

- только Google Chrome;
- Manifest V3;
- локальная установка через `chrome://extensions` / Load unpacked;
- Chrome Web Store пока не входит в MVP.

Стек:

- WXT;
- React;
- TypeScript;
- Vite через WXT;
- pnpm.

Интерфейс — только компактный popup. Отдельной settings/options page нет.

## 2. Proxy configuration

Пользователь настраивает ровно один proxy.

Входной формат:

```text
login:password@45.92.20.7:8000
```

или:

```text
login:password@proxy.example.com:8000
```

`http://` пользователь не указывает.

Расширение интерпретирует proxy как HTTP proxy. Один и тот же HTTP proxy используется для HTTP и HTTPS destination traffic.

### Credentials

Login/password обязательны.

Специальные символы `:`, `@`, `%` и другие неоднозначные символы внутри credentials должны быть URL-encoded.

Пример:

```text
user%40example.com:p%40ss%3Aword@proxy.example.com:8000
```

Парсер должен декодировать credentials перед передачей в `onAuthRequired`.

Malformed percent encoding — validation error.

### Host

Поддерживаются IPv4 и hostname. IPv6 в MVP не поддерживается.

### Port

Только целое число `1..65535`.

## 3. Состояния

Логически существуют четыре состояния:

1. `OFF`
2. `ON / Все сайты`
3. `ON / Все сайты, кроме списка`
4. `ON / Только сайты из списка`

Persisted модель:

```ts
enabled: boolean
routingMode: 'all' | 'bypass' | 'allowlist'
```

После чистой установки:

```text
enabled = false
routingMode = all
proxyInput = ""
rulesText = ""
```

Включить proxy нельзя, пока proxy configuration невалидна.

После перезапуска Chrome состояние сохраняется.

## 4. OFF

Когда proxy выключен, расширение должно отказаться от управления proxy:

```ts
browser.proxy.settings.clear({ scope: 'regular' })
```

Не использовать permanent `mode = direct`.

OFF означает «расширение не управляет proxy», а не «расширение запрещает системный/корпоративный proxy».

## 5. Режим «Все сайты»

Использовать `fixed_servers + singleProxy`.

Не задавать fallback `DIRECT`.

Если proxy недоступен, запрос должен завершаться ошибкой, а не молча переходить на direct connection.

## 6. Режим «Все сайты, кроме списка»

Использовать:

```text
fixed_servers + singleProxy + bypassList
```

Пример ввода:

```text
github.com
google.com
192.168.0.0/16
localhost
```

`github.com` означает `github.com` и любой `*.github.com`.

## 7. Режим «Только сайты из списка»

Использовать inline PAC:

```text
mode = pac_script
```

Условия:

- `mandatory = true`;
- allowlisted host -> `PROXY host:port`;
- всё остальное -> `DIRECT`;
- credentials в PAC не встраиваются;
- не добавлять `; DIRECT` после `PROXY`.

## 8. Список сайтов

UI: textarea, одна запись на строку.

Поддержать:

```text
example.com
*.example.com
localhost
127.0.0.1
192.168.0.0/16
```

Не поддерживать:

```text
https://example.com
example.com:8443
example.com/path
2001:db8::1
```

### Нормализация

После успешной валидации textarea переписывается:

- whitespace trim;
- hostname lowercase;
- убрать пустые строки;
- убрать дубли;
- `*.example.com` канонизировать к `example.com`;
- одна запись на строку.

Если есть невалидная строка:

- показать номер строки и причину;
- не применять новые правила;
- старая рабочая конфигурация остаётся активной.

## 9. Добавить текущий сайт

В режимах `bypass` и `allowlist` есть кнопка `+ Текущий сайт`.

Она:

1. получает URL активной вкладки;
2. извлекает только `hostname`;
3. добавляет hostname в textarea;
4. прогоняет обычную нормализацию;
5. не добавляет дубликат.

`https://docs.github.com/en/rest` добавляет `docs.github.com`.

Не преобразовывать автоматически в registrable domain `github.com`.

Для `chrome://`, `file://`, `about:` и URL без нормального hostname показать понятную ошибку/disabled state.

## 10. Proxy authentication

Использовать `browser.webRequest.onAuthRequired`.

Manifest permissions:

```text
webRequest
webRequestAuthProvider
```

Credentials возвращаются только для proxy challenge, совпадающего с текущим proxy host/port.

Нельзя отдавать credentials для обычной авторизации сайта.

Нужен retry guard от повторного вызова с невалидными credentials.

## 11. Проверка соединения

Кнопка: `Проверить`.

Endpoint:

```text
https://api.ipify.org?format=json
```

Timeout: `5000 ms`.

Успех:

```text
Подключено
230 ms
IP: 45.92.20.7
```

`230 ms` — HTTP latency request, не ICMP ping.

Ошибка должна быть технической, например:

```text
Ошибка подключения
PROXY_AUTH_FAILED
Proxy authentication failed
```

или:

```text
Ошибка подключения
TIMEOUT
Request exceeded 5000 ms
```

Не обещать точный HTTP status, если Fetch API его фактически не предоставил.

### Проверка при ON

Если proxy включён, тест выполняется через текущую конфигурацию.

### Проверка при OFF

1. проверить валидность proxy;
2. проверить `levelOfControl`;
3. записать durable recovery marker;
4. временно установить тестовый `fixed_servers`;
5. выполнить fetch;
6. в `finally` очистить временную proxy setting;
7. удалить recovery marker;
8. вернуть результат.

Если service worker завершился аварийно, следующий запуск должен увидеть marker и выполнить cleanup.

Во время теста другие запросы Chrome короткое время также могут попасть в proxy. Это известное ограничение Chrome API.

## 12. Proxy control conflicts

Popup корректно показывает состояние, если proxy settings запрещены policy или контролируются другим расширением.

Нельзя показывать effective `ON`, если расширение фактически не контролирует setting.

## 13. Storage

Использовать `browser.storage.local`.

Сохранять:

- proxy string;
- enabled;
- routing mode;
- normalized rules.

Пароль хранится локально вместе со строкой proxy. Это осознанный MVP-компромисс.

Не использовать `storage.sync`.

Не использовать самодельное «шифрование» ключом из того же extension storage.

## 14. Автосохранение

Нет кнопки `Сохранить`.

Proxy input:

- local draft меняется;
- рабочий proxy не заменяется, пока новая строка не валидна;
- валидная строка сохраняется и при ON применяется.

Rules textarea:

- debounce примерно 300–500 ms;
- применяются только полностью валидные правила;
- после успеха textarea нормализуется.

## 15. Popup

Ориентировочная ширина `320–350 px`.

Структура:

```text
Chrome Proxy                    ON/OFF

Proxy
[user:••••••@45.92.20.7:8000] [eye]

Режим
[ Все сайты                   v ]

Исключения / Сайты через proxy
[ textarea                       ]

[ + Текущий сайт ]

Статус
Подключено
230 ms
IP: 45.92.20.7

[ Проверить ]
```

Поля списка скрыть в режиме `all`.

Подпись textarea:

- bypass: «Не использовать proxy для»;
- allowlist: «Использовать proxy только для».

UI компактный, без декоративных карточек внутри карточек, hero-блоков и лишнего whitespace.

## 16. Отображение proxy input

Это одно логическое поле.

В обычном состоянии:

```text
user:••••••••@45.92.20.7:8000
```

Eye action временно раскрывает оригинальную строку.

Во время редактирования пароль не должен случайно появляться без explicit reveal.

Допустима реализация:

- unfocused — partially masked summary;
- focused hidden-edit — password-style input, скрывающий всю строку;
- reveal — обычный text input.

Критично:

- не испортить encoded значение;
- не сохранить bullet-символы вместо реального password.

## 17. Toolbar icon

Состояние видно без открытия popup.

Минимум:

- разные ON/OFF icon assets;
- badge `ON` при active proxy;
- отдельное error/warning состояние при policy/other extension.

## 18. Incognito

Расширение совместимо с Incognito.

Пользователь вручную включает `Allow in Incognito` в `chrome://extensions`.

Обычная `regular` proxy setting наследуется incognito profile, если не перекрыта отдельной incognito configuration.

Не создавать отдельную incognito-specific proxy config в MVP.

## 19. Известное ограничение localhost

Chrome имеет implicit bypass для loopback/link-local destinations.

MVP не отключает его.

- PAC не может отменить implicit loopback bypass;
- allowlist с `localhost` не гарантирует прохождение localhost через proxy;
- это документируется;
- `<-loopback>` в MVP не используется.

## 20. Не входит в MVP

- несколько proxy profiles;
- proxy rotation;
- SOCKS;
- HTTPS proxy как proxy protocol;
- IPv6 proxy host;
- per-tab/per-window proxy;
- import/export;
- sync;
- keyboard shortcut;
- context menu;
- remote config;
- telemetry;
- Chrome Web Store publication;
- Firefox/Edge support.
