import type { Issue, Severity } from '@code-quality/core';
import { SLOP_RULES } from './rules/slop.js';
import type { FileReport } from './types.js';

/**
 * The slop score: does this code hold up, or does it only look like it does?
 *
 * Read it as a grade out of 100, the way a test score reads — **100 means the
 * code holds up, 0 means it is scaffolding**. It is not a quantity of slop, and
 * the name follows the label on the designed screen rather than the arithmetic.
 *
 * Four dimensions are combined with a **weighted geometric mean**, and that
 * choice is the whole point: an arithmetic mean lets three healthy dimensions
 * carry one rotten one, so a file that is 40% duplicated still scores
 * respectably. A geometric mean cannot be rescued that way — one dimension near
 * zero drags the result down however good the rest are. Borrowed from
 * AI-SLOP-Detector, which combines its four measurements the same way for the
 * same reason. See the vault note `Duplication and slop detection`.
 *
 * Every dimension here is a heuristic over what the analyzer already measures.
 * None of them is a proof, and the thresholds below are judgement calls that
 * should move once there is real data to calibrate against.
 */

/** Weights sum to 1. Evidence-based dimensions are worth more than proxies. */
const WEIGHTS = {
  logicDensity: 0.2,
  commentIntegrity: 0.2,
  reuse: 0.3,
  findings: 0.3,
} as const;

/**
 * Cyclomatic complexity per line in code that is doing something. Real TS/JS
 * lands around 0.10–0.25; a file of interfaces, constants or re-exports lands
 * near zero — which is why this dimension is weighted below the other two and
 * why declarative code is expected to score poorly on it without being wrong.
 */
const TARGET_COMPLEXITY_PER_LINE = 0.15;

/** How much a finding counts, by severity, before scaling per thousand lines. */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  BLOCKER: 10,
  CRITICAL: 5,
  MAJOR: 2,
  MINOR: 1,
  INFO: 0,
};

/**
 * Weighted slop findings per 1000 lines that costs the whole dimension. Ten
 * majors in a thousand lines (a weight of 20) is a codebase in trouble, so that
 * is where the dimension bottoms out.
 */
const FINDINGS_FLOOR_RATE = 20;

/**
 * No dimension is allowed to reach zero. With a true zero the geometric mean is
 * zero too, and every catastrophically bad project would score identically —
 * losing the distinction between bad and hopeless. A floor of 1 keeps the
 * "one rotten dimension sinks it" property while preserving an ordering.
 */
const DIMENSION_FLOOR = 1;

const SLOP_RULE_KEYS: ReadonlySet<string> = new Set(SLOP_RULES.map((rule) => rule.key));
const REDUNDANT_COMMENT_KEY = 'ts:no-redundant-comment';

export interface SlopDimensions {
  /** Complexity per line against what working code looks like. */
  logicDensity: number;
  /** How many of the comments restate the code instead of explaining it. */
  commentIntegrity: number;
  /** The inverse of duplicated line density. */
  reuse: number;
  /** Slop-rule findings, weighted by severity, per thousand lines. */
  findings: number;
}

export interface SlopScore extends SlopDimensions {
  /** The weighted geometric mean of the four, 1–100. */
  score: number;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return DIMENSION_FLOOR;
  return Math.min(100, Math.max(DIMENSION_FLOOR, value));
}

export interface SlopInput {
  files: FileReport[];
  issues: Issue[];
  /** Already a percentage: the `duplicated_lines_density` measure. */
  duplicatedLinesDensity: number;
}

/**
 * Returns `null` when there is nothing to judge.
 *
 * An empty analysis must not score 100. That is the same false all-clear the
 * quality gate used to give an empty repository, and a perfect grade over zero
 * lines is worse than no grade, because it looks like an answer.
 */
export function computeSlopScore({ files, issues, duplicatedLinesDensity }: SlopInput): SlopScore | null {
  const ncloc = files.reduce((total, file) => total + file.ncloc, 0);
  if (files.length === 0 || ncloc === 0) return null;

  const complexity = files.reduce((total, file) => total + file.complexity, 0);
  const commentLines = files.reduce((total, file) => total + file.commentLines, 0);

  const logicDensity = clamp((complexity / ncloc / TARGET_COMPLEXITY_PER_LINE) * 100);

  // A file with no comments at all offers no evidence of comment inflation, so
  // it scores full marks here. That is not an endorsement — it is this
  // dimension declining to guess about something it cannot see.
  const redundant = issues.filter((issue) => issue.ruleKey === REDUNDANT_COMMENT_KEY).length;
  const commentIntegrity = commentLines === 0 ? 100 : clamp(100 - (redundant / commentLines) * 100);

  const reuse = clamp(100 - duplicatedLinesDensity);

  const weighted = issues
    .filter((issue) => SLOP_RULE_KEYS.has(issue.ruleKey))
    .reduce((total, issue) => total + SEVERITY_WEIGHT[issue.severity], 0);
  const rate = (weighted / ncloc) * 1000;
  const findings = clamp(100 - (rate / FINDINGS_FLOOR_RATE) * 100);

  const dimensions: SlopDimensions = { logicDensity, commentIntegrity, reuse, findings };

  const score =
    Math.pow(logicDensity, WEIGHTS.logicDensity) *
    Math.pow(commentIntegrity, WEIGHTS.commentIntegrity) *
    Math.pow(reuse, WEIGHTS.reuse) *
    Math.pow(findings, WEIGHTS.findings);

  return { ...dimensions, score: clamp(Math.round(score)) };
}
