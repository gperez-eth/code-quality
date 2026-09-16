import { createApi } from '@reduxjs/toolkit/query/react';
import {
  evaluateQualityGate,
  isMetricKey,
  METRICS,
  type QualityGate,
  type QualityGateCondition,
  ratingFromValue,
  SONAR_WAY_GATE,
} from '@code-quality/core';
import { supabaseBaseQuery } from './base-query';
import type { Enums, Json } from './database.types';
import {
  type AnalysisJob,
  type AnalysisJobDto,
  type IssueFacets,
  type IssueFilters,
  type IssuePage,
  type LanguageShare,
  type Measures,
  type Organization,
  type Overview,
  type Project,
  PROJECT_COLUMNS,
  type ProjectDto,
  type RepositoryRow,
  type Rule,
  toAnalysisJob,
  toAnalysisSummary,
  toIssueRow,
  toOrganization,
  toProject,
  toRule,
  type AnalysisSummary,
  type FileEffort,
  type RequestAnalysisInput,
} from './dto';

export const ISSUES_PER_PAGE = 50;

/** What the dashboard calls "unresolved": still someone's problem. */
const OPEN_STATUSES: Array<Enums<'issue_status'>> = ['OPEN', 'CONFIRMED', 'REOPENED'];

export interface IssueQuery {
  projectId: string;
  filters: IssueFilters;
}

/** The empty facets an error or an empty project still has to render. */
const NO_FACETS: IssueFacets = { types: [], severities: [], statuses: [], tags: [] };

/**
 * Every read the browser makes, in one place.
 *
 * Note what is missing: no query filters by organisation. RLS answers "whose
 * data is this" from the JWT, so repeating it here would be a second copy of
 * the rule, free to drift from the first. Arguments narrow *within* what the
 * account may already see.
 *
 * The aggregates — latest analysis per project, issue counts, lines by
 * language, the faceted counts — come from views and a function created in
 * migration 0005, because PostgREST serves rows and does not compute.
 */
