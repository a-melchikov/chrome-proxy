import { normalizeRules } from '../rules/normalizer';

export const CURRENT_SITE_UNAVAILABLE_MESSAGE =
  'Текущую вкладку нельзя добавить: нет HTTP/HTTPS hostname.';

export type CurrentSiteResult =
  | { ok: true; hostname: string }
  | {
      ok: false;
      error: {
        code: 'CURRENT_SITE_UNAVAILABLE';
        message: string;
      };
    };

export function extractCurrentSiteHostname(
  tabUrl: string | null | undefined,
): CurrentSiteResult {
  if (typeof tabUrl !== 'string') {
    return currentSiteUnavailable();
  }

  let url: URL;

  try {
    url = new URL(tabUrl);
  } catch {
    return currentSiteUnavailable();
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.hostname.length === 0
  ) {
    return currentSiteUnavailable();
  }

  const normalized = normalizeRules(url.hostname.toLowerCase());

  if (!normalized.ok || normalized.value.rules.length !== 1) {
    return currentSiteUnavailable();
  }

  return { ok: true, hostname: normalized.value.text };
}

function currentSiteUnavailable(): CurrentSiteResult {
  return {
    ok: false,
    error: {
      code: 'CURRENT_SITE_UNAVAILABLE',
      message: CURRENT_SITE_UNAVAILABLE_MESSAGE,
    },
  };
}
