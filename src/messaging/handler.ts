import { browser } from 'wxt/browser';
import type { ExtensionRuntime } from '../runtime/extension-runtime';
import type { StateApiResponse } from './protocol';

export async function handleRuntimeMessage(
  runtime: ExtensionRuntime,
  message: unknown,
): Promise<StateApiResponse> {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return invalidMessage();
  }

  switch (message.type) {
    case 'GET_STATE':
      return { ok: true, data: await runtime.getState() };
    case 'UPDATE_SETTINGS': {
      const updated = await runtime.updateSettings(message.settings);
      return updated.ok
        ? { ok: true, data: updated.value }
        : { ok: false, error: updated.error };
    }
    case 'TEST_CONNECTION':
      return {
        ok: false,
        error: {
          code: 'CONNECTION_TEST_NOT_AVAILABLE',
          message: 'Connection testing is not available yet.',
        },
      };
    default:
      return invalidMessage();
  }
}

export function registerRuntimeMessageHandler(runtime: ExtensionRuntime): void {
  browser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
    void handleRuntimeMessage(runtime, _message).then(
      sendResponse,
      () => {
        sendResponse({
          ok: false,
          error: {
            code: 'INVALID_MESSAGE',
            message: 'Background message handling failed.',
          },
        } satisfies StateApiResponse);
      },
    );

    return true;
  });
}

function invalidMessage(): StateApiResponse {
  return {
    ok: false,
    error: {
      code: 'INVALID_MESSAGE',
      message: 'Background message is invalid.',
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
