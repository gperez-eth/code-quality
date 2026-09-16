import type { Issue, IssueType, Severity, TextRange } from '@code-quality/core';
import type { SyntaxNode, Tree } from 'tree-sitter';

export type LanguageId = 'typescript' | 'tsx' | 'javascript';

export interface SourceFile {
  /** Path relative to the scan root, always forward-slashed. */
  path: string;
  absolutePath: string;
  language: LanguageId;
  text: string;
  lines: string[];
  tree: Tree;
}

/** What a rule reports; the engine fills in the rest of the Issue. */
export interface RuleReport {
  node?: SyntaxNode;
  range?: TextRange;
  message: string;
  /** Overrides the rule's default severity when the finding warrants it. */
  severity?: Severity;
}

export interface RuleContext {
  file: SourceFile;
  report(report: RuleReport): void;
}

export interface Rule {
  /** Namespaced, e.g. "ts:no-eval". */
  key: string;
  name: string;
  type: IssueType;
  severity: Severity;
  /** Estimated remediation cost in minutes. */
  effortMinutes: number;
  tags: string[];
  description: string;
  languages: LanguageId[];
  check(context: RuleContext): void;
}

export interface FileReport {
  path: string;
  language: LanguageId;
  issues: Issue[];
  ncloc: number;
  lines: number;
  commentLines: number;
  complexity: number;
  cognitiveComplexity: number;
}
