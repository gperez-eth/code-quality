'use client';

import Link from 'next/link';
import { notFound, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { AnalysisAutomationDialog } from '@/components/analysis-automation';
import { AnalysisJobStatus, useWatchAnalysisJob } from '@/components/analysis-job';
import { BranchSwitcher, useSelectedBranch } from '@/components/branch-switcher';
import { GettingStarted } from '@/components/getting-started';
import { Icon } from '@/components/primitives';
import { QueryError, QueryLoading } from '@/components/query-state';
import { useGetLatestAnalysisQuery, useGetProjectByKeyQuery, useRequestAnalysisMutation } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ProjectTabs } from './tabs';

/**
 * The sub-header every project screen sits under: which project, which
 * analysis, and where to go in it.
 *
 * It renders `children` — the page below — but only once there is an analysis
 * to render them against, which is the same rule the server version applied.
 */
export function ProjectChrome({
  organizationId,
  projectKey,
  children,
}: {
  organizationId: string;
  projectKey: string;
  children: ReactNode;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [requestAnalysis, { isLoading: queueing }] = useRequestAnalysisMutation();
  const { job, settled } = useWatchAnalysisJob(jobId);
  const branch = useSelectedBranch();

  // The Branches list is about the repository, not about an analysis, so it is
  // the one screen that still has something to say when nothing has been
  // analysed — including on a branch that never has.
  const alwaysRender = usePathname().endsWith('/branches');

  const project = useGetProjectByKeyQuery(projectKey);
  // Nothing to ask for until the project resolves to an id.
  const analysis = useGetLatestAnalysisQuery(
    { projectId: project.data?.id ?? '', ...(branch ? { branch } : {}) },
    { skip: !project.data },
  );

  if (project.isLoading) return <QueryLoading label="Loading project" />;
  if (project.error) return <QueryError error={project.error} onRetry={() => void project.refetch()} />;

  // Resolved, and there is no such project — or it belongs to someone else,
  // which RLS makes indistinguishable, and deliberately so.
  if (!project.data) notFound();

  const current = project.data;
  const latest = analysis.data ?? null;

  return (
    <>
      <div className="flex h-[42px] items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-4 shadow-panel">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex min-w-0 items-center gap-1">
            <Icon className="text-[16px] text-secondary" name="folder" />
            <span className="truncate text-headline-sm">{current.name}</span>
          </span>
          <span className="h-4 w-px bg-outline-variant" />
          <ProjectTabs projectKey={current.key} />
        </div>
        <div className="hidden items-center gap-3 text-body-sm text-on-surface-variant md:flex">
          <span className="flex items-center gap-1">
            <Icon className="text-[14px]" name="schedule" />
            {formatDateTime(latest?.finishedAt ?? null)}
          </span>
          <span className="text-outline-variant">•</span>
          <span className="rounded-sm border border-outline-variant bg-surface-container px-1 py-px text-label-sm text-on-secondary-container">
            {latest?.version ?? 'Version not provided'}
          </span>
          <BranchSwitcher fallbackBranch={latest?.branch ?? current.mainBranch} projectId={current.id} />
          <button
            className="flex items-center gap-1 rounded-sm border border-outline-variant px-2 py-1 text-label-md hover:border-outline"
            onClick={() => setAutomationOpen(true)}
            title="When this project is analysed automatically"
            type="button"
          >
            <Icon className="text-[14px]" name="settings" />
            Automation
          </button>
          <button
            className="flex items-center gap-1 rounded-sm border border-outline-variant px-2 py-1 text-label-md hover:border-outline disabled:opacity-60"
            disabled={queueing || (jobId !== null && !settled)}
            onClick={async () => {
              const result = await requestAnalysis({
                organizationId,
                provider: current.provider,
                projectKey: current.key,
                // The branch in the URL is the one being looked at, so it is
                // the one "Analyse again" means. Absent falls through to the
                // project's own source, which request_analysis resolves.
                ...(branch ? { branch } : {}),
              });
              if ('data' in result && typeof result.data === 'string') setJobId(result.data);
            }}
            type="button"
          >
            <Icon
              className={`text-[14px] ${queueing ? 'animate-spin' : ''}`}
              name={queueing ? 'progress_activity' : 'sync'}
            />
            {branch ? `Analyse ${branch}` : 'Analyse again'}
          </button>
        </div>
      </div>

      {/* Queued work is shown above the page rather than replacing it: the
          previous analysis stays readable while a new one runs. */}
      {job && !settled ? (
        <div className="border-b border-outline-variant bg-surface-container-low px-4 py-1.5">
          <AnalysisJobStatus job={job} />
        </div>
      ) : null}
      {job?.status === 'FAILED' ? (
        <div className="px-4 pt-2">
          <AnalysisJobStatus job={job} />
        </div>
      ) : null}

      {automationOpen ? (
        <AnalysisAutomationDialog onClose={() => setAutomationOpen(false)} project={current} />
      ) : null}

      {alwaysRender ? (
        children
      ) : analysis.isLoading ? (
        <QueryLoading label="Loading analysis" />
      ) : latest ? (
        children
      ) : branch ? (
        // A branch with no analysis is an ordinary state, not an empty project:
        // saying "get started" here would be wrong and the button would be too.
        <p className="px-4 py-8 text-center text-body-md text-on-surface-variant">
          <span className="font-mono text-code-body text-on-surface">{branch}</span> has never been analysed. Press
          “Analyse {branch}” above to run one.
        </p>
      ) : (
        <GettingStarted reason="no-analysis" />
      )}

      <footer className="px-4 pt-2 pb-6 text-body-sm text-on-surface-variant">
        {current.repositoryUrl ? (
          <Link className="text-primary hover:underline" href={current.repositoryUrl}>
            {current.repositoryUrl}
          </Link>
        ) : null}
      </footer>
    </>
  );
}
