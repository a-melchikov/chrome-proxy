import { prefixToDottedMask } from '../rules/ipv4';
import type { Rule } from '../rules/parser';
import type { ParsedProxy } from './parser';

export function generateAllowlistPac(
  proxy: ParsedProxy,
  rules: readonly Rule[],
): string {
  const conditions = rules.map(buildRuleCondition);
  const proxyDirective = serialize(`PROXY ${proxy.host}:${proxy.port}`);

  return [
    'function FindProxyForURL(url, host) {',
    '  host = host.toLowerCase();',
    ...(conditions.length > 0
      ? [
          `  if (${conditions.join(' ||\n      ')}) {`,
          `    return ${proxyDirective};`,
          '  }',
        ]
      : []),
    '  return "DIRECT";',
    '}',
  ].join('\n');
}

function buildRuleCondition(rule: Rule): string {
  switch (rule.type) {
    case 'hostname': {
      const hostname = serialize(rule.value);
      const suffix = serialize(`.${rule.value}`);
      return `(host === ${hostname} || dnsDomainIs(host, ${suffix}))`;
    }
    case 'ipv4':
      return `host === ${serialize(rule.value)}`;
    case 'cidr': {
      const mask = prefixToDottedMask(rule.prefix);

      if (mask === null) {
        throw new RangeError('Normalized CIDR rule has an invalid prefix.');
      }

      return `isInNet(host, ${serialize(rule.network)}, ${serialize(mask)})`;
    }
  }
}

function serialize(value: string): string {
  return JSON.stringify(value);
}
