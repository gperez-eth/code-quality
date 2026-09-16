import { type MetricKey, METRICS } from './metric.js';
import { RATINGS, type Rating } from './rating.js';

export const GATE_OPERATORS = ['GT', 'LT', 'WORSE_THAN'] as const;
export type GateOperator = (typeof GATE_OPERATORS)[number];

export type GateScope = 'OVERALL' | 'NEW_CODE';

export interface QualityGateCondition {
  metric: MetricKey;
  operator: GateOperator;
  /** Ratings are expressed as their letter; everything else as a number. */
  threshold: number | Rating;
  scope: GateScope;
}

export interface QualityGate {
  id: string;
  name: string;
  isDefault: boolean;
  isBuiltIn: boolean;
  conditions: QualityGateCondition[];
}

/** A single condition either holds or it does not. */
export type ConditionStatus = 'PASSED' | 'FAILED';

/**
 * A gate has a third outcome: nothing was measured. An analysis that found no
 * source files cannot pass — a green badge over an empty repository is a false
 * all-clear, and the causes are mundane: the wrong branch, an over-eager
 * .gitignore, a project pointed at a repo whose code was never pushed.
 */
export type GateStatus = ConditionStatus | 'NOT_COMPUTED';

export interface ConditionResult extends QualityGateCondition {
  actual: number | null;
  status: ConditionStatus;
}

export interface QualityGateResult {
  status: GateStatus;
  conditions: ConditionResult[];
  /** Only the conditions that failed — what the red callout box lists. */
  failing: ConditionResult[];
}

function ratingToNumber(rating: Rating): number {
  return RATINGS.indexOf(rating) + 1;
}

function thresholdToNumber(threshold: number | Rating): number {
  return typeof threshold === 'number' ? threshold : ratingToNumber(threshold);
}

function evaluateCondition(condition: QualityGateCondition, actual: number | null): ConditionResult {
  if (actual === null) {
    // A metric the analysis did not produce cannot fail the gate.
    return { ...condition, actual, status: 'PASSED' };
  }

  const threshold = thresholdToNumber(condition.threshold);
  let failed: boolean;
  switch (condition.operator) {
    case 'GT':
      failed = actual > threshold;
      break;
    case 'LT':
      failed = actual < threshold;
      break;
    case 'WORSE_THAN':
      // Ratings are stored 1..5 where higher is worse.
      failed = actual > threshold;
      break;
  }

  return { ...condition, actual, status: failed ? 'FAILED' : 'PASSED' };
}

/**
 * Evaluates a gate against a measure lookup. `readMeasure` returns null when
 * the analysis produced no value for that metric and scope.
 */
export function evaluateQualityGate(
  gate: QualityGate,
  readMeasure: (metric: MetricKey, scope: GateScope) => number | null,
): QualityGateResult {
  const conditions = gate.conditions.map((condition) =>
    evaluateCondition(condition, readMeasure(condition.metric, condition.scope)),
  );
  const failing = conditions.filter((c) => c.status === 'FAILED');

  // Read off `files` rather than inferred from the conditions: when every
  // measure is absent, no condition can fail, which is exactly how an empty
  // repository came out PASSED with three A ratings over zero lines of code.
  if (!readMeasure('files', 'OVERALL')) {
    return { status: 'NOT_COMPUTED', conditions, failing: [] };
  }

  return {
    status: failing.length > 0 ? 'FAILED' : 'PASSED',
    conditions,
    failing,
  };
}

/** "Security Rating on New Code is worse than A" — the banner's wording. */
export function describeCondition(condition: QualityGateCondition): string {
  const metric = METRICS[condition.metric].name;
  const where = condition.scope === 'NEW_CODE' ? ' on New Code' : '';
  const operator =
    condition.operator === 'WORSE_THAN' ? 'is worse than' : condition.operator === 'GT' ? 'is greater than' : 'is less than';
  return `${metric}${where} ${operator} ${condition.threshold}`;
}

/**
 * The built-in gate, mirroring the "Clean as You Code" defaults shown on the
 * Quality Gates screen: hold new code to a high bar, leave legacy code alone.
 */
export const SONAR_WAY_GATE: QualityGate = {
  id: 'sonar-way',
  name: 'Sonar way',
  isDefault: true,
  isBuiltIn: true,
  conditions: [
    { metric: 'security_rating', operator: 'WORSE_THAN', threshold: 'A', scope: 'NEW_CODE' },
    { metric: 'reliability_rating', operator: 'WORSE_THAN', threshold: 'A', scope: 'NEW_CODE' },
    { metric: 'sqale_rating', operator: 'WORSE_THAN', threshold: 'A', scope: 'NEW_CODE' },
    { metric: 'coverage', operator: 'LT', threshold: 80, scope: 'NEW_CODE' },
    { metric: 'duplicated_lines_density', operator: 'GT', threshold: 3, scope: 'NEW_CODE' },
    { metric: 'security_hotspots', operator: 'GT', threshold: 0, scope: 'NEW_CODE' },
  ],
};
