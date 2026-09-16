#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  describeCondition,
  formatEffort,
  formatMeasure,
  type Issue,
  type MetricKey,
  type Severity,
  SEVERITIES,
} from '@code-quality/core';
import { analyze, type AnalysisResult } from './analyze.js';
import { toReport } from './report.js';
import { ALL_RULES } from './rules/index.js';

const USAGE = `code-quality-scan — analyse a codebase and evaluate its quality gate

Usage
  code-quality-scan [path] [options]

Options
  --json <file>     Write the full result as JSON
  --coverage <file> Attribute coverage from an lcov.info file
  --top <n>         How many issues to list (default 15)
  --rules           List the built-in rules and exit
  --no-fail         Exit 0 even when the quality gate fails
  --no-color        Plain output
  -h, --help        Show this help
`;

interface CliOptions {
  root: string;
  json?: string;
  coverage?: string;
  top: number;
  fail: boolean;
  color: boolean;
  listRules: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    top: 15,
    fail: true,
    color: process.stdout.isTTY === true && !process.env['NO_COLOR'],
    listRules: false,
    help: false,
  };

  let sawPath = false;

  const valueFor = (flag: string, value: string | undefined): string => {
    if (value === undefined) throw new Error(`${flag} needs a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--rules':
        options.listRules = true;
        break;
      case '--no-fail':
        options.fail = false;
        break;
      case '--no-color':
        options.color = false;
        break;
      case '--json':
        options.json = valueFor('--json', argv[++i]);
        break;
      case '--coverage':
        options.coverage = valueFor('--coverage', argv[++i]);
        break;
      case '--top': {
        const top = Number(valueFor('--top', argv[++i]));
        if (!Number.isInteger(top) || top < 0) throw new Error('--top needs a whole number');
        options.top = top;
        break;
      }
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        if (sawPath) throw new Error(`Unexpected argument: ${arg}`);
        options.root = resolve(arg);
        sawPath = true;
    }
  }

  return options;
}

function makePalette(color: boolean) {
  const wrap = (code: string) => (text: string) => (color ? `[${code}m${text}[0m` : text);

  return {
    bold: wrap('1'),
    dim: wrap('2'),
    red: wrap('31'),
    green: wrap('32'),
    yellow: wrap('33'),
    blue: wrap('34'),
    magenta: wrap('35'),
    inverse: wrap('7'),
  };
}

type Palette = ReturnType<typeof makePalette>;

function severityColor(palette: Palette, severity: Severity): (text: string) => string {
  switch (severity) {
    case 'BLOCKER':
    case 'CRITICAL':
      return palette.red;
    case 'MAJOR':
      return palette.yellow;
    case 'MINOR':
      return palette.blue;
    case 'INFO':
      return palette.dim;
  }
}

function ratingColor(palette: Palette, rating: string): (text: string) => string {
  if (rating === 'A' || rating === 'B') return palette.green;
  if (rating === 'C') return palette.yellow;
  return palette.red;
}

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? singular : plural}`;
}

/** Reads a metric out of the result, or 0 when the analysis produced none. */
function valueOf(result: AnalysisResult, metric: MetricKey): number {
  return result.measures[metric]?.value ?? 0;
}

function ratingOf(result: AnalysisResult, metric: MetricKey): string {
  return formatMeasure(metric, valueOf(result, metric));
}

function printGate(result: AnalysisResult, palette: Palette): void {
  const passed = result.gateResult.status === 'PASSED';
  const badge = palette.inverse(passed ? palette.green(' PASSED ') : palette.red(' FAILED '));

  console.log(`  ${palette.bold('Quality Gate')}  ${badge}  ${palette.dim(result.gate.name)}`);

  for (const condition of result.gateResult.failing) {
    const actual = condition.actual === null ? 'not measured' : formatMeasure(condition.metric, condition.actual);
    console.log(`    ${palette.red('x')} ${describeCondition(condition)} ${palette.dim(`(actual ${actual})`)}`);
  }
}

function printScorecards(result: AnalysisResult, palette: Palette): void {
  const debt = valueOf(result, 'sqale_index');
  const duplication = valueOf(result, 'duplicated_lines_density');

  // Coverage is the one scorecard that can be legitimately blank: it stays
  // that way until a `--coverage` report has been ingested, rather than
  // showing a 0% that would be indistinguishable from an untested codebase.
  const coverageDetail = result.measures.coverage
    ? `${valueOf(result, 'coverage').toFixed(1)}%, ${count(valueOf(result, 'uncovered_lines'), 'uncovered line')}`
    : palette.dim('no test report ingested yet');

  const rows: Array<[string, string, string]> = [
    ['Reliability', ratingOf(result, 'reliability_rating'), count(valueOf(result, 'bugs'), 'bug')],
    [
      'Security',
      ratingOf(result, 'security_rating'),
      `${count(valueOf(result, 'vulnerabilities'), 'vulnerability', 'vulnerabilities')}, ${count(valueOf(result, 'security_hotspots'), 'hotspot')}`,
    ],
    [
      'Maintainability',
      ratingOf(result, 'sqale_rating'),
      `${count(valueOf(result, 'code_smells'), 'code smell')}, ${formatEffort(debt)} of debt`,
    ],
    ['Duplication', '', `${duplication.toFixed(1)}%, ${count(valueOf(result, 'duplicated_blocks'), 'block')}`],
    ['Coverage', '', coverageDetail],
  ];

  console.log();
  for (const [name, rating, detail] of rows) {
    const badge = rating ? ratingColor(palette, rating)(palette.bold(rating)) : ' ';
    console.log(`  ${name.padEnd(16)} ${badge}  ${detail}`);
  }
}

function printSeverityCounts(issues: Issue[], suppressed: number, palette: Palette): void {
  const counts = new Map<Severity, number>(SEVERITIES.map((severity) => [severity, 0]));
  for (const issue of issues) counts.set(issue.severity, (counts.get(issue.severity) ?? 0) + 1);

  const cells = SEVERITIES.filter((severity) => (counts.get(severity) ?? 0) > 0).map((severity) =>
    severityColor(palette, severity)(`${severity} ${counts.get(severity)}`),
  );

  // Suppressions are shown, not just counted. A finding that vanished
  // without saying so is the same lie as one that was never measured, and
  // the marker is meant to be an argument in the open rather than a way to
  // make the number look better.
  if (suppressed > 0) {
    cells.push(palette.dim(`${suppressed} suppressed`));
  }

  console.log();
  console.log(`  ${palette.bold(count(issues.length, 'issue'))}  ${cells.join(palette.dim(' · '))}`);
}

function printTopIssues(result: AnalysisResult, palette: Palette, top: number): void {
  if (result.issues.length === 0 || top <= 0) return;

  console.log();
  for (const issue of result.issues.slice(0, top)) {
    const where = `${issue.filePath}:${issue.range.startLine}`;
    console.log(`  ${severityColor(palette, issue.severity)(issue.severity.padEnd(8))} ${where}`);
    console.log(`           ${issue.message} ${palette.dim(`[${issue.ruleKey}]`)}`);
  }

  const remaining = result.issues.length - top;
  if (remaining > 0) console.log(palette.dim(`  ... and ${count(remaining, 'more issue')}`));
}

function printEffortByFile(result: AnalysisResult, palette: Palette): void {
  const worst = result.files
    .map((file) => ({
      path: file.path,
      effort: file.issues.reduce((total, issue) => total + issue.effortMinutes, 0),
      issues: file.issues.length,
    }))
    .filter((file) => file.effort > 0)
    .sort((a, b) => b.effort - a.effort)
    .slice(0, 5);

  if (worst.length === 0) return;

  console.log();
  console.log(`  ${palette.bold('Remediation effort by file')}`);
  for (const file of worst) {
    console.log(`    ${formatEffort(file.effort).padEnd(10)} ${file.path} ${palette.dim(`(${file.issues})`)}`);
  }
}

function printRules(palette: Palette): void {
  console.log(`${palette.bold(`${ALL_RULES.length} built-in rules`)}\n`);

  for (const rule of ALL_RULES) {
    console.log(`  ${palette.bold(rule.key.padEnd(30))} ${rule.type.padEnd(17)} ${rule.severity.padEnd(9)} ${rule.name}`);
  }
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const palette = makePalette(options.color);

  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.listRules) {
    printRules(palette);
    return 0;
  }

  console.log();
  console.log(`  ${palette.bold('Code Quality')} ${palette.dim(`scanning ${options.root}`)}`);

  const result = await analyze(options.root, options.coverage ? { coverage: resolve(options.coverage) } : {});

  const summary = [
    count(valueOf(result, 'files'), 'file'),
    `${valueOf(result, 'ncloc').toLocaleString('en-US')} lines of code`,
    `${(result.durationMs / 1000).toFixed(1)}s`,
  ];
  console.log(palette.dim(`  ${summary.join(' · ')}`));
  console.log();

  printGate(result, palette);
  printScorecards(result, palette);
  printSeverityCounts(result.issues, result.suppressed, palette);
  printTopIssues(result, palette, options.top);
  printEffortByFile(result, palette);

  for (const error of result.errors) {
    console.log(palette.yellow(`  ! ${error.path}: ${error.message}`));
  }

  if (options.json) {
    const target = resolve(options.json);
    await writeFile(target, `${JSON.stringify(toReport(result), null, 2)}\n`, 'utf8');
    console.log();
    console.log(palette.dim(`  Report written to ${relative(process.cwd(), target) || target}`));
  }

  console.log();
  return result.gateResult.status === 'FAILED' && options.fail ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`code-quality-scan: ${(error as Error).message}`);
    process.exitCode = 2;
  },
);
