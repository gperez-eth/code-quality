import { githubRequest } from './http.js';

/**
 * The quality gate, said back to GitHub as a check run.
 *
 * This is the feature teams actually notice: a line in the pull request that
 * goes red when the gate fails, next to their tests. It needs `Checks: Read &
 * Write` on the installation, and an **installation token** — a check run is
 * written into someone's repository, which the app JWT has no business doing.
 */

export type GateStatus = 'PASSED' | 'FAILED' | null;

export interface AnalysisOutcome {
  /** Null means the analysis measured nothing, not that it passed. */
  gate: GateStatus;
  newIssues: number;
  reopenedIssues: number;
  closedIssues: number;
  unchangedIssues: number;
}

export interface CheckTarget {
  owner: string;
  repo: string;
  /** The commit analysed. A check run is attached to a commit, not a branch. */
  headSha: string;
  /** Where "Details" goes. Omitted when no dashboard URL is configured. */
  detailsUrl?: string;
}

/** What GitHub shows as the check's state. */
type Conclusion = 'success' | 'failure' | 'neutral';

function conclusionFor(gate: GateStatus): Conclusion {
  if (gate === 'PASSED') return 'success';
  if (gate === 'FAILED') return 'failure';

  // An analysis that measured nothing is not a pass. `neutral` is the honest
  // answer and, unlike `failure`, does not block a merge on our own blind spot.
  return 'neutral';
}

function titleFor(gate: GateStatus): string {
  if (gate === 'PASSED') return 'Quality gate passed';
  if (gate === 'FAILED') return 'Quality gate failed';
  return 'Nothing to measure';
}

function summaryFor(outcome: AnalysisOutcome): string {
  if (outcome.gate === null) {
    return 'The analysis finished but found no files it could measure, so the gate has no verdict to give.';
  }

  const lines = [
    `| | |`,
    `| --- | --- |`,
    `| New issues | ${outcome.newIssues} |`,
    `| Reopened | ${outcome.reopenedIssues} |`,
    `| Fixed | ${outcome.closedIssues} |`,
    `| Still open | ${outcome.unchangedIssues} |`,
  ];

  const opener =
    outcome.gate === 'FAILED'
      ? 'The gate failed on new code.'
      : outcome.newIssues === 0
        ? 'No new issues.'
        : `${outcome.newIssues} new issue${outcome.newIssues === 1 ? '' : 's'}, none bad enough to fail the gate.`;

  return `${opener}\n\n${lines.join('\n')}`;
}

/**
 * Publishes the verdict. Always a completed run: the analysis is already over
 * by the time this is called, so there is no in-progress state worth the extra
 * round trip.
 */
export async function publishQualityGateCheck(
  token: string,
  target: CheckTarget,
  outcome: AnalysisOutcome,
): Promise<void> {
  await githubRequest(`/repos/${target.owner}/${target.repo}/check-runs`, {
    method: 'POST',
    token,
    body: {
      name: 'Code Quality',
      head_sha: target.headSha,
      status: 'completed',
      conclusion: conclusionFor(outcome.gate),
      completed_at: new Date().toISOString(),
      ...(target.detailsUrl ? { details_url: target.detailsUrl } : {}),
      output: {
        title: titleFor(outcome.gate),
        summary: summaryFor(outcome),
      },
    },
  });
}

export const __testing = { conclusionFor, summaryFor, titleFor };
