// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, {
  AUTOSAVE_DELAY_MS,
} from '../entrypoints/popup/App';
import type { StateApiResponse } from '../src/messaging/protocol';
import type { ConnectionTestResult } from '../src/proxy/tester';
import type { ExtensionState } from '../src/runtime/state';
import type { ProxySettingsV1 } from '../src/storage/settings';
import type { PopupClient } from '../src/ui/popup-client';

const rawProxy =
  'fixture-user:p%40ss%3Aword@proxy.example.test:8080';

const disabledState = createState({
  version: 1,
  proxyInput: rawProxy,
  enabled: false,
  routingMode: 'all',
  rulesText: '',
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('popup initialization and proxy draft', () => {
  it('shows compact loading and then authoritative state', async () => {
    const loading = createDeferred<StateApiResponse>();
    const client = createClient({ getState: () => loading.promise });

    render(<App client={client} />);

    expect(screen.getByRole('status').textContent).toBe('Загрузка…');
    expect(screen.queryByLabelText('Включить proxy')).toBeNull();

    loading.resolve({ ok: true, data: disabledState });

    const toggle = (await screen.findByLabelText(
      'Включить proxy',
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect((screen.getByLabelText('Proxy') as HTMLInputElement).value).toContain(
      '••••',
    );
  });

  it('keeps the encoded password out of the hidden summary', async () => {
    const client = createClient({ state: disabledState });
    render(<App client={client} />);

    const input = (await screen.findByLabelText('Proxy')) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).not.toContain('p%40ss%3Aword');
    expect(input.value).toContain('fixture-user:');

    fireEvent.focus(input);
    expect(input.type).toBe('password');
    expect(input.value).toBe(rawProxy);

    fireEvent.blur(input);
    expect(input.value).not.toContain('p%40ss%3Aword');
  });

  it('reveals the original encoded value only after the eye action', async () => {
    const user = userEvent.setup();
    const client = createClient({ state: disabledState });
    render(<App client={client} />);

    await screen.findByLabelText('Proxy');
    await user.click(screen.getByLabelText('Показать proxy'));

    const input = screen.getByLabelText('Proxy') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.value).toBe(rawProxy);
    expect(screen.getByLabelText('Скрыть proxy')).not.toBeNull();
  });

  it('does not persist an invalid proxy and keeps ON disabled', async () => {
    const client = createClient({ state: createEmptyState() });
    render(<App client={client} />);
    const input = (await screen.findByLabelText('Proxy')) as HTMLInputElement;
    vi.useFakeTimers();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'invalid-proxy' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });

    expect(client.updateSettings).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Включить proxy') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'encoded credential separator',
    );
  });

  it('debounces a valid proxy update and enables the ON control', async () => {
    const client = createClient({ state: createEmptyState() });
    render(<App client={client} />);
    const input = (await screen.findByLabelText('Proxy')) as HTMLInputElement;
    vi.useFakeTimers();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: rawProxy } });

    expect(client.updateSettings).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Включить proxy') as HTMLInputElement).disabled).toBe(
      false,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    });
    expect(client.updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(client.updateSettings).toHaveBeenCalledTimes(1);
    expect(client.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ proxyInput: rawProxy, enabled: false }),
    );
  });
});

describe('popup settings controls', () => {
  it('waits for the authoritative response before showing desired ON', async () => {
    const updated = createDeferred<StateApiResponse>();
    const client = createClient({
      state: disabledState,
      updateSettings: () => updated.promise,
    });
    render(<App client={client} />);
    const toggle = (await screen.findByLabelText(
      'Включить proxy',
    )) as HTMLInputElement;

    fireEvent.click(toggle);

    expect(client.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, proxyInput: rawProxy }),
    );
    expect(toggle.checked).toBe(false);

    updated.resolve({
      ok: true,
      data: createState({ ...disabledState.settings, enabled: true }),
    });
    await act(async () => undefined);

    expect(toggle.checked).toBe(true);
  });

  it('allows turning OFF while an invalid local draft is pending', async () => {
    const enabledState = createState({
      ...disabledState.settings,
      enabled: true,
    });
    const client = createClient({ state: enabledState });
    render(<App client={client} />);
    const input = (await screen.findByLabelText('Proxy')) as HTMLInputElement;
    const toggle = screen.getByLabelText('Включить proxy') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'invalid-proxy' } });
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);

    expect(client.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        proxyInput: rawProxy,
      }),
    );
  });

  it('shows rules only for list modes and saves normalized rules', async () => {
    const client = createClient({ state: disabledState });
    render(<App client={client} />);
    await screen.findByLabelText('Режим маршрутизации');

    expect(screen.queryByLabelText('Не использовать proxy для')).toBeNull();
    fireEvent.change(screen.getByLabelText('Режим маршрутизации'), {
      target: { value: 'bypass' },
    });

    const rules = (await screen.findByLabelText(
      'Не использовать proxy для',
    )) as HTMLTextAreaElement;
    vi.useFakeTimers();
    fireEvent.change(rules, {
      target: { value: ' EXAMPLE.COM\n*.example.com\n' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });

    expect(client.updateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        routingMode: 'bypass',
        rulesText: 'example.com',
      }),
    );
  });

  it('ignores a stale settings response', async () => {
    const first = createDeferred<StateApiResponse>();
    const second = createDeferred<StateApiResponse>();
    const responses = [first.promise, second.promise];
    const client = createClient({
      state: disabledState,
      updateSettings: () => responses.shift() ?? Promise.resolve({
        ok: true,
        data: disabledState,
      }),
    });
    render(<App client={client} />);
    const mode = (await screen.findByLabelText(
      'Режим маршрутизации',
    )) as HTMLSelectElement;

    fireEvent.change(mode, { target: { value: 'bypass' } });
    fireEvent.change(mode, { target: { value: 'allowlist' } });
    expect(client.updateSettings).toHaveBeenCalledTimes(2);

    second.resolve({
      ok: true,
      data: createState({
        ...disabledState.settings,
        routingMode: 'allowlist',
      }),
    });
    await act(async () => undefined);
    expect(mode.value).toBe('allowlist');

    first.resolve({
      ok: true,
      data: createState({
        ...disabledState.settings,
        routingMode: 'bypass',
      }),
    });
    await act(async () => undefined);
    expect(mode.value).toBe('allowlist');
  });
});

