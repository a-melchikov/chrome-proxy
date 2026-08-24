import { parseProxyInput } from './parser';

const MASK_CHARACTER = '•';
const INVALID_PROXY_MASK = 'Invalid proxy configuration';

export function maskProxyInput(raw: string): string {
  const parsed = parseProxyInput(raw);

  if (!parsed.ok) {
    return INVALID_PROXY_MASK;
  }

  const [credentials = ''] = raw.split('@');
  const [encodedUsername = '', encodedPassword = ''] = credentials.split(':');
  const passwordMask = MASK_CHARACTER.repeat(encodedPassword.length);

  return `${encodedUsername}:${passwordMask}@${parsed.value.host}:${parsed.value.port}`;
}
