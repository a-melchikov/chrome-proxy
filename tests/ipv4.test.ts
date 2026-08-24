import { describe, expect, it } from 'vitest';
import {
  isValidCidrPrefix,
  parseCidr,
  parseIPv4,
  prefixToDottedMask,
} from '../src/rules/ipv4';

describe('IPv4 utilities', () => {
  it.each([
    ['0.0.0.0', [0, 0, 0, 0]],
    ['192.168.1.10', [192, 168, 1, 10]],
    ['255.255.255.255', [255, 255, 255, 255]],
    ['192.168.001.010', [192, 168, 1, 10]],
  ] as const)('parses %s', (input, expected) => {
    expect(parseIPv4(input)).toEqual(expected);
  });

  it.each([
    '',
    '127.0.0',
    '127.0.0.1.2',
    '192.168.999.1',
    '192.168.-1.1',
    '192.168. 1.1',
  ])('rejects invalid IPv4 %s', (input) => {
    expect(parseIPv4(input)).toBeNull();
  });

  it.each([
    ['192.168.1.123/24', { network: '192.168.1.0', prefix: 24 }],
    ['10.24.8.9/8', { network: '10.0.0.0', prefix: 8 }],
    ['255.255.255.255/0', { network: '0.0.0.0', prefix: 0 }],
    ['192.168.1.123/32', { network: '192.168.1.123', prefix: 32 }],
  ] as const)('canonicalizes CIDR %s', (input, expected) => {
    expect(parseCidr(input)).toEqual(expected);
  });

  it.each([
    '192.168.1.1/33',
    '192.168.1.1/-1',
    '192.168.1.1/01',
    'bad/24',
  ])('rejects invalid CIDR %s', (input) => {
    expect(parseCidr(input)).toBeNull();
  });

  it.each([
    [0, '0.0.0.0'],
    [8, '255.0.0.0'],
    [16, '255.255.0.0'],
    [24, '255.255.255.0'],
    [32, '255.255.255.255'],
  ] as const)('converts prefix %s to %s', (prefix, mask) => {
    expect(isValidCidrPrefix(prefix)).toBe(true);
    expect(prefixToDottedMask(prefix)).toBe(mask);
  });

  it.each([-1, 33, 1.5, Number.NaN])('rejects invalid prefix %s', (prefix) => {
    expect(isValidCidrPrefix(prefix)).toBe(false);
    expect(prefixToDottedMask(prefix)).toBeNull();
  });
});
