import type { ConditionResult, GateStatus } from './quality-gate.js';
import type { Issue, IssueType, Severity } from './issue.js';
import type { Measure } from './metric.js';

/**
 * The scan report: what the analyzer writes and the database imports. It is
 * the seam between the two, so neither package has to depend on the other,
 * and a CI job can scan on one machine and publish from another.
 */
export const SCAN_REPORT_VERSION = 1;

/** A rule as the catalogue describes it, so the importer can fill `rules`. */
export interface ReportedRule {
  key: string;
  name: string;
  type: IssueType;
  severity: Severity;
  effortMinutes: number;
  tags: string[];
  description: string;
  languages: string[];
}

/** Per-file rollups: what the Code view and the effort listing are built on. */
export interface ReportedFile {
  path: string;
  language: string;
  ncloc: number;
  lines: number;
  commentLines: number;
  complexity: number;
  cognitiveComplexity: number;
  issueCount: number;
  effortMinutes: number;
  duplicatedLines: number;
}

export interface ScanReport {
  version: typeof SCAN_REPORT_VERSION;
  /** The directory that was scanned, as given on the command line. */
  root: string;
  generatedAt: string;
  durationMs: number;
  gate: {
    name: string;
    /**
     * `null` means NOT_COMPUTED. `analyses.gate_status` has no enum value for
     * it and is nullable, so null is what "nothing to judge" looks like both
     * on the wire and at rest.
     */
    status: GateStatus | null;
    conditions: ConditionResult[];
  };
  measures: Measure[];
  files: ReportedFile[];
  issues: Issue[];
  rules: ReportedRule[];
  duplication: {
    duplicatedBlocks: number;
    duplicatedLines: number;
  };
  errors: Array<{ path: string; message: string }>;
}

/** Cheap shape check at the import boundary: the file comes from elsewhere. */
export function isScanReport(value: unknown): value is ScanReport {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as Partial<ScanReport>;

  return (
    report.version === SCAN_REPORT_VERSION &&
    Array.isArray(report.issues) &&
    Array.isArray(report.measures) &&
    Array.isArray(report.files) &&
    Array.isArray(report.rules)
  );
}
