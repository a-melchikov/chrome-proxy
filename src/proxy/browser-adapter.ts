import { browser, type Browser } from 'wxt/browser';
import type { ProxyConfig } from './config';

export type BrowserControlLevel = Browser.types.LevelOfControl;

export interface ProxySettingsSnapshot {
  levelOfControl: BrowserControlLevel;
  value: unknown;
}

export interface ProxySettingsChange {
  levelOfControl: BrowserControlLevel;
  value: unknown;
  incognitoSpecific?: boolean;
}

export type ProxySettingsChangeListener = (
  change: ProxySettingsChange,
) => void;

export interface ProxySettingsAdapter {
  get(): Promise<ProxySettingsSnapshot>;
  set(config: ProxyConfig): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: ProxySettingsChangeListener): () => void;
}

export function createBrowserProxyAdapter(): ProxySettingsAdapter {
  return {
    async get() {
      const result = await browser.proxy.settings.get({ incognito: false });

      return {
        levelOfControl: result.levelOfControl,
        value: result.value,
      };
    },
    async set(config) {
      await browser.proxy.settings.set({
        scope: 'regular',
        value: config,
      });
    },
    async clear() {
      await browser.proxy.settings.clear({ scope: 'regular' });
    },
    subscribe(listener) {
      const browserListener = (
        change: Browser.types.ChromeSettingOnChangeDetails<Browser.proxy.ProxyConfig>,
      ) => {
        listener({
          levelOfControl: change.levelOfControl,
          value: change.value,
          ...(change.incognitoSpecific === undefined
            ? {}
            : { incognitoSpecific: change.incognitoSpecific }),
        });
      };

      browser.proxy.settings.onChange.addListener(browserListener);

      return () => {
        browser.proxy.settings.onChange.removeListener(browserListener);
      };
    },
  };
}
