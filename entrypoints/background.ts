import { registerRuntimeMessageHandler } from '../src/messaging/handler';
import { registerProxyAuthHandler } from '../src/proxy/auth-listener';
import { ProxyAuthManager } from '../src/proxy/auth';
import { createBrowserProxyAdapter } from '../src/proxy/browser-adapter';
import { ProxyController } from '../src/proxy/controller';
import { ExtensionRuntime } from '../src/runtime/extension-runtime';
import { createBrowserSettingsRepository } from '../src/storage/settings';

export default defineBackground(() => {
  const authManager = new ProxyAuthManager();
  const proxyAdapter = createBrowserProxyAdapter();
  const proxyController = new ProxyController(proxyAdapter, authManager);
  const runtime = new ExtensionRuntime({
    settingsRepository: createBrowserSettingsRepository(),
    proxyController,
    authContext: authManager,
  });

  registerRuntimeMessageHandler(runtime);
  registerProxyAuthHandler(authManager);
  proxyAdapter.subscribe((change) => {
    void runtime.handleProxySettingsChange(change).catch(() => {
      console.error('Proxy settings change handling failed');
    });
  });

  void runtime.initialize().catch(() => {
    console.error('Background initialization failed');
  });
});
