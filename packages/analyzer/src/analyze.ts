import {
  evaluateQualityGate,
  type Issue,
  type MeasureSet,
  type QualityGate,
  type QualityGateResult,
  SEVERITIES,
  SONAR_WAY_GATE,
} from '@code-quality/core';
import { rangeOf } from './ast.js';
import { matchCoverage, parseLcov, readCoverageFile, type CoverageReport } from './coverage.js';
import { detectDuplication, type DuplicationOptions, type DuplicationReport } from './duplication.js';
import { fingerprint } from './fingerprint.js';
import { languageForPath, parserFor } from './languages.js';
import { computeMeasures, measureReader, treatAllCodeAsNew, type MeasureInput } from './measures.js';
import { computeFileMetrics } from './metrics.js';
import { ALL_RULES, rulesFor } from './rules/index.js';
import type { FileReport, Rule, SourceFile } from './types.js';
import { walkSourceFiles, type WalkOptions } from './walk.js';

export interface AnalyzeOptions extends WalkOptions {
  /** Defaults to every built-in rule. */
  rules?: readonly Rule[];
  /** Defaults to the built-in "Sonar way" gate. */
  gate?: QualityGate;
  duplication?: DuplicationOptions;
  /**
   * Path to an lcov.info file to attribute coverage from. The analyzer never
   * runs the customer's tests itself — see ADR-0005 — so this is the only
   * way coverage measures appear at all; leaving it out means no coverage
   * measures, not a coverage of zero.
   */
  coverage?: string;
  /** Called as each file is finished, for progress reporting. */
  onFile?: (file: FileReport) => void;
}

export interface AnalysisError {
  path: string;
  message: string;
}

export interface AnalysisResult {
  root: string;
  files: FileReport[];
  issues: Issue[];
  measures: MeasureSet;
  duplication: DuplicationReport;
  /** Absent whenever `--coverage` was not given. */
  coverage?: CoverageReport;
  gate: QualityGate;
  gateResult: QualityGateResult;
  errors: AnalysisError[];
  /** Findings dropped by a NOSONAR marker, so they are not invisible. */
  suppressed: number;
  durationMs: number;
}

const SEVERITY_ORDER = new Map(SEVERITIES.map((severity, index) => [severity, index]));

function bySeverityThenLocation(a: Issue, b: Issue): number {
  const severity = (SEVERITY_ORDER.get(a.severity) ?? 0) - (SEVERITY_ORDER.get(b.severity) ?? 0);
  if (severity !== 0) return severity;

  const path = a.filePath.localeCompare(b.filePath);
  if (path !== 0) return path;

  return a.range.startLine - b.range.startLine;
}

/** Runs every rule that applies to the file and turns each report into an Issue. */
/**
 * Sonar's own escape hatch, and the reason this analyzer needs one at all:
 * any rule worth having is wrong somewhere, and a tool with no way to say so
 * gets switched off entirely rather than argued with. Eleven findings on the
 * worker's own logging was the argument.
 *
 * A bare `NOSONAR` on the reported line drops every finding there. Naming
 * keys — `// NOSONAR ts:no-console` — drops only those, which is what you
 * want when one line legitimately trips one rule and the others still matter.
 */
const SUPPRESSION_MARKER = 'NOSONAR';
/** `ts:no-eval` and friends. No escapes, deliberately — see the note below. */
const RULE_KEY_IN_MARKER = /[a-z]+:[a-z0-9-]+/gi;

function suppresses(lineText: string, ruleKey: string): boolean {
  const at = lineText.indexOf(SUPPRESSION_MARKER);
  if (at < 0) return false;

  // Rule keys after the marker narrow it to those; a bare marker takes every
  // finding on the line.
  const named: string[] =
    lineText.slice(at + SUPPRESSION_MARKER.length).match(RULE_KEY_IN_MARKER) ?? [];
  return named.length === 0 || named.includes(ruleKey);
}

