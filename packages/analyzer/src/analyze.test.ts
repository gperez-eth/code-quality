import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { analyze, type AnalysisResult } from './analyze.js';
import { ALL_RULES } from './rules/index.js';

/** One file per rule family, so a failure names the rule that regressed. */
const SMELLY = `import { exec } from 'node:child_process';

// TODO: hand this to someone who understands it
var legacy = 1;
const apiToken = 'live-7f3a9c21e5b4';
const endpoint = 'http://staging.internal:8080/ingest';

function everything(a: any, b, c, d, e, f, g, h) {
  if (true) {
    debugger;
  }
  if (a == a) {
    console.log('the same thing on both sides');
  }
  if (a) {
    legacy = 1;
  } else {
    legacy = 1;
  }
  if (b) {
  }
  switch (c) {
    case 1:
      break;
    case 1:
      break;
  }
  try {
    eval('1 + 1');
  } catch (error) {
  }
  el.innerHTML = a + b;
  exec('ls ' + a);
  new Function('return ' + b);
  const noise = Math.random();
  return noise;
  legacy = 2;
}

function deeplyNested(input) {
  for (const a of input) {
    while (a) {
      if (a) {
        for (const b of a) {
          if (b) {
            return b;
          }
        }
      }
    }
  }
}

function branchy(n) {
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  if (n === 5) return 5;
  if (n === 6) return 6;
  if (n === 7) return 7;
  if (n === 8) return 8;
  if (n && n > 9) return 9;
  if (n || n < 0) return 10;
  for (const x of [1, 2]) {
    if (x) return x;
  }
  if (n > 100) {
    for (const y of [1, 2]) {
      if (y) {
        return y;
      }
    }
  }
  return 0;
}

const first = 'a repeated literal';
const second = 'a repeated literal';
const third = 'a repeated literal';
`;

/** Long enough to trip the file-size rule, with no two lines alike. */
const LONG = Array.from({ length: 800 }, (_, index) => `const filler${index} = ${index};`).join('\n');

/** Twelve significant lines shared between two files: above the 10-line block. */
const DUPLICATED = `export function shared(values) {
  const out = [];
  for (const value of values) {
    if (value === null) continue;
    if (value === undefined) continue;
    const scaled = value * 2;
    const shifted = scaled + 1;
    const clamped = Math.min(shifted, 100);
    out.push(clamped);
  }
  out.sort((a, b) => a - b);
  return out;
}
`;

describe('analyze', () => {
  let root: string;
  let result: AnalysisResult;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'code-quality-'));
    await writeFile(join(root, 'smelly.ts'), SMELLY, 'utf8');
    await writeFile(join(root, 'copy-a.ts'), DUPLICATED, 'utf8');
    await writeFile(join(root, 'copy-b.ts'), DUPLICATED, 'utf8');
    await writeFile(join(root, 'long.ts'), LONG, 'utf8');
    result = await analyze(root);
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('scans every source file it finds', () => {
    assert.equal(result.files.length, 4);
    assert.deepEqual(result.errors, []);
  });

  it('reports each built-in rule at least once', () => {
    const fired = new Set(result.issues.map((issue) => issue.ruleKey));
    const missing = ALL_RULES.map((rule) => rule.key).filter((key) => !fired.has(key));

    assert.deepEqual(missing, [], `rules that never fired: ${missing.join(', ')}`);
  });

  it('points findings at the line that caused them', () => {
    const secret = result.issues.find((issue) => issue.ruleKey === 'ts:no-hardcoded-secret');

    assert.ok(secret, 'expected the hard-coded credential to be found');
    assert.equal(secret.filePath, 'smelly.ts');
    assert.equal(secret.severity, 'BLOCKER');
    assert.equal(SMELLY.split('\n')[secret.range.startLine - 1]?.includes('apiToken'), true);
  });

  it('finds the duplicated block in both copies', () => {
    assert.equal(result.duplication.duplicatedBlocks, 2);
    assert.equal(result.duplication.byFile.get('copy-a.ts')?.blocks.length, 1);
    assert.ok(result.duplication.byFile.has('copy-a.ts'));
    assert.ok(result.duplication.byFile.has('copy-b.ts'));
    assert.ok((result.measures.duplicated_lines_density?.value ?? 0) > 0);
  });

  it('measures size and complexity', () => {
    const ncloc = result.measures.ncloc?.value ?? 0;
    const lines = result.measures.lines?.value ?? 0;

    assert.ok(ncloc > 800, `expected the filler file to dominate ncloc, got ${ncloc}`);
    assert.ok(lines > ncloc);
    assert.ok((result.measures.complexity?.value ?? 0) > 20);
    assert.ok((result.measures.cognitive_complexity?.value ?? 0) > 20);
  });

  it('fails the quality gate on the security hotspots it found', () => {
    assert.equal(result.gateResult.status, 'FAILED');
    assert.ok(result.gateResult.failing.some((condition) => condition.metric === 'security_hotspots'));
  });

  it('keeps fingerprints stable when unrelated lines move', async () => {
    const moved = await mkdtemp(join(tmpdir(), 'code-quality-'));
    try {
      await writeFile(join(moved, 'smelly.ts'), `// a new banner comment\n\n${SMELLY}`, 'utf8');
      const second = await analyze(moved);

      const before = result.issues.filter((issue) => issue.filePath === 'smelly.ts').map((issue) => issue.fingerprint);
      const after = new Set(second.issues.map((issue) => issue.fingerprint));

      assert.deepEqual(
        before.filter((print) => !after.has(print)),
        [],
        'issues resurfaced as new after lines shifted',
      );
    } finally {
      await rm(moved, { recursive: true, force: true });
    }
  });
});
