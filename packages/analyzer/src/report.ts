import { SCAN_REPORT_VERSION, type ScanReport } from '@code-quality/core';
import type { AnalysisResult } from './analyze.js';
import { ALL_RULES } from './rules/index.js';

/**
 * The interchange format `code-quality-import` reads. Maps do not survive
 * JSON, and the per-file issue lists would repeat the top-level ones, so both
 * are flattened here.
 */
export function toReport(result: AnalysisResult): ScanReport {
  const reported = new Set(result.issues.map((issue) => issue.ruleKey));

  return {
    version: SCAN_REPORT_VERSION,
    root: result.root,
    generatedAt: new Date().toISOString(),
    durationMs: result.durationMs,
    gate: {
      name: result.gate.name,
      status: result.gateResult.status === 'NOT_COMPUTED' ? null : result.gateResult.status,
      conditions: result.gateResult.conditions,
    },
    measures: Object.values(result.measures).filter((measure) => measure !== undefined),
    files: result.files.map((file) => ({
      path: file.path,
      language: file.language,
      ncloc: file.ncloc,
      lines: file.lines,
      commentLines: file.commentLines,
      complexity: file.complexity,
      cognitiveComplexity: file.cognitiveComplexity,
      issueCount: file.issues.length,
      effortMinutes: file.issues.reduce((total, issue) => total + issue.effortMinutes, 0),
      duplicatedLines: result.duplication.byFile.get(file.path)?.duplicatedLines ?? 0,
    })),
    issues: result.issues,
    // Only the rules that fired: the catalogue belongs to the analyzer, the
    // database only needs the rows an issue can point at.
    rules: ALL_RULES.filter((rule) => reported.has(rule.key)).map((rule) => ({
      key: rule.key,
      name: rule.name,
      type: rule.type,
      severity: rule.severity,
      effortMinutes: rule.effortMinutes,
      tags: [...rule.tags],
      description: rule.description,
      languages: [...rule.languages],
    })),
    duplication: {
      duplicatedBlocks: result.duplication.duplicatedBlocks,
      duplicatedLines: result.duplication.duplicatedLines,
    },
    errors: result.errors,
  };
}
