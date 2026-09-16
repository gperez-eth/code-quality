'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AnalysisAutomationDialog } from '@/components/analysis-automation';
import { AnalysisJobStatus, useWatchAnalysisJob } from '@/components/analysis-job';
import { GateStatusPill, Icon, Panel } from '@/components/primitives';
import { QueryError, QueryLoading } from '@/components/query-state';
import {
  type ProjectBranch,
  useGetMatchingBranchesQuery,
  useGetProjectBranchesQuery,
  useGetProjectByKeyQuery,
  useRequestAnalysisMutation,
} from '@/lib/api';
import { formatRelative } from '@/lib/format';

/** What a branch row shows where the gate verdict goes, before there is one. */
function BranchState({ branch }: { branch: ProjectBranch }) {
  if (branch.analysisStatus === 'RUNNING' || branch.analysisStatus === 'PENDING') {
    return (
      <span className="flex items-center gap-1.5 text-body-sm text-on-surface-variant">
        <Icon className="animate-spin text-[14px]" name="progress_activity" />
        Analysing
      </span>
    );
  }

  if (branch.analysisStatus === 'FAILED') {
    return <span className="text-body-sm font-medium text-error">Analysis failed</span>;
  }

  if (!branch.analysisId) {
    return <span className="text-body-sm text-on-surface-variant">—</span>;
  }

  // A finished analysis with no stored verdict measured nothing at all.
  return branch.gateStatus ? <GateStatusPill status={branch.gateStatus} /> : <GateStatusPill status="NOT_COMPUTED" />;
}

export function BranchesClient({ organizationId, projectKey }: { organizationId: string; projectKey: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [requestAnalysis, { isLoading: queueing }] = useRequestAnalysisMutation();
  const { job, settled } = useWatchAnalysisJob(jobId);

  const project = useGetProjectByKeyQuery(projectKey);
  const projectId = project.data?.id ?? '';

  const { data: branches, error, isLoading, refetch } = useGetProjectBranchesQuery(projectId, { skip: !projectId });
  const { data: automatic } = useGetMatchingBranchesQuery(
    { projectId, patterns: project.data?.analyzeBranchPatterns ?? [] },
    { skip: !projectId || !project.data?.analyzeOnPush },
  );

  const automaticNames = new Set(automatic ?? []);

  if (project.isLoading || isLoading) return <QueryLoading label="Loading branches" />;
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;
  if (!project.data) return null;

  // Hoisted so the narrowing survives into the callbacks below.
  const current = project.data;

  async function analyse(branch: string) {
    const result = await requestAnalysis({
      organizationId,
      provider: current.provider,
      projectKey,
      branch,
    });
    if ('data' in result && typeof result.data === 'string') setJobId(result.data);
  }

  const analysed = branches?.filter((branch) => branch.analysisId).length ?? 0;
  const busy = queueing || (jobId !== null && !settled);

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg">Branches</h1>
          <p className="text-body-sm text-on-surface-variant">
            {!branches
              ? ' '
              : branches.length === 0
                ? 'None recorded yet.'
                : `${branches.length} branch${branches.length === 1 ? '' : 'es'} · ${analysed} analysed`}
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-sm border border-outline-variant px-3 py-1.5 text-label-md hover:bg-surface-container-low"
          onClick={() => setAutomationOpen(true)}
          type="button"
        >
          <Icon className="text-[16px]" name="settings" />
          Analysis automation
        </button>
      </header>

      {job && !settled ? <AnalysisJobStatus job={job} /> : null}
      {job?.status === 'FAILED' ? <AnalysisJobStatus job={job} /> : null}

      {!branches || branches.length === 0 ? (
        <Panel>
          <p className="px-4 py-8 text-center text-body-md text-on-surface-variant">
            No branches recorded yet. They are read from the repository the next time an analysis runs — press{' '}
            <span className="font-medium">Analyse again</span> above.
          </p>
        </Panel>
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-md">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-label-sm tracking-wide text-on-surface-variant uppercase">
                  <th className="px-3 py-2 font-semibold">Branch</th>
                  <th className="px-3 py-2 font-semibold">Last analysis</th>
                  <th className="px-3 py-2 font-semibold">Quality gate</th>
                  <th className="px-3 py-2 font-semibold">Automatic</th>
                  <th className="px-3 py-2 text-right font-semibold">{''}</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr
                    className="border-b border-outline-variant last:border-b-0 hover:bg-surface-container-low"
                    key={branch.name}
                  >
                    <td className="px-3 py-2">
                      <Link
                        className="flex items-center gap-1.5"
                        href={`/projects/${encodeURIComponent(projectKey)}${
                          branch.isDefault ? '' : `?branch=${encodeURIComponent(branch.name)}`
                        }`}
                      >
                        <Icon className="text-[16px] text-secondary" name="account_tree" />
                        <span className="font-mono text-code-body font-medium text-primary">{branch.name}</span>
                        {branch.isDefault ? (
                          <span className="rounded-sm border border-outline-variant bg-surface-container px-1 py-px text-label-sm text-on-surface-variant">
                            default
                          </span>
                        ) : null}
                      </Link>
                      {branch.commitMessage ? (
                        <span className="block truncate text-body-sm text-on-surface-variant">
                          {branch.commitMessage}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-body-sm text-on-surface-variant">
                      {branch.lastAnalyzedAt ? formatRelative(branch.lastAnalyzedAt) : 'Never analysed'}
                    </td>
                    <td className="px-3 py-2">
                      <BranchState branch={branch} />
                    </td>
                    <td className="px-3 py-2 text-body-sm text-on-surface-variant">
                      {!current.analyzeOnPush ? (
                        <span title="Automatic analysis is off for this project">Off</span>
                      ) : automaticNames.has(branch.name) ? (
                        <span className="flex items-center gap-1 text-on-surface">
                          <Icon className="text-[14px]" name="check" />
                          On push
                        </span>
                      ) : current.analyzeOnNewBranch ? (
                        <span title="Only the push that creates a branch">New branches only</span>
                      ) : (
                        <span>No</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        className={`rounded-sm px-2 py-1 text-label-md disabled:opacity-60 ${
                          branch.analysisId
                            ? 'border border-outline-variant hover:border-outline'
                            : 'bg-primary-container font-medium text-on-primary'
                        }`}
                        disabled={busy}
                        onClick={() => void analyse(branch.name)}
                        type="button"
                      >
                        Analyse
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="flex items-center gap-1.5 border-t border-outline-variant bg-surface-container-low px-3 py-2 text-body-sm text-on-surface-variant">
            <Icon className="text-[14px]" name="info" />
            Branches are refreshed from the repository every time an analysis runs.
          </p>
        </Panel>
      )}

      {automationOpen ? (
        <AnalysisAutomationDialog onClose={() => setAutomationOpen(false)} project={current} />
      ) : null}
    </main>
  );
}
