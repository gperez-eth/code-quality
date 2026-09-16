import {
  type GateScope,
  type Issue,
  type Measure,
  type MeasureSet,
  type MetricKey,
  ratingFromDebtRatio,
  ratingFromWorstSeverity,
  ratingValue,
} from '@code-quality/core';
import { coveragePercent, type CoverageReport } from './coverage.js';
import { commentDensity } from './metrics.js';
import { computeSlopScore } from './slop.js';
import { duplicationDensity, type DuplicationReport } from './duplication.js';
import type { FileReport } from './types.js';

/**
 * What it is assumed to cost to write one line of code: 0.06 days on an
 * eight-hour day. The technical debt ratio is remediation effort over this,
 * and the maintainability rating follows from that ratio.
 */
export const DEV_COST_MINUTES_PER_LINE = 0.06 * 8 * 60;

function severityCounts(issues: Issue[]): { blocker: number; critical: number; major: number; minor: number } {
  const counts = { blocker: 0, critical: 0, major: 0, minor: 0 };

  for (const issue of issues) {
    if (issue.severity === 'BLOCKER') counts.blocker += 1;
    else if (issue.severity === 'CRITICAL') counts.critical += 1;
    else if (issue.severity === 'MAJOR') counts.major += 1;
    else if (issue.severity === 'MINOR') counts.minor += 1;
  }

  return counts;
}

export interface MeasureInput {
  files: FileReport[];
  issues: Issue[];
  duplication: DuplicationReport;
  /**
   * Absent whenever `--coverage` was not given. The analyzer never runs a
   * test suite itself — see ADR-0005 — so there is no such thing as a
   * default of zero here: no report supplied means no coverage measures at
   * all, not a coverage of zero.
   */
  coverage?: CoverageReport;
}

/** Everything the scorecards on the Project Overview screen read from. */
export function computeMeasures({ files, issues, duplication, coverage }: MeasureInput): MeasureSet {
  const bugs = issues.filter((issue) => issue.type === 'BUG');
  const vulnerabilities = issues.filter((issue) => issue.type === 'VULNERABILITY');
  const smells = issues.filter((issue) => issue.type === 'CODE_SMELL');
  const hotspots = issues.filter((issue) => issue.type === 'SECURITY_HOTSPOT');

  const ncloc = files.reduce((total, file) => total + file.ncloc, 0);
  const lines = files.reduce((total, file) => total + file.lines, 0);
  const commentLines = files.reduce((total, file) => total + file.commentLines, 0);
  const complexity = files.reduce((total, file) => total + file.complexity, 0);
  const cognitive = files.reduce((total, file) => total + file.cognitiveComplexity, 0);

  // Technical debt is maintainability work only: bugs and vulnerabilities are
  // counted and rated, not billed to the debt clock.
  const debt = smells.reduce((total, issue) => total + issue.effortMinutes, 0);
  const debtRatio = ncloc === 0 ? 0 : debt / (ncloc * DEV_COST_MINUTES_PER_LINE);

  const duplicatedLinesDensity = duplicationDensity(duplication.duplicatedLines, lines);

  const values: Array<[MetricKey, number]> = [
    ['bugs', bugs.length],
    ['reliability_rating', ratingValue(ratingFromWorstSeverity(severityCounts(bugs)))],
    ['vulnerabilities', vulnerabilities.length],
    ['security_rating', ratingValue(ratingFromWorstSeverity(severityCounts(vulnerabilities)))],
    ['security_hotspots', hotspots.length],
    ['code_smells', smells.length],
    ['sqale_index', debt],
    ['sqale_rating', ratingValue(ratingFromDebtRatio(debtRatio))],
    ['duplicated_lines_density', duplicatedLinesDensity],
    ['duplicated_blocks', duplication.duplicatedBlocks],
    ['ncloc', ncloc],
    ['lines', lines],
    ['files', files.length],
    ['complexity', complexity],
    ['cognitive_complexity', cognitive],
    ['comment_lines_density', commentDensity(commentLines, ncloc)],
  ];

  // Only present when a report was supplied on disk. No BRDA records are
  // parsed, so there is no branch data to blend into `coverage` the way
  // SonarQube does — it and `line_coverage` are the same number here.
  if (coverage) {
    const percent = coveragePercent(coverage.linesHit, coverage.linesFound);
    values.push(
      ['coverage', percent],
      ['line_coverage', percent],
      ['uncovered_lines', coverage.linesFound - coverage.linesHit],
    );
  }

  // Null over an empty analysis: a perfect grade across zero lines is the same
  // false all-clear the gate used to give, wearing a different hat.
  const slop = computeSlopScore({ files, issues, duplicatedLinesDensity });
  if (slop) {
    values.push(
      ['slop_score', slop.score],
      ['slop_logic_density', Math.round(slop.logicDensity)],
      ['slop_comment_integrity', Math.round(slop.commentIntegrity)],
      ['slop_reuse', Math.round(slop.reuse)],
      ['slop_findings', Math.round(slop.findings)],
    );
  }

  const measures: MeasureSet = {};
  for (const [metric, value] of values) {
    measures[metric] = { metric, value };
  }
  return measures;
}

/**
 * On a first analysis there is nothing to compare against, so the whole
 * codebase is the leak period — which is also what makes a gate written
 * against New Code mean anything on day one.
 */
export function treatAllCodeAsNew(measures: MeasureSet): MeasureSet {
  const copy: MeasureSet = {};

  for (const [metric, measure] of Object.entries(measures) as Array<[MetricKey, Measure]>) {
    copy[metric] = { ...measure, newCodeValue: measure.value };
  }

  return copy;
}

/** Adapts a measure set to the reader `evaluateQualityGate` expects. */
export function measureReader(measures: MeasureSet): (metric: MetricKey, scope: GateScope) => number | null {
  return (metric, scope) => {
    const measure = measures[metric];
    if (!measure) return null;
    if (scope === 'OVERALL') return measure.value;
    return measure.newCodeValue ?? null;
  };
}
