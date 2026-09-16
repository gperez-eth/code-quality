import type { Rating } from './rating.js';

export type MetricValueType = 'INT' | 'FLOAT' | 'PERCENT' | 'MINUTES' | 'RATING';

/** Lower is better for most metrics; coverage is the notable exception. */
export type MetricDirection = 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER';

export type MetricDomain = 'RELIABILITY' | 'SECURITY' | 'MAINTAINABILITY' | 'COVERAGE' | 'DUPLICATION' | 'SIZE';

export interface MetricDefinition {
  key: string;
  name: string;
  domain: MetricDomain;
  valueType: MetricValueType;
  direction: MetricDirection;
}

/**
 * The metric catalogue the dashboard reads from. Keys are stable identifiers
 * used in the database, the quality gate conditions and the URL query strings.
 */
export const METRICS = {
  bugs: { key: 'bugs', name: 'Bugs', domain: 'RELIABILITY', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  reliability_rating: { key: 'reliability_rating', name: 'Reliability Rating', domain: 'RELIABILITY', valueType: 'RATING', direction: 'LOWER_IS_BETTER' },
  vulnerabilities: { key: 'vulnerabilities', name: 'Vulnerabilities', domain: 'SECURITY', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  security_rating: { key: 'security_rating', name: 'Security Rating', domain: 'SECURITY', valueType: 'RATING', direction: 'LOWER_IS_BETTER' },
  security_hotspots: { key: 'security_hotspots', name: 'Security Hotspots', domain: 'SECURITY', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  code_smells: { key: 'code_smells', name: 'Code Smells', domain: 'MAINTAINABILITY', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  sqale_index: { key: 'sqale_index', name: 'Technical Debt', domain: 'MAINTAINABILITY', valueType: 'MINUTES', direction: 'LOWER_IS_BETTER' },
  sqale_rating: { key: 'sqale_rating', name: 'Maintainability Rating', domain: 'MAINTAINABILITY', valueType: 'RATING', direction: 'LOWER_IS_BETTER' },
  // The slop score and the four dimensions it is the geometric mean of. Graded
  // out of 100 where **higher is better** — unusual in this catalogue, and the
  // reason the direction is spelled out on every one of them. `slop_score`
  // reads like a test score, not like a quantity of slop.
  slop_score: { key: 'slop_score', name: 'Slop Score', domain: 'MAINTAINABILITY', valueType: 'INT', direction: 'HIGHER_IS_BETTER' },
  slop_logic_density: { key: 'slop_logic_density', name: 'Logic Density', domain: 'MAINTAINABILITY', valueType: 'INT', direction: 'HIGHER_IS_BETTER' },
  slop_comment_integrity: { key: 'slop_comment_integrity', name: 'Comment Integrity', domain: 'MAINTAINABILITY', valueType: 'INT', direction: 'HIGHER_IS_BETTER' },
  slop_reuse: { key: 'slop_reuse', name: 'Reuse', domain: 'MAINTAINABILITY', valueType: 'INT', direction: 'HIGHER_IS_BETTER' },
  slop_findings: { key: 'slop_findings', name: 'Slop Findings', domain: 'MAINTAINABILITY', valueType: 'INT', direction: 'HIGHER_IS_BETTER' },
  coverage: { key: 'coverage', name: 'Coverage', domain: 'COVERAGE', valueType: 'PERCENT', direction: 'HIGHER_IS_BETTER' },
  line_coverage: { key: 'line_coverage', name: 'Line Coverage', domain: 'COVERAGE', valueType: 'PERCENT', direction: 'HIGHER_IS_BETTER' },
  uncovered_lines: { key: 'uncovered_lines', name: 'Uncovered Lines', domain: 'COVERAGE', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  duplicated_lines_density: { key: 'duplicated_lines_density', name: 'Duplications', domain: 'DUPLICATION', valueType: 'PERCENT', direction: 'LOWER_IS_BETTER' },
  duplicated_blocks: { key: 'duplicated_blocks', name: 'Duplicated Blocks', domain: 'DUPLICATION', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  ncloc: { key: 'ncloc', name: 'Lines of Code', domain: 'SIZE', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  lines: { key: 'lines', name: 'Lines', domain: 'SIZE', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  files: { key: 'files', name: 'Files', domain: 'SIZE', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  complexity: { key: 'complexity', name: 'Cyclomatic Complexity', domain: 'SIZE', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  cognitive_complexity: { key: 'cognitive_complexity', name: 'Cognitive Complexity', domain: 'SIZE', valueType: 'INT', direction: 'LOWER_IS_BETTER' },
  comment_lines_density: { key: 'comment_lines_density', name: 'Comments', domain: 'SIZE', valueType: 'PERCENT', direction: 'HIGHER_IS_BETTER' },
} as const satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRICS;

export function isMetricKey(key: string): key is MetricKey {
  return key in METRICS;
}

/**
 * Every measure is recorded twice: once for the whole codebase and once for the
 * leak period ("New Code"), which is the right-hand column of every scorecard.
 */
export interface Measure {
  metric: MetricKey;
  value: number;
  newCodeValue?: number;
}

export type MeasureSet = Partial<Record<MetricKey, Measure>>;

export function formatMeasure(metric: MetricKey, value: number): string {
  // Widened deliberately: the catalogue happens not to use every value type
  // yet, but this function must stay exhaustive over MetricValueType.
  switch (METRICS[metric].valueType as MetricValueType) {
    case 'PERCENT':
      return `${value.toFixed(1)}%`;
    case 'RATING':
      return (['A', 'B', 'C', 'D', 'E'] satisfies Rating[])[Math.max(0, Math.min(4, Math.round(value) - 1))] ?? 'A';
    case 'MINUTES':
      return `${value}`;
    case 'FLOAT':
      return value.toFixed(1);
    case 'INT':
      return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : `${value}`;
  }
}
