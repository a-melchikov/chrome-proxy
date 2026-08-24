import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
} from 'react';
import type { AppError } from '../../src/proxy/errors';
import { maskProxyInput } from '../../src/proxy/mask';
import { parseProxyInput } from '../../src/proxy/parser';
import type { ConnectionTestResult } from '../../src/proxy/tester';
import { normalizeRules } from '../../src/rules/normalizer';
import type { ExtensionState } from '../../src/runtime/state';
import type {
  ProxySettingsV1,
  RoutingMode,
} from '../../src/storage/settings';
import {
  createBrowserPopupClient,
  type PopupClient,
} from '../../src/ui/popup-client';

export const AUTOSAVE_DELAY_MS = 300;

const browserClient = createBrowserPopupClient();

interface AppProps {
  client?: PopupClient;
}

function App({ client = browserClient }: AppProps) {
  const [state, setState] = useState<ExtensionState | null>(null);
  const [proxyDraft, setProxyDraft] = useState('');
  const [rulesDraft, setRulesDraft] = useState('');
  const [modeDraft, setModeDraft] = useState<RoutingMode>('all');
  const [proxyTouched, setProxyTouched] = useState(false);
  const [proxyEditing, setProxyEditing] = useState(false);
  const [proxyRevealed, setProxyRevealed] = useState(false);
  const [rulesError, setRulesError] = useState<AppError | null>(null);
  const [requestError, setRequestError] = useState<AppError | null>(null);
  const [loadingError, setLoadingError] = useState<AppError | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [testPending, setTestPending] = useState(false);
  const [testResult, setTestResult] =
    useState<ConnectionTestResult | null>(null);

  const mountedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const desiredSettingsRef = useRef<ProxySettingsV1 | null>(null);
  const proxyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rulesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const proxyValidation = parseProxyInput(proxyDraft);
  const proxyValid = proxyValidation.ok;
  const toggleDisabled =
    state === null ||
    mutationPending ||
    (!state.settings.enabled && !proxyValid);
  const testDisabled =
    state === null ||
    !proxyValid ||
    mutationPending ||
    proxyDraft !== state.settings.proxyInput ||
    testPending ||
    state.testInProgress;

  const acceptState = useCallback((
    nextState: ExtensionState,
    syncDrafts: Readonly<{
      proxy: boolean;
      rules: boolean;
      mode: boolean;
    }> = { proxy: true, rules: true, mode: true },
  ) => {
    desiredSettingsRef.current = { ...nextState.settings };
    setState(nextState);

    if (syncDrafts.proxy) {
      setProxyDraft(nextState.settings.proxyInput);
    }

    if (syncDrafts.rules) {
      setRulesDraft(nextState.settings.rulesText);
      setRulesError(null);
    }

    if (syncDrafts.mode) {
      setModeDraft(nextState.settings.routingMode);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++requestSequenceRef.current;

    void client.getState().then(
      (response) => {
        if (!mountedRef.current || requestId !== requestSequenceRef.current) {
          return;
        }

        if (response.ok) {
          acceptState(response.data);
        } else {
          setLoadingError(response.error);
        }
      },
      () => {
        if (mountedRef.current && requestId === requestSequenceRef.current) {
          setLoadingError({
            code: 'UNKNOWN',
            message: 'Не удалось получить состояние background.',
          });
        }
      },
    );

    return () => {
      mountedRef.current = false;

      if (proxyTimerRef.current !== null) {
        clearTimeout(proxyTimerRef.current);
      }

      if (rulesTimerRef.current !== null) {
        clearTimeout(rulesTimerRef.current);
      }
    };
  }, [acceptState, client]);

  const sendSettings = useCallback(async (syncDrafts: Readonly<{
    proxy: boolean;
    rules: boolean;
    mode: boolean;
  }>) => {
    const desired = desiredSettingsRef.current;

    if (desired === null) {
      return;
    }

    const requestId = ++requestSequenceRef.current;
    setMutationPending(true);
    setRequestError(null);

    try {
      const response = await client.updateSettings({ ...desired });

      if (!mountedRef.current || requestId !== requestSequenceRef.current) {
        return;
      }

      if (response.ok) {
        acceptState(response.data, syncDrafts);
      } else {
        setRequestError(response.error);
      }
    } catch {
      if (mountedRef.current && requestId === requestSequenceRef.current) {
        setRequestError({
          code: 'UNKNOWN',
          message: 'Не удалось сохранить настройки.',
        });
      }
    } finally {
      if (mountedRef.current && requestId === requestSequenceRef.current) {
        setMutationPending(false);
      }
    }
  }, [acceptState, client]);

  function invalidatePendingResponse(): void {
    requestSequenceRef.current += 1;
    setMutationPending(false);
    setRequestError(null);
  }

  function handleProxyChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setProxyDraft(value);
    setProxyTouched(true);
    invalidatePendingResponse();

    if (proxyTimerRef.current !== null) {
      clearTimeout(proxyTimerRef.current);
    }

    const validated = parseProxyInput(value);

    if (!validated.ok || desiredSettingsRef.current === null) {
      return;
    }

    desiredSettingsRef.current = {
      ...desiredSettingsRef.current,
      proxyInput: value,
    };
    proxyTimerRef.current = setTimeout(() => {
      void sendSettings({ proxy: true, rules: false, mode: false });
    }, AUTOSAVE_DELAY_MS);
  }

  function handleProxyFocus(): void {
    setProxyEditing(true);
  }

  function handleProxyBlur(event: FocusEvent<HTMLInputElement>): void {
    if (event.relatedTarget instanceof HTMLElement) {
      const action = event.relatedTarget.dataset.proxyRevealAction;

      if (action === 'true') {
        return;
      }
    }

    setProxyEditing(false);
    setProxyRevealed(false);
  }

  function toggleProxyReveal(): void {
    if (proxyRevealed) {
      setProxyRevealed(false);
      setProxyEditing(false);
      return;
    }

    setProxyRevealed(true);
  }

  function handleToggle(): void {
    if (state === null || toggleDisabled || desiredSettingsRef.current === null) {
      return;
    }

    if (state.settings.enabled) {
      desiredSettingsRef.current = {
        ...desiredSettingsRef.current,
        enabled: false,
        proxyInput: state.settings.proxyInput,
      };
    } else {
      if (!proxyValid) {
        return;
      }

      desiredSettingsRef.current = {
        ...desiredSettingsRef.current,
        enabled: true,
        proxyInput: proxyDraft,
      };
    }

    void sendSettings({ proxy: false, rules: false, mode: false });
  }

  function handleModeChange(event: ChangeEvent<HTMLSelectElement>): void {
    const routingMode = event.target.value as RoutingMode;
    setModeDraft(routingMode);
    invalidatePendingResponse();

    if (desiredSettingsRef.current === null) {
      return;
    }

    desiredSettingsRef.current = {
      ...desiredSettingsRef.current,
      routingMode,
    };
    void sendSettings({ proxy: false, rules: false, mode: true });
  }

  function handleRulesChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const value = event.target.value;
    setRulesDraft(value);
    invalidatePendingResponse();

    if (rulesTimerRef.current !== null) {
      clearTimeout(rulesTimerRef.current);
    }

    const normalized = normalizeRules(value);

    if (!normalized.ok) {
      setRulesError(normalized.error);
      return;
    }

    setRulesError(null);

    if (desiredSettingsRef.current === null) {
      return;
    }

    desiredSettingsRef.current = {
      ...desiredSettingsRef.current,
      rulesText: normalized.value.text,
    };
    rulesTimerRef.current = setTimeout(() => {
      void sendSettings({ proxy: false, rules: true, mode: false });
    }, AUTOSAVE_DELAY_MS);
  }

  async function handleConnectionTest(): Promise<void> {
    if (testDisabled) {
      return;
    }

    setTestPending(true);
    setTestResult(null);

    try {
      const result = await client.testConnection();

      if (mountedRef.current) {
        setTestResult(result);
      }
    } catch {
      if (mountedRef.current) {
        setTestResult({
          ok: false,
          error: {
            code: 'UNKNOWN',
            message: 'Не удалось запустить проверку соединения.',
          },
        });
      }
    } finally {
      if (mountedRef.current) {
        setTestPending(false);
      }
    }
  }

  if (state === null) {
    return (
      <main className="popup-shell">
        <header className="app-header">
          <h1>Chrome Proxy</h1>
        </header>
        {loadingError === null ? (
          <p className="loading" role="status">
            Загрузка…
          </p>
        ) : (
          <ErrorMessage error={loadingError} title="Ошибка загрузки" />
        )}
      </main>
    );
  }

  const hiddenProxyValue =
    proxyDraft.length === 0 ? '' : maskProxyInput(proxyDraft);
  const showRawProxy = proxyEditing || proxyRevealed;
  const controlMessage = getControlMessage(state);
  const proxyError =
    proxyTouched && !proxyValidation.ok ? proxyValidation.error : null;
  const stateError =
    state.applyStatus === 'error' ? (state.lastError ?? null) : null;

  return (
    <main className="popup-shell">
      <header className="app-header">
        <h1>Chrome Proxy</h1>
        <label className="toggle-control">
          <span className="sr-only">Включить proxy</span>
          <input
            aria-label="Включить proxy"
            checked={state.settings.enabled}
            disabled={toggleDisabled}
            onChange={handleToggle}
            type="checkbox"
          />
          <span aria-hidden="true" className="toggle-track">
            <span className="toggle-thumb" />
          </span>
        </label>
      </header>

      <section className="form-section">
        <div className="section-heading-row">
          <h2 id="proxy-heading">Proxy</h2>
          {mutationPending ? <span className="saving">Сохранение…</span> : null}
        </div>
        <div className="proxy-input-row">
          <input
            aria-describedby={proxyError === null ? undefined : 'proxy-error'}
            aria-invalid={proxyError !== null}
            aria-label="Proxy"
            autoComplete="off"
            className="text-control proxy-input"
            onBlur={handleProxyBlur}
            onChange={handleProxyChange}
            onFocus={handleProxyFocus}
            placeholder="login:password@host:port"
            readOnly={!showRawProxy}
            spellCheck={false}
            type={proxyRevealed ? 'text' : showRawProxy ? 'password' : 'text'}
            value={showRawProxy ? proxyDraft : hiddenProxyValue}
          />
          <button
            aria-label={proxyRevealed ? 'Скрыть proxy' : 'Показать proxy'}
            aria-pressed={proxyRevealed}
            className="icon-button"
            data-proxy-reveal-action="true"
            onClick={toggleProxyReveal}
            type="button"
          >
            <EyeIcon crossed={proxyRevealed} />
          </button>
        </div>
        {proxyError === null ? null : (
          <p className="field-error" id="proxy-error" role="alert">
            {proxyError.message}
          </p>
        )}
      </section>

      <section className="form-section" aria-labelledby="mode-heading">
        <h2 id="mode-heading">Режим</h2>
        <select
          aria-label="Режим маршрутизации"
          className="text-control"
          onChange={handleModeChange}
          value={modeDraft}
        >
          <option value="all">Все сайты</option>
          <option value="bypass">Все, кроме списка</option>
          <option value="allowlist">Только сайты из списка</option>
        </select>
      </section>

      {modeDraft === 'all' ? null : (
        <section className="form-section rules-section">
          <label htmlFor="proxy-rules">
            {modeDraft === 'bypass'
              ? 'Не использовать proxy для'
              : 'Использовать proxy только для'}
          </label>
          <textarea
            aria-describedby={rulesError === null ? undefined : 'rules-error'}
            aria-invalid={rulesError !== null}
            className="text-control rules-input"
            id="proxy-rules"
            onChange={handleRulesChange}
            placeholder={'example.com\n192.168.0.0/16'}
            rows={4}
            spellCheck={false}
            value={rulesDraft}
          />
          {rulesError === null ? null : (
            <p className="field-error" id="rules-error" role="alert">
              {rulesError.line === undefined
                ? rulesError.message
                : `Строка ${rulesError.line}: ${rulesError.message}`}
            </p>
          )}
        </section>
      )}

      <section className="connection-section" aria-labelledby="connection-heading">
        <h2 id="connection-heading">Соединение</h2>
        {controlMessage === null ? null : (
          <p className="control-warning" role="alert">
            {controlMessage}
          </p>
        )}
        <ConnectionStatus state={state} result={testResult} />
        {requestError !== null ? (
          <ErrorMessage error={requestError} title="Ошибка сохранения" />
        ) : stateError !== null ? (
          <ErrorMessage error={stateError} title="Ошибка proxy" />
        ) : null}
        <button
          className="primary-button"
          disabled={testDisabled}
          onClick={() => void handleConnectionTest()}
          type="button"
        >
          {testPending || state.testInProgress ? 'Проверка…' : 'Проверить'}
        </button>
      </section>
    </main>
  );
}

