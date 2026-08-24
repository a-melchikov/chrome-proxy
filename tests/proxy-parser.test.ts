import { describe, expect, it } from 'vitest';
import { maskProxyInput } from '../src/proxy/mask';
import { parseProxyInput, type ParsedProxy } from '../src/proxy/parser';

describe('parseProxyInput', () => {
  it.each<{
    input: string;
    expected: ParsedProxy;
  }>([
    {
      input: 'fixture-user:fixture-pass@45.92.20.7:8000',
      expected: {
        username: 'fixture-user',
        password: 'fixture-pass',
        host: '45.92.20.7',
        port: 8000,
        scheme: 'http',
      },
    },
    {
      input: 'fixture-user:p%40ss@PROXY.Example.com:3128',
      expected: {
        username: 'fixture-user',
        password: 'p@ss',
        host: 'proxy.example.com',
        port: 3128,
        scheme: 'http',
      },
    },
    {
      input:
        'fixture%40corp.local:p%3Aa%25b@proxy.example.com:8080',
      expected: {
        username: 'fixture@corp.local',
        password: 'p:a%b',
        host: 'proxy.example.com',
        port: 8080,
        scheme: 'http',
      },
    },
    {
      input: 'fixture-user:fixture-pass@192.168.001.010:80',
      expected: {
        username: 'fixture-user',
        password: 'fixture-pass',
        host: '192.168.1.10',
        port: 80,
        scheme: 'http',
      },
    },
    {
      input: 'fixture-user:fixture-pass@ПРИМЕР.РФ:8080',
      expected: {
        username: 'fixture-user',
        password: 'fixture-pass',
        host: 'xn--e1afmkfd.xn--p1ai',
        port: 8080,
        scheme: 'http',
      },
    },
  ])('parses $input', ({ input, expected }) => {
    expect(parseProxyInput(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['http://fixture-user:fixture-pass@host.test:8000', 'INVALID_PROXY_FORMAT'],
    ['https://fixture-user:fixture-pass@host.test:8000', 'INVALID_PROXY_FORMAT'],
    ['fixture-user@host.test:8000', 'INVALID_PROXY_FORMAT'],
    [':fixture-pass@host.test:8000', 'INVALID_PROXY_USERNAME'],
    ['fixture-user:@host.test:8000', 'INVALID_PROXY_PASSWORD'],
    ['fixture-user:fixture-pass@:8000', 'INVALID_PROXY_HOST'],
    ['fixture-user:fixture-pass@host.test', 'INVALID_PROXY_PORT'],
    ['fixture-user:fixture-pass@host.test:0', 'INVALID_PROXY_PORT'],
    ['fixture-user:fixture-pass@host.test:65536', 'INVALID_PROXY_PORT'],
    ['fixture-user:fixture-pass@host.test:12.5', 'INVALID_PROXY_PORT'],
    ['fixture-user:fixture-pass@[2001:db8::1]:8000', 'INVALID_PROXY_HOST'],
    ['fixture-user:p%ZZ@host.test:8000', 'INVALID_PROXY_ENCODING'],
    ['fixture-user:fixture-pass@host.test:8000/path', 'INVALID_PROXY_FORMAT'],
    ['fixture-user:fixture-pass@host.test:8000?query=1', 'INVALID_PROXY_FORMAT'],
    ['fixture-user:fixture-pass@host.test:8000#fragment', 'INVALID_PROXY_FORMAT'],
    ['fixture-user:fixture-pass@192.168.999.1:8000', 'INVALID_PROXY_HOST'],
    ['fixture-user:fixture-pass@0x7f000001:8000', 'INVALID_PROXY_HOST'],
    ['fixture-user:fixture-pass@example..com:8000', 'INVALID_PROXY_HOST'],
    ['fixture-user:fixture:pass@host.test:8000', 'INVALID_PROXY_FORMAT'],
  ] as const)('rejects %s with %s', (input, code) => {
    const result = parseProxyInput(input);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.message).not.toContain(input);
      expect(result.error.message).not.toContain('fixture-pass');
    }
  });
});

describe('maskProxyInput', () => {
  it('masks the encoded password without changing the username or address', () => {
    expect(
      maskProxyInput('fixture-user:p%40ss@45.92.20.7:8000'),
    ).toBe('fixture-user:••••••@45.92.20.7:8000');
  });

  it('does not reveal a password from malformed input', () => {
    const masked = maskProxyInput(
      'fixture-user:known-decoded-password@host.test:not-a-port',
    );

    expect(masked).toBe('Invalid proxy configuration');
    expect(masked).not.toContain('known-decoded-password');
  });

  it('does not include the decoded password', () => {
    const masked = maskProxyInput(
      'fixture-user:known%40decoded%3Apassword@host.test:8080',
    );

    expect(masked).not.toContain('known@decoded:password');
    expect(masked).not.toContain('known%40decoded%3Apassword');
  });
});
