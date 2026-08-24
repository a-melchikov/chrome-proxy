import { browser } from 'wxt/browser';
import type { StateApiResponse } from '../messaging/protocol';
import type { ConnectionTestResult } from '../proxy/tester';
import type { ProxySettingsV1 } from '../storage/settings';

export interface PopupClient {
  getState(): Promise<StateApiResponse>;
  updateSettings(settings: ProxySettingsV1): Promise<StateApiResponse>;
  testConnection(): Promise<ConnectionTestResult>;
  getActiveTabUrl(): Promise<string | null>;
}

export function createBrowserPopupClient(): PopupClient {
  return {
    async getState() {
      const response: unknown = await browser.runtime.sendMessage({
        type: 'GET_STATE',
      });
      return response as StateApiResponse;
    },
    async updateSettings(settings) {
      const response: unknown = await browser.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings,
      });
      return response as StateApiResponse;
    },
    async testConnection() {
      const response: unknown = await browser.runtime.sendMessage({
        type: 'TEST_CONNECTION',
      });
      return response as ConnectionTestResult;
    },
    async getActiveTabUrl() {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tabs[0]?.url ?? null;
    },
  };
}
