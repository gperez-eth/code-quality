import type { GateStatus, IssueStatus, IssueType, MetricKey, QualityGateResult, Severity } from '@code-quality/core';
import type { Enums, Tables } from './database.types';

/**
 * Wire shapes and the domain shapes they become.
 *
 * The `*Dto` types are generated: rows exactly as PostgREST sends them —
 * snake_case, timestamps as ISO strings. The ones without the suffix are what
 * the app works in. Keeping both, with a mapper between, means a column rename
 * surfaces as a compile error in one function instead of leaking through the
 * whole UI.
 *
 * Two rules these shapes obey, both of them load-bearing:
 *
 * 1. Nothing here holds a `Date` or a `Map`. Everything in this file ends up
 *    in the Redux store, and the store may only hold serialisable values —
 *    RTK's own check complains otherwise, and anything persisting the store
 *    would silently mangle them. Timestamps stay ISO strings and are turned
 *    into dates at the point of formatting.
 *
 * 2. `ProjectDto` is a `Pick`, not the whole row. `public.projects` also holds
 *    `access_token` and `webhook_secret`; the endpoints select columns
 *    explicitly, so those never reach a browser, and adding them here would
 *    not compile against the column list below.
 */

export const PROJECT_COLUMNS =
  'id, organization_id, key, name, provider, repository_url, local_path, main_branch, analyze_on_push, quality_gate_id, created_at, last_analyzed_at' as const;

export type ProjectDto = Pick<
  Tables<'projects'>,
  | 'id'
  | 'organization_id'
  | 'key'
  | 'name'
  | 'provider'
  | 'repository_url'
  | 'local_path'
  | 'main_branch'
  | 'analyze_on_push'
  | 'quality_gate_id'
  | 'created_at'
  | 'last_analyzed_at'
>;

export interface Project {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  provider: Enums<'repository_provider'>;
  repositoryUrl: string | null;
  localPath: string | null;
  mainBranch: string;
  analyzeOnPush: boolean;
  qualityGateId: string | null;
  createdAt: string;
  lastAnalyzedAt: string | null;
}

export function toProject(dto: ProjectDto): Project {
  return {
    id: dto.id,
    organizationId: dto.organization_id,
    key: dto.key,
    name: dto.name,
    provider: dto.provider,
    repositoryUrl: dto.repository_url,
    localPath: dto.local_path,
    mainBranch: dto.main_branch,
    analyzeOnPush: dto.analyze_on_push,
    qualityGateId: dto.quality_gate_id,
    createdAt: dto.created_at,
    lastAnalyzedAt: dto.last_analyzed_at,
  };
}

export type OrganizationDto = Tables<'organizations'>;

export interface Organization {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
}

export function toOrganization(dto: OrganizationDto): Organization {
  return { id: dto.id, slug: dto.slug, name: dto.name, createdAt: dto.created_at };
}

/**
 * The newest analysis of a project, read from `project_latest_analysis`.
 *
 * Every column of that view is typed nullable — Postgres cannot promise
 * otherwise through a view — so the mapper has to decide what a missing value
 * means rather than assert it away.
 */
export type LatestAnalysisDto = Tables<'project_latest_analysis'>;

export interface AnalysisSummary {
  id: string;
  projectId: string;
  branch: string;
  commitSha: string | null;
  commitMessage: string | null;
  commitAuthor: string | null;
  version: string | null;
  status: Enums<'analysis_status'> | null;
  gateStatus: GateStatus | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** No baseline to compare against: the whole codebase counts as new code. */
  isFirstAnalysis: boolean;
}

export function toAnalysisSummary(dto: LatestAnalysisDto): AnalysisSummary | null {
  // A row with no analysis id is not an analysis; the caller wants "none".
  if (!dto.analysis_id || !dto.project_id) return null;

  return {
    id: dto.analysis_id,
    projectId: dto.project_id,
    branch: dto.branch ?? 'main',
    commitSha: dto.commit_sha,
    commitMessage: dto.commit_message,
    commitAuthor: dto.commit_author,
    version: dto.version,
    status: dto.status,
    gateStatus: dto.gate_status,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
    isFirstAnalysis: dto.baseline_analysis_id === null,
  };
}

/** One row of the Repositories table: a project plus how it last fared. */
export interface RepositoryRow {
  id: string;
  key: string;
  name: string;
  provider: Enums<'repository_provider'>;
  repositoryUrl: string | null;
  branch: string;
  gateStatus: GateStatus | null;
  analysisStatus: Enums<'analysis_status'> | null;
  commitSha: string | null;
  commitMessage: string | null;
  lastAnalyzedAt: string | null;
  openIssues: number;
}

