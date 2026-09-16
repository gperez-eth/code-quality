/**
 * The client data layer: RTK Query over Supabase's REST API.
 *
 *   <ApiProvider>            once, in the root layout
 *   useGetProjectsQuery()    in any client component
 *
 * Adding an endpoint means one entry in `api.ts`; the hook is generated from
 * it. Adding a table means regenerating `database.types.ts` (the command is in
 * its header) and, if the client is to read it, a policy in a migration —
 * without one RLS denies it and the query comes back empty.
 */
export { api, ISSUES_PER_PAGE, type IssueQuery } from './api';
export {
  useGetAnalysisJobQuery,
  useGetIssuesQuery,
  useGetLatestAnalysisQuery,
  useGetMatchingBranchesQuery,
  useGetMyOrganizationsQuery,
  useGetOverviewQuery,
  useGetProjectBranchesQuery,
  useGetProjectByKeyQuery,
  useGetRepositoriesQuery,
  useGetRulesQuery,
  useHasGitHubInstallationQuery,
  useRequestAnalysisMutation,
  useSetAnalysisAutomationMutation,
} from './api';
export { ApiProvider } from './provider';
export { useAppDispatch, useAppSelector } from './hooks';
export { getSupabaseClient, type TypedSupabaseClient } from './client';
export type { AppDispatch, AppStore, RootState } from './store';
export { supabaseBaseQuery, type SupabaseQuery, type SupabaseQueryError } from './base-query';
export type {
  AnalysisJob,
  AnalysisJobDto,
  AnalysisSummary,
  Facet,
  FileEffort,
  IssueDto,
  IssueFacets,
  IssueFilters,
  IssuePage,
  IssueRow,
  LanguageShare,
  MeasureValue,
  Measures,
  Organization,
  OrganizationDto,
  Overview,
  Project,
  AnalysisAutomation,
  ProjectBranch,
  ProjectDto,
  RepositoryRow,
  RequestAnalysisInput,
  Rule,
  RuleDto,
} from './dto';
export { toAnalysisJob, toAnalysisSummary, toIssueRow, toOrganization, toProject, toRule } from './dto';
export type { Database, Enums, Tables, TablesInsert, TablesUpdate } from './database.types';