interface ConnectionStatusProps {
  state: ExtensionState;
  result: ConnectionTestResult | null;
}

function ConnectionStatus({ state, result }: ConnectionStatusProps) {
  if (result !== null) {
    return result.ok ? (
      <div className="connection-status success-status" role="status">
        <strong>Подключено</strong>
        <span>Latency: {result.latencyMs} ms</span>
        <span>IP: {result.ip}</span>
      </div>
    ) : (
      <div className="connection-status error-status" role="alert">
        <strong>Ошибка подключения</strong>
        <code>{result.error.code}</code>
        <span>{result.error.message}</span>
      </div>
    );
  }

  if (state.effectiveEnabled) {
    return (
      <div className="connection-status success-status" role="status">
        <strong>Proxy включён</strong>
        <span>Настройки применены</span>
      </div>
    );
  }

  if (state.settings.enabled) {
    return (
      <div className="connection-status error-status" role="status">
        <strong>Proxy не применён</strong>
        <span>Запрошено включение, но расширение не контролирует proxy.</span>
      </div>
    );
  }

  return (
    <div className="connection-status neutral-status" role="status">
      <strong>Proxy выключен</strong>
      <span>Расширение не управляет настройками proxy.</span>
    </div>
  );
}

function ErrorMessage({ error, title }: { error: AppError; title: string }) {
  return (
    <div className="request-error" role="alert">
      <strong>{title}</strong>
      <code>{error.code}</code>
      <span>{error.message}</span>
    </div>
  );
}

function getControlMessage(state: ExtensionState): string | null {
  switch (state.control) {
    case 'controlled-by-other-extension':
      return 'Прокси контролируется другим расширением.';
    case 'not-controllable':
      return 'Chrome не разрешает расширению изменять настройки прокси.';
    case 'available':
    case 'owned':
      return null;
  }
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
      {crossed ? <path d="m4 4 16 16" /> : null}
    </svg>
  );
}

export default App;
