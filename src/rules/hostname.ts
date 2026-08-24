import { formatIPv4, parseIPv4 } from './ipv4';

export type CanonicalHost =
  | { type: 'hostname'; value: string }
  | { type: 'ipv4'; value: string };

const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function canonicalizeHost(value: string): CanonicalHost | null {
  const ipv4 = parseIPv4(value);

  if (ipv4 !== null) {
    return { type: 'ipv4', value: formatIPv4(ipv4) };
  }

  const hostname = canonicalizeHostname(value);
  return hostname === null ? null : { type: 'hostname', value: hostname };
}

export function canonicalizeHostname(value: string): string | null {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    /[\s/:@?#\[\]\\%]/u.test(value) ||
    /^[\d.]+$/.test(value)
  ) {
    return null;
  }

  let hostname: string;

  try {
    const url = new URL(`http://${value}`);

    if (
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null;
    }

    hostname = url.hostname.toLowerCase();
  } catch {
    return null;
  }

  if (hostname.length === 0 || hostname.length > 253) {
    return null;
  }

  if (parseIPv4(hostname) !== null) {
    return null;
  }

  const labels = hostname.split('.');

  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !HOST_LABEL_PATTERN.test(label),
    )
  ) {
    return null;
  }

  return hostname;
}
