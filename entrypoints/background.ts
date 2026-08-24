import { registerProxyAuthHandler } from '../src/proxy/auth-listener';
import { ProxyAuthManager } from '../src/proxy/auth';

function initialize(): Promise<void> {
  return Promise.resolve();
}

export default defineBackground(() => {
  const authManager = new ProxyAuthManager();
  registerProxyAuthHandler(authManager);

  void initialize().catch(() => {
    console.error('Background initialization failed');
  });
});
