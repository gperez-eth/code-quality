'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { type RequestAnalysisInput, useRequestAnalysisMutation } from '@/lib/api';
import { AnalysisJobStatus, useWatchAnalysisJob } from './analysis-job';
import { Icon, ProviderIcon } from './primitives';

type Source = 'GITHUB' | 'GITLAB' | 'LOCAL';

const SOURCES: Array<{ value: Source; label: string }> = [
  { value: 'GITHUB', label: 'GitHub' },
  { value: 'GITLAB', label: 'GitLab' },
  { value: 'LOCAL', label: 'Local path' },
];

const PLACEHOLDER: Record<Source, string> = {
  GITHUB: 'https://github.com/owner/repo.git',
  GITLAB: 'https://gitlab.com/group/repo.git',
  LOCAL: 'C:\\Users\\you\\Documents\\my-app',
};

function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between">
        <span className="text-label-md">{label}</span>
        {optional ? <span className="text-label-sm text-on-surface-variant">Optional</span> : null}
      </span>
      {children}
      {hint ? <span className="text-body-sm text-on-surface-variant">{hint}</span> : null}
    </label>
  );
}

const INPUT =
  'h-[30px] w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2 text-body-md focus:border-primary-container focus:outline-none';

function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

/**
 * The entry point of the product: point it at a git repository and it gets
 * analysed.
 *
 * The form no longer waits for that to happen. It queues the work and watches
 * the job, because cloning a repository and parsing it is minutes of someone
 * else's CPU and has no business holding a request open.
 */
export function ConnectRepository({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>('GITHUB');
  const [jobId, setJobId] = useState<string | null>(null);

  const [requestAnalysis, { isLoading, error: requestError, reset }] = useRequestAnalysisMutation();
  const { job, settled } = useWatchAnalysisJob(jobId);

  // The work is done and the lists have been refreshed; nothing left to watch.
  useEffect(() => {
    if (job?.status !== 'SUCCEEDED') return;
    const timer = setTimeout(() => {
      setOpen(false);
      setJobId(null);
    }, 800);
    return () => clearTimeout(timer);
  }, [job?.status]);

  const remote = source !== 'LOCAL';
  const busy = isLoading || (jobId !== null && !settled);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const input: RequestAnalysisInput = {
      organizationId,
      provider: source,
      ...(text(form, 'url') ? { repositoryUrl: text(form, 'url')! } : {}),
      ...(text(form, 'path') ? { localPath: text(form, 'path')! } : {}),
      ...(text(form, 'projectKey') ? { projectKey: text(form, 'projectKey')! } : {}),
      ...(text(form, 'branch') ? { branch: text(form, 'branch')! } : {}),
      ...(text(form, 'token') ? { accessToken: text(form, 'token')! } : {}),
    };

    const result = await requestAnalysis(input);
    if ('data' in result && typeof result.data === 'string') setJobId(result.data);
  }

  function close() {
    setOpen(false);
    setJobId(null);
    reset();
  }

  return (
    <>
      <button
        className="flex items-center gap-1.5 rounded-sm bg-primary-container px-3 py-1.5 text-label-md font-medium text-on-primary"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Icon className="text-[16px]" name="add" />
        Connect repository
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-inverse-surface/40 p-6 pt-[10vh]"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) close();
          }}
          role="presentation"
        >
          <div
            aria-labelledby="connect-title"
            aria-modal
            className="w-[560px] max-w-full rounded-sm border border-outline bg-surface-container-lowest shadow-[0_2px_4px_rgba(0,0,0,0.08)]"
            role="dialog"
          >
            <header className="flex items-center justify-between border-b border-outline-variant px-4 py-2.5">
              <span className="flex items-center gap-1.5">
                <Icon className="text-[18px] text-primary-container" name="link" />
                <h2 className="text-headline-sm" id="connect-title">
                  Connect repository
                </h2>
              </span>
              <button aria-label="Close" disabled={busy} onClick={close} type="button">
                <Icon className="text-[18px] text-on-surface-variant" name="close" />
              </button>
            </header>

            <form className="flex flex-col gap-3 px-4 py-4" onSubmit={onSubmit}>
              <div className="flex flex-col gap-1">
                <span className="text-label-md">Repository source</span>
                <div className="grid grid-cols-3 gap-1 rounded-sm border border-outline-variant p-0.5">
                  {SOURCES.map((option) => (
                    <button
                      className={`flex items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-label-md ${
                        source === option.value
                          ? 'bg-surface-container-highest font-semibold text-primary'
                          : 'text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                      key={option.value}
                      onClick={() => setSource(option.value)}
                      type="button"
                    >
                      <ProviderIcon className="text-[14px]" provider={option.value} />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {remote ? (
                <Field
                  hint="HTTPS or SSH. The repository is cloned into the worker's workspace."
                  key="url"
                  label="Repository URL"
                >
                  <input className={INPUT} name="url" placeholder={PLACEHOLDER[source]} required type="text" />
                </Field>
              ) : (
                <Field hint="Read in place. Your working copy is never modified." key="path" label="Repository path">
                  <input className={INPUT} name="path" placeholder={PLACEHOLDER.LOCAL} required type="text" />
                </Field>
              )}

              {remote ? (
                <Field
                  hint="Only for private repositories. It goes straight into Supabase Vault — the app never holds it, and it cannot be read back through the API."
                  label="Access token"
                  optional
                >
                  <input
                    autoComplete="off"
                    className={INPUT}
                    name="token"
                    placeholder="ghp_… / glpat-…"
                    type="password"
                  />
                </Field>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <Field hint="Empty tracks the default branch." label="Branch" optional>
                  <input className={INPUT} name="branch" placeholder="main" type="text" />
                </Field>
                <Field hint="Used in the dashboard URL." label="Project key" optional>
                  <input
                    className={`${INPUT} font-mono text-code-body`}
                    name="projectKey"
                    placeholder="owner-repo"
                    type="text"
                  />
                </Field>
              </div>

              {requestError ? (
                <p className="rounded-sm border border-error/30 bg-error-container/40 px-2.5 py-1.5 text-body-sm text-on-error-container">
                  {'message' in requestError ? requestError.message : 'The request could not be queued.'}
                </p>
              ) : null}

              <AnalysisJobStatus job={job} />

              <footer className="flex items-center justify-end gap-2 border-t border-outline-variant pt-3">
                <button
                  className="rounded-sm border border-outline-variant px-3 py-1.5 text-label-md disabled:opacity-60"
                  disabled={busy}
                  onClick={close}
                  type="button"
                >
                  {settled ? 'Close' : 'Cancel'}
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-sm bg-primary-container px-3 py-1.5 text-label-md font-medium text-on-primary disabled:opacity-60"
                  disabled={busy}
                  type="submit"
                >
                  {isLoading ? <Icon className="animate-spin text-[14px]" name="progress_activity" /> : null}
                  {jobId ? 'Queued' : 'Connect and analyse'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
