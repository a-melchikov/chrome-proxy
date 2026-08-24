import { success, type Result } from '../proxy/errors';
import { parseRules, type Rule } from './parser';

export interface NormalizedRules {
  rules: Rule[];
  text: string;
}

export function normalizeRules(input: string): Result<NormalizedRules> {
  const parsed = parseRules(input);

  if (!parsed.ok) {
    return parsed;
  }

  const seen = new Set<string>();
  const rules: Rule[] = [];
  const lines: string[] = [];

  for (const rule of parsed.value.rules) {
    const line = formatRule(rule);
    const key = `${rule.type}:${line}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    rules.push(rule);
    lines.push(line);
  }

  return success({
    rules,
    text: lines.join('\n'),
  });
}

function formatRule(rule: Rule): string {
  switch (rule.type) {
    case 'hostname':
    case 'ipv4':
      return rule.value;
    case 'cidr':
      return `${rule.network}/${rule.prefix}`;
  }
}
