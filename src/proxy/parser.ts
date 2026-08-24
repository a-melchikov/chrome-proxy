import { canonicalizeHost } from '../rules/hostname';
import { failure, success, type Result } from './errors';

export interface ParsedProxy {
  username: string;
  password: string;
  host: string;
  port: number;
  scheme: 'http';
}

const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:\/\//iu;
const PORT_PATTERN = /^\d+$/;

export function parseProxyInput(raw: string): Result<ParsedProxy> {
  if (
    raw.length === 0 ||
    raw !== raw.trim() ||
    SCHEME_PATTERN.test(raw) ||
    /[\s/?#\\]/u.test(raw)
  ) {
    return failure(
      'INVALID_PROXY_FORMAT',
      'Proxy must use the login:password@host:port format without a scheme.',
    );
  }

  const atParts = raw.split('@');

  if (atParts.length !== 2) {
    return failure(
      'INVALID_PROXY_FORMAT',
      'Proxy must contain one encoded credential separator.',
    );
  }

  const [credentials = '', address = ''] = atParts;
  const credentialParts = credentials.split(':');

  if (credentialParts.length !== 2) {
    return failure(
      'INVALID_PROXY_FORMAT',
      'Proxy credentials must contain a username and password.',
    );
  }

  const [encodedUsername = '', encodedPassword = ''] = credentialParts;

  if (encodedUsername.length === 0) {
    return failure('INVALID_PROXY_USERNAME', 'Proxy username is required.');
  }

  if (encodedPassword.length === 0) {
    return failure('INVALID_PROXY_PASSWORD', 'Proxy password is required.');
  }

  if (address.startsWith('[') || address.includes(']')) {
    return failure('INVALID_PROXY_HOST', 'IPv6 proxy hosts are not supported.');
  }

  const lastColon = address.lastIndexOf(':');

  if (lastColon < 0) {
    return failure('INVALID_PROXY_PORT', 'Proxy port is required.');
  }

  const rawHost = address.slice(0, lastColon);
  const rawPort = address.slice(lastColon + 1);

  if (rawHost.length === 0 || rawHost.includes(':')) {
    return failure(
      'INVALID_PROXY_HOST',
      'Proxy host must be a valid IPv4 address or hostname.',
    );
  }

  if (!PORT_PATTERN.test(rawPort)) {
    return failure(
      'INVALID_PROXY_PORT',
      'Proxy port must be an integer from 1 to 65535.',
    );
  }

  const port = Number(rawPort);

  if (port < 1 || port > 65535) {
    return failure(
      'INVALID_PROXY_PORT',
      'Proxy port must be an integer from 1 to 65535.',
    );
  }

  let username: string;
  let password: string;

  try {
    username = decodeURIComponent(encodedUsername);
    password = decodeURIComponent(encodedPassword);
  } catch {
    return failure(
      'INVALID_PROXY_ENCODING',
      'Proxy credentials contain malformed percent encoding.',
    );
  }

  if (username.length === 0) {
    return failure('INVALID_PROXY_USERNAME', 'Proxy username is required.');
  }

  if (password.length === 0) {
    return failure('INVALID_PROXY_PASSWORD', 'Proxy password is required.');
  }

  const host = canonicalizeHost(rawHost);

  if (host === null) {
    return failure(
      'INVALID_PROXY_HOST',
      'Proxy host must be a valid IPv4 address or hostname.',
    );
  }

  try {
    const parsedUrl = new URL(`http://${raw}`);

    if (
      parsedUrl.protocol !== 'http:' ||
      parsedUrl.pathname !== '/' ||
      parsedUrl.search !== '' ||
      parsedUrl.hash !== ''
    ) {
      return failure(
        'INVALID_PROXY_FORMAT',
        'Proxy must not contain a URL path, query, or fragment.',
      );
    }
  } catch {
    return failure(
      'INVALID_PROXY_FORMAT',
      'Proxy must use the login:password@host:port format without a scheme.',
    );
  }

  return success({
    username,
    password,
    host: host.value,
    port,
    scheme: 'http',
  });
}
