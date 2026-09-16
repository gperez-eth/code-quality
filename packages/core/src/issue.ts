export const ISSUE_TYPES = ['BUG', 'VULNERABILITY', 'CODE_SMELL', 'SECURITY_HOTSPOT'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const SEVERITIES = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ISSUE_STATUSES = ['OPEN', 'CONFIRMED', 'REOPENED', 'RESOLVED', 'CLOSED'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const RESOLUTIONS = ['FIXED', 'FALSE_POSITIVE', 'WONT_FIX', 'REMOVED'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** A source range, 1-indexed lines, 0-indexed columns. */
export interface TextRange {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

/**
 * One step in a vulnerability trace. The Code & Issue Detail screen renders
 * these as numbered badges in the line-number gutter.
 */
export interface IssueFlowStep {
  filePath: string;
  range: TextRange;
  message: string;
}

export interface Issue {
  /** Stable across analyses so an issue keeps its history when lines move. */
  fingerprint: string;
  ruleKey: string;
  type: IssueType;
  severity: Severity;
  status: IssueStatus;
  resolution?: Resolution;
  filePath: string;
  range: TextRange;
  message: string;
  /** Estimated remediation cost in minutes. */
  effortMinutes: number;
  tags: string[];
  flow?: IssueFlowStep[];
}

/** "4d 4h" — the effort format used throughout the Measures screens. */
export function formatEffort(minutes: number, hoursPerDay = 8): string {
  if (minutes <= 0) return '0';
  const perDay = hoursPerDay * 60;
  const days = Math.floor(minutes / perDay);
  const hours = Math.floor((minutes % perDay) / 60);
  const mins = minutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 && days === 0) parts.push(`${mins}min`);
  return parts.join(' ');
}
