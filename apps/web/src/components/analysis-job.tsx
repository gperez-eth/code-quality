'use client';

import { useEffect } from 'react';
import { api, type AnalysisJob, useAppDispatch, useGetAnalysisJobQuery } from '@/lib/api';
import { Icon } from './primitives';

/**
 * Watching an analysis someone asked for.
 *
 * Connecting a repository is no longer one request that either works or does
 * not: it is a row in a queue and a worker that gets to it. So the UI asks,
 * gets a job id back immediately, and watches that job until it settles.
 */
export function useWatchAnalysisJob(jobId: string | null): { job: AnalysisJob | null; settled: boolean } {
  const dispatch = useAppDispatch();
  const { data } = useGetAnalysisJobQuery(jobId ?? '', { skip: !jobId, pollingInterval: jobId ? 2000 : 0 });

  const job = data ?? null;
  const settled = job?.status === 'SUCCEEDED' || job?.status === 'FAILED';

  useEffect(() => {
    // The worker wrote an analysis, so everything cached about this
    // organisation's projects is now a version behind.
    if (job?.status !== 'SUCCEEDED') return;
    dispatch(
      api.util.invalidateTags([
        { type: 'Project', id: 'LIST' },
        { type: 'Issue', id: 'LIST' },
        'Analysis',
      ]),
    );
  }, [job?.status, dispatch]);

  return { job, settled };
}

const LABEL: Record<AnalysisJob['status'], string> = {
  QUEUED: 'Queued',
  RUNNING: 'Cloning and analysing…',
  SUCCEEDED: 'Done',
  FAILED: 'Failed',
};

/** The one line of feedback someone gets while a job is in flight. */
export function AnalysisJobStatus({ job }: { job: AnalysisJob | null }) {
  if (!job) return null;

  if (job.status === 'FAILED') {
    return (
      <p className="rounded-sm border border-error/30 bg-error-container/40 px-2.5 py-1.5 text-body-sm text-on-error-container">
        {job.error ?? 'The analysis failed.'}
      </p>
    );
  }

  const busy = job.status === 'QUEUED' || job.status === 'RUNNING';

  return (
    <p className="flex items-center gap-1.5 text-body-sm text-on-surface-variant">
      {busy ? <Icon className="animate-spin text-[14px]" name="progress_activity" /> : null}
      {LABEL[job.status]}
      {job.attempts > 1 ? <span className="text-label-sm">(attempt {job.attempts})</span> : null}
    </p>
  );
}
