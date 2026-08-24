import { describe, expect, it } from 'vitest';
import {
  CURRENT_SITE_UNAVAILABLE_MESSAGE,
  extractCurrentSiteHostname,
} from '../src/ui/current-site';

describe('current site extraction', () => {
  it.each([
    ['https://Docs.GitHub.com/en/rest?q=1', 'docs.github.com'],
    ['http://192.0.2.10:8080/path', '192.0.2.10'],
  ])('extracts only the canonical HTTP(S) hostname', (url, hostname) => {
    expect(extractCurrentSiteHostname(url)).toEqual({ ok: true, hostname });
  });

  it.each([
    null,
    undefined,
    'chrome://extensions',
    'file:///tmp/example.txt',
    'about:blank',
    'https://[2001:db8::1]/',
    'not a URL',
  ])('rejects an unsupported tab URL', (url) => {
    expect(extractCurrentSiteHostname(url)).toEqual({
      ok: false,
      error: {
        code: 'CURRENT_SITE_UNAVAILABLE',
        message: CURRENT_SITE_UNAVAILABLE_MESSAGE,
      },
    });
  });
});