/**
 * Measures as an object, not the Map the server used: a Map does not survive
 * Redux. Metrics are stored as free text so the catalogue can grow without a
 * migration, so anything the catalogue no longer knows about is dropped here.
 */
export type MeasureValue = { value: number; newCodeValue: number | null };
export type Measures = Partial<Record<MetricKey, MeasureValue>>;

export interface LanguageShare {
  language: string;
  ncloc: number;
}

export interface FileEffort {
  filePath: string;
  effortMinutes: number;
  issueCount: number;
  ncloc: number;
}

export interface Overview {
  project: Project;
  analysis: AnalysisSummary;
  measures: Measures;
  gate: QualityGateResult;
  gateName: string;
  languages: LanguageShare[];
  worstFiles: FileEffort[];
}

export type IssueDto = Tables<'issues'> & { rules?: { name: string } | null };

/** An issue as the list renders it, with the rule's name already resolved. */
export interface IssueRow {
  id: string;
  ruleKey: string;
  ruleName: string | null;
  type: IssueType;
  severity: Severity;
  status: IssueStatus;
  filePath: string;
  startLine: number;
  message: string;
  effortMinutes: number;
  tags: string[];
  isNewCode: boolean;
}

export function toIssueRow(dto: IssueDto): IssueRow {
  return {
    id: dto.id,
    ruleKey: dto.rule_key,
    ruleName: dto.rules?.name ?? null,
    type: dto.type,
    severity: dto.severity,
    status: dto.status,
    filePath: dto.file_path,
    startLine: dto.start_line,
    message: dto.message,
    effortMinutes: dto.effort_minutes,
    tags: dto.tags,
    isNewCode: dto.is_new_code,
  };
}

export interface Facet<T extends string> {
  value: T;
  count: number;
}

export interface IssueFacets {
  types: Array<Facet<IssueType>>;
  severities: Array<Facet<Severity>>;
  statuses: Array<Facet<IssueStatus>>;
  tags: Array<Facet<string>>;
}

/** What the Issues screen narrows by. Mirrors the query string one for one. */
export interface IssueFilters {
  types: IssueType[];
  severities: Severity[];
  statuses: IssueStatus[];
  tags: string[];
  /** Narrows to one file, which is how the effort list drills in. */
  file?: string;
  newCodeOnly: boolean;
  page: number;
}

export interface IssuePage {
  issues: IssueRow[];
  total: number;
  page: number;
  pageCount: number;
  totalEffortMinutes: number;
  facets: IssueFacets;
}

/**
 * A queued analysis.
 *
 * The browser asks for one and then watches this row: the work happens in a
 * worker, so "connecting a repository" is no longer something that either
 * succeeds or fails inside one request.
 */
export type AnalysisJobDto = Tables<'analysis_jobs'>;

export interface AnalysisJob {
  id: string;
  projectKey: string | null;
  projectName: string | null;
  provider: Enums<'repository_provider'>;
  repositoryUrl: string | null;
  branch: string | null;
  status: Enums<'analysis_job_status'>;
  attempts: number;
  error: string | null;
  analysisId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export function toAnalysisJob(dto: AnalysisJobDto): AnalysisJob {
  return {
    id: dto.id,
    projectKey: dto.project_key,
    projectName: dto.project_name,
    provider: dto.provider,
    repositoryUrl: dto.repository_url,
    branch: dto.branch,
    status: dto.status,
    attempts: dto.attempts,
    error: dto.error,
    analysisId: dto.analysis_id,
    createdAt: dto.created_at,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
  };
}

/** Everything the queue needs to know to do the work later. */
export interface RequestAnalysisInput {
  organizationId: string;
  provider: Enums<'repository_provider'>;
  repositoryUrl?: string;
  projectKey?: string;
  projectName?: string;
  branch?: string;
  /**
   * Sent in the clear, once, over TLS. `request_analysis` puts it straight
   * into Supabase Vault and the row keeps only an id — nothing in the app ever
   * holds a key, and nothing reads it back except the worker.
   */
  accessToken?: string;
}

export type RuleDto = Tables<'rules'>;

export interface Rule {
  key: string;
  name: string;
  languages: string[];
  type: IssueType;
  defaultSeverity: Severity;
  description: string;
  effortMinutes: number;
  tags: string[];
  isActive: boolean;
}

export function toRule(dto: RuleDto): Rule {
  return {
    key: dto.key,
    name: dto.name,
    languages: dto.languages,
    type: dto.type,
    defaultSeverity: dto.default_severity,
    description: dto.description,
    effortMinutes: dto.effort_minutes,
    tags: dto.tags,
    isActive: dto.is_active,
  };
}
