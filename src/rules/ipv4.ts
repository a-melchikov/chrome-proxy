export type IPv4Octets = readonly [number, number, number, number];

export interface ParsedCidr {
  network: string;
  prefix: number;
}

const IPV4_PART_PATTERN = /^\d{1,3}$/;
const CIDR_PREFIX_PATTERN = /^(?:0|[1-9]|[12]\d|3[0-2])$/;

export function parseIPv4(value: string): IPv4Octets | null {
  const parts = value.split('.');

  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];

  for (const part of parts) {
    if (!IPV4_PART_PATTERN.test(part)) {
      return null;
    }

    const octet = Number(part);

    if (octet > 255) {
      return null;
    }

    octets.push(octet);
  }

  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

export function formatIPv4(octets: IPv4Octets): string {
  return octets.join('.');
}

export function isValidCidrPrefix(prefix: number): boolean {
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
}

export function prefixToDottedMask(prefix: number): string | null {
  if (!isValidCidrPrefix(prefix)) {
    return null;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return uint32ToIPv4(mask);
}

export function parseCidr(value: string): ParsedCidr | null {
  const parts = value.split('/');

  if (parts.length !== 2) {
    return null;
  }

  const [address = '', rawPrefix = ''] = parts;
  const octets = parseIPv4(address);

  if (octets === null || !CIDR_PREFIX_PATTERN.test(rawPrefix)) {
    return null;
  }

  const prefix = Number(rawPrefix);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipv4ToUint32(octets) & mask) >>> 0;

  return {
    network: uint32ToIPv4(network),
    prefix,
  };
}

export function isIPv4InCidr(
  address: string,
  cidr: ParsedCidr,
): boolean {
  const addressOctets = parseIPv4(address);
  const networkOctets = parseIPv4(cidr.network);

  if (
    addressOctets === null ||
    networkOctets === null ||
    !isValidCidrPrefix(cidr.prefix)
  ) {
    return false;
  }

  const mask =
    cidr.prefix === 0 ? 0 : (0xffffffff << (32 - cidr.prefix)) >>> 0;

  return (
    (ipv4ToUint32(addressOctets) & mask) >>> 0
  ) === ((ipv4ToUint32(networkOctets) & mask) >>> 0);
}

export function cidrRangesOverlap(
  left: ParsedCidr,
  right: ParsedCidr,
): boolean {
  if (
    !isValidCidrPrefix(left.prefix) ||
    !isValidCidrPrefix(right.prefix)
  ) {
    return false;
  }

  return left.prefix <= right.prefix
    ? isIPv4InCidr(right.network, left)
    : isIPv4InCidr(left.network, right);
}

function ipv4ToUint32(octets: IPv4Octets): number {
  return (
    ((octets[0] << 24) |
      (octets[1] << 16) |
      (octets[2] << 8) |
      octets[3]) >>>
    0
  );
}

function uint32ToIPv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}
