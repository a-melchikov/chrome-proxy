import { failure, success, type Result } from '../proxy/errors';
import { canonicalizeHost } from './hostname';
import { parseCidr } from './ipv4';

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
  if (value.includes('/')) {
    const cidr = parseCidr(value);

    if (cidr === null) {
      return invalidRule(line);
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
    return invalidRule(line);
  }

  const host = canonicalizeHost(withoutWildcard);

  if (host === null) {
    return invalidRule(line);
  }

  if (hasWildcard && host.type !== 'hostname') {
    return invalidRule(line);
  }

  return success(host);
}

function invalidRule(line: number): Result<never> {
  return failure('INVALID_RULE', `Rule on line ${line} is invalid.`, { line });
}