function runRules(
  file: SourceFile,
  rules: readonly Rule[],
  errors: AnalysisError[],
  counts: { suppressed: number },
): Issue[] {
  const issues: Issue[] = [];
  const occurrences = new Map<string, number>();

  for (const rule of rulesFor(file.language, rules)) {
    try {
      rule.check({
        file,
        report(report) {
          const range = report.node ? rangeOf(report.node) : report.range;
          if (!range) return;

          const lineText = file.lines[range.startLine - 1] ?? '';
          // Counted rather than silently dropped: a number that quietly went
          // missing is the same lie as one that was never measured.
          if (suppresses(lineText, rule.key)) {
            counts.suppressed += 1;
            return;
          }

          // Two findings from one rule on one line are told apart by order.
          const key = [rule.key, file.path, lineText.trim()].join('\u0000');
          const occurrence = occurrences.get(key) ?? 0;
          occurrences.set(key, occurrence + 1);

          issues.push({
            fingerprint: fingerprint({ ruleKey: rule.key, filePath: file.path, lineText, occurrence }),
            ruleKey: rule.key,
            type: rule.type,
            severity: report.severity ?? rule.severity,
            status: 'OPEN',
            filePath: file.path,
            range,
            message: report.message,
            effortMinutes: rule.effortMinutes,
            tags: rule.tags,
          });
        },
      });
    } catch (error) {
      // One broken rule should cost its own findings, not the whole analysis.
      errors.push({ path: file.path, message: `Rule ${rule.key} failed: ${(error as Error).message}` });
    }
  }

  return issues;
}

/**
 * Scans a directory tree: parse, run the rules, measure, look for duplication
 * and evaluate the quality gate. Nothing here touches the database — the
 * result is a plain value the CLI prints and the server persists.
 */
export async function analyze(root: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const startedAt = Date.now();
  const rules = options.rules ?? ALL_RULES;
  const errors: AnalysisError[] = [];
  const files: FileReport[] = [];
  const issues: Issue[] = [];
  const sources: Array<{ path: string; lines: string[] }> = [];

  // Read before the walk so a missing or unreadable report fails fast, and
  // fails the whole scan rather than quietly turning into "no coverage".
  const coverageContent = options.coverage ? await readCoverageFile(options.coverage) : undefined;

  const counts = { suppressed: 0 };
  const walkOptions: WalkOptions = {};
  if (options.ignore) walkOptions.ignore = options.ignore;
  if (options.maxBytes !== undefined) walkOptions.maxBytes = options.maxBytes;

  for await (const discovered of walkSourceFiles(root, walkOptions)) {
    const language = languageForPath(discovered.path);
    if (!language) continue;

    let file: SourceFile;
    try {
      file = {
        path: discovered.path,
        absolutePath: discovered.absolutePath,
        language,
        text: discovered.text,
        lines: discovered.text.split(/\r?\n/),
        tree: parserFor(language).parse(discovered.text),
      };
    } catch (error) {
      errors.push({ path: discovered.path, message: `Could not parse: ${(error as Error).message}` });
      continue;
    }

    const fileIssues = runRules(file, rules, errors, counts);
    const metrics = computeFileMetrics(file.lines, file.tree);

    const report: FileReport = {
      path: file.path,
      language: file.language,
      issues: fileIssues,
      ncloc: metrics.ncloc,
      lines: metrics.lines,
      commentLines: metrics.commentLines,
      complexity: metrics.complexity,
      cognitiveComplexity: metrics.cognitiveComplexity,
    };

    files.push(report);
    issues.push(...fileIssues);
    sources.push({ path: file.path, lines: file.lines });
    options.onFile?.(report);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  issues.sort(bySeverityThenLocation);

  const duplication = detectDuplication(sources, options.duplication ?? {});
  const coverage = coverageContent ? matchCoverage(parseLcov(coverageContent), root, files) : undefined;
  const measureInput: MeasureInput = { files, issues, duplication };
  if (coverage) measureInput.coverage = coverage;
  const measures = treatAllCodeAsNew(computeMeasures(measureInput));
  const gate = options.gate ?? SONAR_WAY_GATE;

  const result: AnalysisResult = {
    root,
    files,
    issues,
    measures,
    duplication,
    gate,
    gateResult: evaluateQualityGate(gate, measureReader(measures)),
    errors,
    suppressed: counts.suppressed,
    durationMs: Date.now() - startedAt,
  };
  if (coverage) result.coverage = coverage;
  return result;
}
