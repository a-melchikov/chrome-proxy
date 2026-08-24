import {
  cidrRangesOverlap,
  isIPv4InCidr,
  type ParsedCidr,
} from '../rules/ipv4';
import type { Rule } from '../rules/parser';

export interface ProxyConfigWarning {
  code: 'IMPLICIT_LOOPBACK_BYPASS';
  message: string;
  rule: string;
}

const IMPLICIT_BYPASS_RANGES: readonly ParsedCidr[] = [
  { network: '127.0.0.0', prefix: 8 },
  { network: '169.254.0.0', prefix: 16 },
];

export function getAllowlistWarnings(
  rules: readonly Rule[],
): ProxyConfigWarning[] {
  return rules
    .filter(isPotentialImplicitBypassRule)
    .map((rule) => ({
      code: 'IMPLICIT_LOOPBACK_BYPASS',
      message:
        'Chrome may bypass this loopback or link-local destination implicitly.',
      rule: formatRule(rule),
    }));
}

export function isPotentialImplicitBypassRule(rule: Rule): boolean {
  switch (rule.type) {
    case 'hostname':
      return rule.value === 'localhost';
    case 'ipv4':
      return IMPLICIT_BYPASS_RANGES.some((range) =>
        isIPv4InCidr(rule.value, range),
      );
    case 'cidr':
      return IMPLICIT_BYPASS_RANGES.some((range) =>
        cidrRangesOverlap(rule, range),
      );
  }
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
