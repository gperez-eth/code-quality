import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __testing } from './checks.js';

const { conclusionFor, summaryFor, titleFor } = __testing;

const outcome = {
  gate: 'PASSED' as const,
  newIssues: 0,
  reopenedIssues: 0,
  closedIssues: 3,
  unchangedIssues: 7,
};

test('a gate verdict maps to the conclusion GitHub shows', () => {
  assert.equal(conclusionFor('PASSED'), 'success');
  assert.equal(conclusionFor('FAILED'), 'failure');
});

test('an analysis that measured nothing is neutral, not a pass', () => {
  // The database has no NOT_COMPUTED, so a null gate on a finished analysis is
  // what "it measured nothing" looks like. Calling that success would be a
  // green tick for a scan that read no files.
  assert.equal(conclusionFor(null), 'neutral');
  assert.equal(titleFor(null), 'Nothing to measure');
  assert.match(summaryFor({ ...outcome, gate: null }), /no files it could measure/);
});

test('the summary counts what changed since the baseline', () => {
  const summary = summaryFor({ gate: 'FAILED', newIssues: 4, reopenedIssues: 1, closedIssues: 2, unchangedIssues: 9 });

  assert.match(summary, /The gate failed on new code\./);
  assert.match(summary, /\| New issues \| 4 \|/);
  assert.match(summary, /\| Reopened \| 1 \|/);
  assert.match(summary, /\| Fixed \| 2 \|/);
  assert.match(summary, /\| Still open \| 9 \|/);
});

test('a clean pass says so instead of listing a zero', () => {
  assert.match(summaryFor(outcome), /^No new issues\./);
});

test('one new issue is not "1 new issues"', () => {
  const summary = summaryFor({ ...outcome, newIssues: 1 });
  assert.match(summary, /1 new issue,/);
});
