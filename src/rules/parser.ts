import { failure, success, type Result } from '../proxy/errors';
import { canonicalizeHost } from './hostname';
import { isValidCidrPrefix, parseCidr, parseIPv4 } from './ipv4';

export type Rule =
  | { type: 'hostname'; value: string }
  | { type: 'ipv4'; value: string }
  | { type: 'cidr'; network: string; prefix: number };

export interface ParsedRules {
  rules: Rule[];
}

export function parseRules(input: string): Result<ParsedRules> {
  const rules: Rule[] = [];
  const lines = input.split(/\r?\n/u);

  for (const [index, rawLine] of lines.entries()) {
    const value = rawLine.trim();

    if (value.length === 0) {
      continue;
    }

    const parsed = parseRule(value, index + 1);

    if (!parsed.ok) {
      return parsed;
    }

    rules.push(parsed.value);
  }

  return success({ rules });
}

function parseRule(value: string, line: number): Result<Rule> {
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(value)) {
    return invalidRule(
      line,
      'URL is not supported; enter only a hostname.',
    );
  }

  if (value.includes('/')) {
    const cidr = parseCidr(value);

    if (cidr === null) {
      const [address = '', rawPrefix = ''] = value.split('/');

      if (canonicalizeHost(address)?.type === 'hostname') {
        return invalidRule(
          line,
          'Paths are not supported; enter only a hostname.',
        );
      }

      if (
        parseIPv4(address) !== null &&
        (!/^\d+$/u.test(rawPrefix) ||
          !isValidCidrPrefix(Number(rawPrefix)))
      ) {
        return invalidRule(
          line,
          'IPv4 CIDR prefix must be an integer from 0 to 32.',
        );
      }

      return invalidRule(
        line,
        'CIDR rule must contain a valid IPv4 address and prefix.',
      );
    }

    return success({
      type: 'cidr',
      network: cidr.network,
      prefix: cidr.prefix,
    });
  }

  const hasWildcard = value.startsWith('*.');
  const withoutWildcard = hasWildcard ? value.slice(2) : value;

  if (withoutWildcard.length === 0 || withoutWildcard.includes('*')) {
    return invalidRule(
      line,
      'Wildcard is supported only as a leading *.hostname prefix.',
    );
  }

  const host = canonicalizeHost(withoutWildcard);

  if (host === null) {
    return invalidRule(
      line,
      value.includes(':')
        ? 'Site ports and IPv6 addresses are not supported.'
        : 'Enter a valid hostname or IPv4 address.',
    );
  }

  if (hasWildcard && host.type !== 'hostname') {
    return invalidRule(line, 'Wildcard is supported only for hostnames.');
  }

  return success(host);
}

function invalidRule(line: number, message: string): Result<never> {
  return failure('INVALID_RULE', message, { line });
}
