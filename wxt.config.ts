import { defineConfig } from 'wxt';

export default defineConfig({
  browser: 'chrome',
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Chrome Proxy',
    description: 'Manage an authenticated HTTP proxy in Chrome.',
    permissions: [
      'proxy',
      'storage',
      'webRequest',
      'webRequestAuthProvider',
      'activeTab',
    ],
    host_permissions: ['<all_urls>'],
    incognito: 'spanning',
  },
});
