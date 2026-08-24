import { browser, type Browser } from 'wxt/browser';
import {
  type ProxyAuthDecision,
  type ProxyAuthManager,
} from './auth';

export const PROXY_AUTH_LISTENER_MODE = 'asyncBlocking' as const;

const REQUEST_FILTER: Browser.webRequest.RequestFilter = {
  urls: ['<all_urls>'],
};

export function registerProxyAuthHandler(
  authManager: ProxyAuthManager,
): () => void {
  const authListener = (
    details: Browser.webRequest.OnAuthRequiredDetails,
    asyncCallback?: (response: Browser.webRequest.BlockingResponse) => void,
  ): Browser.webRequest.BlockingResponse | undefined => {
    const response = decisionToBlockingResponse(
      authManager.handleChallenge(details),
    );

    if (asyncCallback !== undefined) {
      asyncCallback(response);
      return undefined;
    }

    return response;
  };

  const completionListener = (
    details:
      | Browser.webRequest.OnCompletedDetails
      | Browser.webRequest.OnErrorOccurredDetails,
  ) => {
    authManager.clearRequest(details.requestId);
  };

  browser.webRequest.onAuthRequired.addListener(
    authListener,
    REQUEST_FILTER,
    [PROXY_AUTH_LISTENER_MODE],
  );
  browser.webRequest.onCompleted.addListener(completionListener, REQUEST_FILTER);
  browser.webRequest.onErrorOccurred.addListener(
    completionListener,
    REQUEST_FILTER,
  );

  return () => {
    browser.webRequest.onAuthRequired.removeListener(authListener);
    browser.webRequest.onCompleted.removeListener(completionListener);
    browser.webRequest.onErrorOccurred.removeListener(completionListener);
  };
}

export function decisionToBlockingResponse(
  decision: ProxyAuthDecision,
): Browser.webRequest.BlockingResponse {
  switch (decision.kind) {
    case 'ignore':
      return {};
    case 'provide-credentials':
      return { authCredentials: decision.authCredentials };
    case 'cancel':
      return { cancel: true };
  }
}
