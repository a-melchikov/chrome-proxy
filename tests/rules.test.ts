import { describe, expect, it } from 'vitest';
import { normalizeRules } from '../src/rules/normalizer';
import { parseRules } from '../src/rules/parser';

describe('rule parsing and normalization', () => {
  it('normalizes case, wildcards, duplicates, blanks, and order', () => {
    const result = normalizeRules(
      ' GitHub.COM\n\n*.github.com\nexample.com\ngithub.com\n',
    );

    expect(result).toEqual({
      ok: true,
      value: {
        rules: [
          { type: 'hostname', value: 'github.com' },
          { type: 'hostname', value: 'example.com' },
        ],
        text: 'github.com\nexample.com',
      },
    });
  });

  it('parses hostname, localhost, IPv4, and canonical CIDR rules', () => {
    const result = normalizeRules(
      'example.com\nlocalhost\n127.0.0.1\n192.168.1.123/24',
    );

    expect(result).toEqual({
      ok: true,
      value: {
        rules: [
          { type: 'hostname', value: 'example.com' },
          { type: 'hostname', value: 'localhost' },
          { type: 'ipv4', value: '127.0.0.1' },
          { type: 'cidr', network: '192.168.1.0', prefix: 24 },
        ],
        text: 'example.com\nlocalhost\n127.0.0.1\n192.168.1.0/24',
      },
    });
  });

  it.each([
    'https://example.com',
    'example.com/path',
    'example.com:443',
    '192.168.0.1/33',
    '192.168.999.1',
    '*.127.0.0.1',
    '0x7f000001',
    '2001:db8::1',
    'hello world',
  ])('rejects invalid rule %s', (rule) => {
    const result = parseRules(rule);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'INVALID_RULE',
        line: 1,
      });
      expect(result.error.message).not.toContain(rule);
    }
  });

  it('reports the original line number and returns no partial rules', () => {
    const result = normalizeRules(
      'valid.example\n\n  localhost  \nexample.com:443\nafter.example',
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_RULE',
        message: 'Site ports and IPv6 addresses are not supported.',
        line: 4,
      },
    });
  });

  it.each([
    [
      'https://example.com',
      'URL is not supported; enter only a hostname.',
    ],
    [
      'example.com/path',
      'Paths are not supported; enter only a hostname.',
    ],
    [
      '192.168.0.1/33',
      'IPv4 CIDR prefix must be an integer from 0 to 32.',
    ],
  ])('returns a safe reason for invalid rule %s', (rule, message) => {
    expect(parseRules(rule)).toEqual({
      ok: false,
      error: { code: 'INVALID_RULE', message, line: 1 },
    });
  });

  it('supports CRLF input and removes blank lines', () => {
    const result = normalizeRules('\r\nEXAMPLE.COM\r\n\r\nlocalhost\r\n');

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.text).toBe('example.com\nlocalhost');
    }
  });
});