export const api = createApi({
  reducerPath: 'api',
  baseQuery: supabaseBaseQuery,
  tagTypes: ['Organization', 'Project', 'Analysis', 'Issue', 'Rule', 'Job'],
  endpoints: (build) => ({
    getMyOrganizations: build.query<Organization[], void>({
      query: () => async (client) => {
        const { data, error } = await client.from('organizations').select('*').order('created_at');
        if (error) return { data: null, error };
        return { data: data.map(toOrganization), error: null };
      },
      providesTags: ['Organization'],
    }),

    /**
     * The Repositories table. Three requests rather than one nested select:
     * the two views join back to projects through the same foreign key, and
     * stitching them by project id here is clearer than leaning on PostgREST
     * to resolve an ambiguous embed.
     */
    getRepositories: build.query<RepositoryRow[], void>({
      query: () => async (client) => {
        const [projects, analyses, counts] = await Promise.all([
          client.from('projects').select(PROJECT_COLUMNS).order('last_analyzed_at', { ascending: false }),
          client.from('project_latest_analysis').select('*'),
          client.from('project_open_issue_counts').select('*'),
        ]);

        if (projects.error) return { data: null, error: projects.error };
        if (analyses.error) return { data: null, error: analyses.error };
        if (counts.error) return { data: null, error: counts.error };

        const latest = new Map(analyses.data.map((row) => [row.project_id, row]));
        const open = new Map(counts.data.map((row) => [row.project_id, row.open_issues ?? 0]));

        const rows: RepositoryRow[] = (projects.data as ProjectDto[]).map((dto) => {
          const project = toProject(dto);
          const analysis = latest.get(project.id);

          return {
            id: project.id,
            key: project.key,
            name: project.name,
            provider: project.provider,
            repositoryUrl: project.repositoryUrl,
            localPath: project.localPath,
            // The branch the analysis ran on, or the one the project tracks.
            branch: analysis?.branch ?? project.mainBranch,
            gateStatus: analysis?.gate_status ?? null,
            analysisStatus: analysis?.status ?? null,
            commitSha: analysis?.commit_sha ?? null,
            commitMessage: analysis?.commit_message ?? null,
            lastAnalyzedAt: analysis?.finished_at ?? project.lastAnalyzedAt,
            openIssues: open.get(project.id) ?? 0,
          };
        });

        return { data: rows, error: null };
      },
      providesTags: [{ type: 'Project', id: 'LIST' }],
    }),

    getProjectByKey: build.query<Project | null, string>({
      query: (key) => async (client) => {
        // maybeSingle, not single: "no such project" is an ordinary answer,
        // including when it exists but belongs to someone else.
        const { data, error } = await client.from('projects').select(PROJECT_COLUMNS).eq('key', key).maybeSingle();
        if (error) return { data: null, error };
        return { data: data ? toProject(data as ProjectDto) : null, error: null };
      },
      providesTags: (result) => (result ? [{ type: 'Project', id: result.id }] : []),
    }),

    getLatestAnalysis: build.query<AnalysisSummary | null, string>({
      query: (projectId) => async (client) => {
        const { data, error } = await client
          .from('project_latest_analysis')
          .select('*')
          .eq('project_id', projectId)
          .maybeSingle();

        if (error) return { data: null, error };
        return { data: data ? toAnalysisSummary(data) : null, error: null };
      },
      providesTags: (_result, _error, projectId) => [{ type: 'Analysis', id: projectId }],
    }),

    getOverview: build.query<Overview | null, string>({
      query: (projectKey) => async (client) => {
        const projectResult = await client
          .from('projects')
          .select(PROJECT_COLUMNS)
          .eq('key', projectKey)
          .maybeSingle();

        if (projectResult.error) return { data: null, error: projectResult.error };
        if (!projectResult.data) return { data: null, error: null };

        const project = toProject(projectResult.data as ProjectDto);

        const analysisResult = await client
          .from('project_latest_analysis')
          .select('*')
          .eq('project_id', project.id)
          .maybeSingle();

        if (analysisResult.error) return { data: null, error: analysisResult.error };

        const analysis = analysisResult.data ? toAnalysisSummary(analysisResult.data) : null;
        // A project with no analysis has no overview to show.
        if (!analysis) return { data: null, error: null };

        const [measureRows, gateRows, languageRows, fileRows] = await Promise.all([
          client.from('measures').select('metric, value, new_code_value').eq('analysis_id', analysis.id),
          project.qualityGateId
            ? client
                .from('quality_gates')
                .select('id, name, is_default, is_built_in, quality_gate_conditions(metric, operator, threshold, scope)')
                .eq('id', project.qualityGateId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          client
            .from('analysis_language_ncloc')
            .select('*')
            .eq('analysis_id', analysis.id)
            .order('ncloc', { ascending: false }),
          client
            .from('file_measures')
            .select('file_path, effort_minutes, issue_count, ncloc')
            .eq('analysis_id', analysis.id)
            .gt('effort_minutes', 0)
            .order('effort_minutes', { ascending: false })
            .limit(8),
        ]);

        if (measureRows.error) return { data: null, error: measureRows.error };
        if (gateRows.error) return { data: null, error: gateRows.error };
        if (languageRows.error) return { data: null, error: languageRows.error };
        if (fileRows.error) return { data: null, error: fileRows.error };

        const measures: Measures = {};
        for (const row of measureRows.data ?? []) {
          // Metrics are free text so the catalogue can grow without a
          // migration; anything it no longer knows about is ignored.
          if (isMetricKey(row.metric)) {
            measures[row.metric] = { value: row.value, newCodeValue: row.new_code_value };
          }
        }

        const gate: QualityGate = gateRows.data
          ? {
              id: gateRows.data.id,
              name: gateRows.data.name,
              isDefault: gateRows.data.is_default,
              isBuiltIn: gateRows.data.is_built_in,
              conditions: (gateRows.data.quality_gate_conditions ?? []).flatMap<QualityGateCondition>((condition) => {
                if (!isMetricKey(condition.metric)) return [];
                return [
                  {
                    metric: condition.metric,
                    operator: condition.operator,
                    // Ratings are stored numerically; a letter reads better.
                    threshold:
                      METRICS[condition.metric].valueType === 'RATING'
                        ? ratingFromValue(condition.threshold)
                        : condition.threshold,
                    scope: condition.scope,
                  },
                ];
              }),
            }
          : SONAR_WAY_GATE;

        // The stored verdict says pass or fail; re-evaluating says which
        // conditions did it, without a second table to keep in step.
        const result = evaluateQualityGate(gate, (metric, scope) => {
          const measure = measures[metric];
          if (!measure) return null;
          return scope === 'OVERALL' ? measure.value : measure.newCodeValue;
        });

        const languages: LanguageShare[] = (languageRows.data ?? []).flatMap((row) =>
          row.language === null || row.ncloc === null ? [] : [{ language: row.language, ncloc: row.ncloc }],
        );

        const worstFiles: FileEffort[] = (fileRows.data ?? []).map((row) => ({
          filePath: row.file_path,
          effortMinutes: row.effort_minutes,
          issueCount: row.issue_count,
          ncloc: row.ncloc,
        }));

        return {
          data: { project, analysis, measures, gate: result, gateName: gate.name, languages, worstFiles },
          error: null,
        };
      },
      providesTags: (result) => (result ? [{ type: 'Project', id: result.project.id }] : []),
    }),

    getIssues: build.query<IssuePage, IssueQuery>({
      query:
        ({ projectId, filters }) =>
        async (client) => {
          const { types, severities, statuses, tags, file, newCodeOnly } = filters;
          const currentPage = Math.max(1, filters.page);
          const from = (currentPage - 1) * ISSUES_PER_PAGE;
          const effectiveStatuses = statuses?.length ? statuses : OPEN_STATUSES;

          let rows = client
            .from('issues')
            .select('*, rules(name)')
            .eq('project_id', projectId)
            .in('status', effectiveStatuses)
            // The severity enum is declared worst-first, so the database sorts
            // it into the right order on its own.
            .order('severity')
            .order('file_path')
            .order('start_line')
            .range(from, from + ISSUES_PER_PAGE - 1);

          if (types?.length) rows = rows.in('type', types);
          if (severities?.length) rows = rows.in('severity', severities);
          if (tags?.length) rows = rows.overlaps('tags', tags);
          if (file) rows = rows.eq('file_path', file);
          if (newCodeOnly) rows = rows.eq('is_new_code', true);

          const [issueResult, facetResult] = await Promise.all([
            rows,
            // One function call rather than four grouped queries: each facet
            // is counted with its own dimension left out of the filter.
            client.rpc('issue_facets', {
              p_project_id: projectId,
              ...(types?.length ? { p_types: types } : {}),
              ...(severities?.length ? { p_severities: severities } : {}),
              ...(statuses?.length ? { p_statuses: statuses } : {}),
              ...(tags?.length ? { p_tags: tags } : {}),
              ...(file ? { p_file: file } : {}),
              ...(newCodeOnly ? { p_new_code_only: true } : {}),
            }),
          ]);

          if (issueResult.error) return { data: null, error: issueResult.error };
          if (facetResult.error) return { data: null, error: facetResult.error };

          const facets = readFacets(facetResult.data);
          const total = facets.total;

          return {
            data: {
              issues: issueResult.data.map(toIssueRow),
              total,
              page: currentPage,
              pageCount: Math.max(1, Math.ceil(total / ISSUES_PER_PAGE)),
              totalEffortMinutes: facets.effortMinutes,
              facets: facets.facets,
            },
            error: null,
          };
        },
      providesTags: [{ type: 'Issue', id: 'LIST' }],
    }),

    /**
     * Ask for an analysis. Returns a job id and nothing else — the work has not
     * started, and will not start in this request.
     *
     * Asking twice for the same project while one is in flight gives back the
     * job already running rather than queueing a duplicate, so a double click
     * is harmless.
     */
    requestAnalysis: build.mutation<string, RequestAnalysisInput>({
      query: (input) => async (client) => {
        const { data, error } = await client.rpc('request_analysis', {
          p_organization_id: input.organizationId,
          p_provider: input.provider,
          ...(input.repositoryUrl ? { p_repository_url: input.repositoryUrl } : {}),
          ...(input.localPath ? { p_local_path: input.localPath } : {}),
          ...(input.projectKey ? { p_project_key: input.projectKey } : {}),
          ...(input.projectName ? { p_project_name: input.projectName } : {}),
          ...(input.branch ? { p_branch: input.branch } : {}),
          ...(input.accessToken ? { p_access_token: input.accessToken } : {}),
          p_trigger: 'MANUAL',
        });

        if (error) return { data: null, error };
        return { data, error: null };
      },
      invalidatesTags: [{ type: 'Job', id: 'LIST' }],
    }),

    /** Watched by whoever asked, until it stops being QUEUED or RUNNING. */
    getAnalysisJob: build.query<AnalysisJob | null, string>({
      query: (jobId) => async (client) => {
        const { data, error } = await client.from('analysis_jobs').select('*').eq('id', jobId).maybeSingle();
        if (error) return { data: null, error };
        return { data: data ? toAnalysisJob(data as AnalysisJobDto) : null, error: null };
      },
      providesTags: (result) => (result ? [{ type: 'Job', id: result.id }] : []),
    }),

    getRules: build.query<Rule[], void>({
      query: () => async (client) => {
        const { data, error } = await client.from('rules').select('*').eq('is_active', true).order('key');
        if (error) return { data: null, error };
        return { data: data.map(toRule), error: null };
      },
      providesTags: ['Rule'],
    }),
  }),
});

/**
 * `issue_facets` returns one JSON document, which arrives as `Json`. Reading
 * it defensively — rather than casting — keeps a shape change in the function
 * from throwing inside a render.
 */
function readFacets(payload: Json): { total: number; effortMinutes: number; facets: IssueFacets } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { total: 0, effortMinutes: 0, facets: NO_FACETS };
  }

  const record = payload as Record<string, Json | undefined>;
  const list = <T extends string>(value: Json | undefined): Array<{ value: T; count: number }> => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const { value: name, count } = entry as Record<string, Json | undefined>;
      if (typeof name !== 'string' || typeof count !== 'number') return [];
      return [{ value: name as T, count }];
    });
  };

  return {
    total: typeof record.total === 'number' ? record.total : 0,
    effortMinutes: typeof record.effort_minutes === 'number' ? record.effort_minutes : 0,
    facets: {
      types: list(record.types),
      severities: list(record.severities),
      statuses: list(record.statuses),
      tags: list(record.tags),
    },
  };
}

export const {
  useGetAnalysisJobQuery,
  useGetIssuesQuery,
  useGetLatestAnalysisQuery,
  useGetMyOrganizationsQuery,
  useGetOverviewQuery,
  useGetProjectByKeyQuery,
  useGetRepositoriesQuery,
  useGetRulesQuery,
  useRequestAnalysisMutation,
} = api;
