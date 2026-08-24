import { describe, expect, it } from 'vitest';
import {
  buildAllowlistProxyConfig,
  type AllowlistProxyConfig,
} from '../src/proxy/config';
import { generateAllowlistPac } from '../src/proxy/pac';
import type { ParsedProxy } from '../src/proxy/parser';
import type { Rule } from '../src/rules/parser';

type PacFunction = (url: string, host: string) => string;
type DnsDomainIs = (host: string, domain: string) => boolean;
type IsInNet = (host: string, network: string, mask: string) => boolean;

const proxy: ParsedProxy = {
  username: 'fixture-user',
  password: 'fixture-pass',
  host: 'proxy.example.test',
  port: 3128,
  scheme: 'http',
};

const rules: Rule[] = [
  { type: 'hostname', value: 'example.com' },
  { type: 'ipv4', value: '203.0.113.10' },
  { type: 'cidr', network: '192.168.0.0', prefix: 16 },
];

describe('allowlist PAC generation', () => {
  it('creates a mandatory PAC config without credentials or direct fallback', () => {
    const config = buildAllowlistProxyConfig(proxy, rules);

    expect(config.mode).toBe('pac_script');
    expect(config.pacScript.mandatory).toBe(true);
    expect(config.pacScript.data).not.toContain('fixture-user');
    expect(config.pacScript.data).not.toContain('fixture-pass');
    expect(config.pacScript.data).toContain('return "PROXY proxy.example.test:3128";');
    expect(config.pacScript.data).not.toContain('PROXY proxy.example.test:3128; DIRECT');
  });

  it.each([
    ['example.com', 'PROXY proxy.example.test:3128'],
    ['api.example.com', 'PROXY proxy.example.test:3128'],
    ['deep.api.example.com', 'PROXY proxy.example.test:3128'],
    ['EXAMPLE.COM', 'PROXY proxy.example.test:3128'],
    ['notexample.com', 'DIRECT'],
    ['example.com.evil.org', 'DIRECT'],
  ] as const)('routes hostname %s to %s', (host, expected) => {
    const findProxy = compilePac(buildAllowlistProxyConfig(proxy, rules));

    expect(findProxy(`https://${host}/`, host)).toBe(expected);
  });

  it('matches an exact IPv4 address', () => {
    const findProxy = compilePac(buildAllowlistProxyConfig(proxy, rules));

    expect(findProxy('https://203.0.113.10/', '203.0.113.10')).toBe(
      'PROXY proxy.example.test:3128',
    );
    expect(findProxy('https://203.0.113.11/', '203.0.113.11')).toBe('DIRECT');
  });

  it('uses the canonical dotted mask for CIDR matching', () => {
    const config = buildAllowlistProxyConfig(proxy, rules);
    const calls: Array<[string, string, string]> = [];
    const findProxy = compilePac(config, (host, network, mask) => {
      calls.push([host, network, mask]);
      return host === '192.168.20.30';
    });

    expect(findProxy('https://192.168.20.30/', '192.168.20.30')).toBe(
      'PROXY proxy.example.test:3128',
    );
    expect(calls).toContainEqual([
      '192.168.20.30',
      '192.168.0.0',
      '255.255.0.0',
    ]);
  });

  it('returns DIRECT for every host with an empty allowlist', () => {
    const config = buildAllowlistProxyConfig(proxy, []);
    const findProxy = compilePac(config);

    expect(findProxy('https://example.com/', 'example.com')).toBe('DIRECT');
    expect(config.pacScript.data).not.toContain('PROXY proxy.example.test:3128');
  });

  it('safely serializes generated string literals', () => {
    const unsafeProxy: ParsedProxy = {
      ...proxy,
      host: 'proxy.test"; throw new Error("injected") //',
    };
    const unsafeRules: Rule[] = [
      {
        type: 'hostname',
        value: 'example.test"); throw new Error("injected") //',
      },
    ];
    const pac = generateAllowlistPac(unsafeProxy, unsafeRules);

    expect(() => compilePacData(pac)).not.toThrow();
    expect(pac).toContain('\\"');
  });
});

function compilePac(
  config: AllowlistProxyConfig,
  isInNet: IsInNet = () => false,
): PacFunction {
  return compilePacData(config.pacScript.data, isInNet);
}

function compilePacData(
  data: string,
  isInNet: IsInNet = () => false,
): PacFunction {
  const factory = new Function(
    'dnsDomainIs',
    'isInNet',
    `${data}\nreturn FindProxyForURL;`,
  ) as (dnsDomainIs: DnsDomainIs, isInNet: IsInNet) => PacFunction;

  return factory((host, domain) => host.endsWith(domain), isInNet);
}