describe('popup connection state', () => {
  it('renders successful latency and IP result', async () => {
    const test = createDeferred<ConnectionTestResult>();
    const client = createClient({
      state: disabledState,
      testConnection: () => test.promise,
    });
    render(<App client={client} />);
    await screen.findByText('Proxy выключен');

    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(screen.getByRole('button', { name: 'Проверка…' })).not.toBeNull();

    test.resolve({ ok: true, latencyMs: 230, ip: '203.0.113.10' });

    expect(await screen.findByText('Подключено')).not.toBeNull();
    expect(screen.getByText('Latency: 230 ms')).not.toBeNull();
    expect(screen.getByText('IP: 203.0.113.10')).not.toBeNull();
  });

  it('renders a technical connection error without a stack', async () => {
    const client = createClient({
      state: disabledState,
      testResult: {
        ok: false,
        error: {
          code: 'PROXY_AUTH_FAILED',
          message: 'Proxy authentication failed.',
        },
      },
    });
    render(<App client={client} />);
    await screen.findByText('Proxy выключен');

    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));

    expect(await screen.findByText('Ошибка подключения')).not.toBeNull();
    expect(screen.getByText('PROXY_AUTH_FAILED')).not.toBeNull();
    expect(screen.getByText('Proxy authentication failed.')).not.toBeNull();
  });

  it.each([
    [
      'controlled-by-other-extension',
      'Прокси контролируется другим расширением.',
    ],
    [
      'not-controllable',
      'Chrome не разрешает расширению изменять настройки прокси.',
    ],
  ] as const)('explains blocked control state %s', async (control, message) => {
    const blockedState: ExtensionState = {
      ...disabledState,
      settings: { ...disabledState.settings, enabled: true },
      effectiveEnabled: false,
      control,
      applyStatus: 'blocked',
    };
    const client = createClient({ state: blockedState });
    render(<App client={client} />);

    expect(await screen.findByText(message)).not.toBeNull();
    expect(screen.getByText('Proxy не применён')).not.toBeNull();
  });
});

interface ClientOptions {
  state?: ExtensionState;
  getState?: PopupClient['getState'];
  updateSettings?: PopupClient['updateSettings'];
  testConnection?: PopupClient['testConnection'];
  testResult?: ConnectionTestResult;
}

function createClient(options: ClientOptions) {
  const initialState = options.state ?? createEmptyState();
  const getState = vi.fn<PopupClient['getState']>(
    options.getState ?? (async () => ({ ok: true, data: initialState })),
  );
  const updateSettings = vi.fn<PopupClient['updateSettings']>(
    options.updateSettings ??
      (async (settings) => ({
        ok: true,
        data: createState(settings),
      })),
  );
  const testConnection = vi.fn<PopupClient['testConnection']>(
    options.testConnection ??
      (async () =>
        options.testResult ?? {
          ok: true,
          latencyMs: 25,
          ip: '203.0.113.1',
        }),
  );

  return { getState, updateSettings, testConnection };
}

function createEmptyState(): ExtensionState {
  return createState({
    version: 1,
    proxyInput: '',
    enabled: false,
    routingMode: 'all',
    rulesText: '',
  });
}

function createState(settings: ProxySettingsV1): ExtensionState {
  return {
    settings: { ...settings },
    effectiveEnabled: settings.enabled,
    control: settings.enabled ? 'owned' : 'available',
    applyStatus: settings.enabled ? 'applied' : 'idle',
    testInProgress: false,
    warnings: [],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
