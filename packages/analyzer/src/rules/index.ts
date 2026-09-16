import type { LanguageId, Rule } from '../types.js';
import { BUG_RULES } from './bugs.js';
import { COMPLEXITY_RULES } from './complexity.js';
import { SECURITY_RULES } from './security.js';
import { SMELL_RULES } from './smells.js';

/** The built-in rule set, in the order the Rules screen lists them. */
export const ALL_RULES: readonly Rule[] = [...BUG_RULES, ...SECURITY_RULES, ...SMELL_RULES, ...COMPLEXITY_RULES];

const BY_KEY = new Map(ALL_RULES.map((rule) => [rule.key, rule]));

export function ruleByKey(key: string): Rule | undefined {
  return BY_KEY.get(key);
}

export function rulesFor(language: LanguageId, rules: readonly Rule[] = ALL_RULES): Rule[] {
  return rules.filter((rule) => rule.languages.includes(language));
}

export { BUG_RULES, COMPLEXITY_RULES, SECURITY_RULES, SMELL_RULES };
