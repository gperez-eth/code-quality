'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ConnectRepository } from '@/components/connect-repository';
import { GateStatusPill, Icon, Panel, ProviderIcon } from '@/components/primitives';
import { QueryError, QueryLoading } from '@/components/query-state';
import { type RepositoryRow, useGetRepositoriesQuery } from '@/lib/api';
import { formatNumber, formatRelative } from '@/lib/format';

// Inlined into the browser bundle at build time, which is fine and intended:
// the slug is the public part of the app's URL. The private key is not here
// and must never be — it lives in the worker's environment.
const GITHUB_APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

/**
 * The way out of pasting tokens. A plain link rather than a fetch: the whole
 * point is to hand the browser to GitHub, and `/api/github/install` mints the
 * `state` on the way past.
 */
function InstallGitHubApp() {
  if (!GITHUB_APP_SLUG) return null;

  return (
    <a
      className="flex items-center gap-1.5 rounded-sm border border-outline-variant px-3 py-1.5 text-label-md hover:bg-surface-container-low"
      href="/api/github/install"
    >
      <ProviderIcon className="text-[14px]" provider="GITHUB" />
      Install GitHub App
    </a>
  );
}

/** What the setup redirect left in the URL, said in words. */
function InstallOutcome() {
  const params = useSearchParams();
  const failure = params.get('github_error');
  const outcome = params.get('github');

  if (!failure && !outcome) return null;

  const tone = failure
    ? 'border-error/30 bg-error-container/40 text-on-error-container'
    : 'border-outline-variant bg-surface-container text-on-surface';

  const message =
    failure ??
    (outcome === 'connected'
      ? 'GitHub App connected. Private repositories now clone without a token.'
      : outcome === 'requested'
        ? 'Installation requested. An owner of that GitHub organisation has to approve it.'
        : null);

  if (!message) return null;
  return <p className={`rounded-sm border px-3 py-2 text-body-sm ${tone}`}>{message}</p>;
}

/** What a row shows where the gate verdict goes, before there is one. */
function AnalysisState({ repository }: { repository: RepositoryRow }) {
  if (repository.analysisStatus === 'RUNNING' || repository.analysisStatus === 'PENDING') {
    return (
      <span className="flex items-center gap-1.5 text-body-sm text-on-surface-variant">
        <Icon className="animate-spin text-[14px]" name="progress_activity" />
        Analysing
      </span>
    );
  }

  if (repository.analysisStatus === 'FAILED') {
    return <span className="text-body-sm font-medium text-error">Analysis failed</span>;
  }

  // A finished analysis with no stored verdict measured nothing at all: the
  // database has no enum value for NOT_COMPUTED, so a null gate on a SUCCEEDED
  // analysis is what it looks like coming back.
  if (!repository.gateStatus) {
    return repository.analysisStatus === 'SUCCEEDED' ? (
      <GateStatusPill status="NOT_COMPUTED" />
    ) : (
      <span className="text-body-sm text-on-surface-variant">No analysis</span>
    );
  }
  return <GateStatusPill status={repository.gateStatus} />;
}

function RepositoryTable({ repositories }: { repositories: RepositoryRow[] }) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body-md">
          <thead>
            <tr className="border-b border-outline-variant bg-surface-container-low text-left text-label-sm tracking-wide text-on-surface-variant uppercase">
              <th className="px-3 py-2 font-semibold">Repository</th>
              <th className="px-3 py-2 font-semibold">Branch</th>
              <th className="px-3 py-2 font-semibold">Last commit</th>
              <th className="px-3 py-2 font-semibold">Quality gate</th>
              <th className="px-3 py-2 text-right font-semibold">Issues</th>
              <th className="px-3 py-2 text-right font-semibold">Last analysis</th>
            </tr>
          </thead>
          <tbody>
            {repositories.map((repository) => (
              <tr
                className="border-b border-outline-variant last:border-b-0 hover:bg-surface-container-low"
                key={repository.id}
              >
                <td className="px-3 py-2">
                  <Link className="flex items-center gap-1.5" href={`/projects/${encodeURIComponent(repository.key)}`}>
                    <ProviderIcon className="text-[16px] text-secondary" provider={repository.provider} />
                    <span className="font-medium text-primary">{repository.name}</span>
                  </Link>
                  <span className="block truncate font-mono text-code-body text-on-surface-variant">
                    {repository.repositoryUrl}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="rounded-sm border border-outline-variant bg-surface-container px-1.5 py-px font-mono text-code-body">
                    {repository.branch}
                  </span>
                </td>
                <td className="max-w-[320px] px-3 py-2">
                  {repository.commitSha ? (
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-code-body text-tertiary">{repository.commitSha.slice(0, 7)}</span>
                      <span className="truncate text-on-surface-variant">{repository.commitMessage}</span>
                    </span>
                  ) : (
                    <span className="text-on-surface-variant">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <AnalysisState repository={repository} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {repository.openIssues > 0 ? (
                    <Link
                      className="text-primary hover:underline"
                      href={`/projects/${encodeURIComponent(repository.key)}/issues`}
                    >
                      {formatNumber(repository.openIssues)}
                    </Link>
                  ) : (
                    <span className="text-on-surface-variant">0</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-on-surface-variant">
                  {formatRelative(repository.lastAnalyzedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function NoRepositories() {
  return (
    <Panel className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Icon className="text-[28px] text-outline" name="database_off" />
      <p className="text-headline-sm">No repositories connected yet</p>
      <p className="max-w-[420px] text-body-md text-on-surface-variant">
        Connect one from GitHub or GitLab, or point the tool at a git repository on this machine. It is cloned, analysed
        and scored against the quality gate.
      </p>
    </Panel>
  );
}

export function RepositoriesClient({ organizationId }: { organizationId: string }) {
  const { data: repositories, error, isLoading, refetch } = useGetRepositoriesQuery();

  const passed = repositories?.filter((repository) => repository.gateStatus === 'PASSED').length ?? 0;
  const failed = repositories?.filter((repository) => repository.gateStatus === 'FAILED').length ?? 0;

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-headline-lg">Repositories</h1>
          <p className="text-body-sm text-on-surface-variant">
            {!repositories
              ? ' '
              : repositories.length === 0
                ? 'Nothing connected yet.'
                : `${repositories.length} connected · ${passed} passed · ${failed} failed`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InstallGitHubApp />
          <ConnectRepository organizationId={organizationId} />
        </div>
      </header>

      <InstallOutcome />

      {isLoading ? (
        <QueryLoading label="Loading repositories" />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : !repositories || repositories.length === 0 ? (
        <NoRepositories />
      ) : (
        <RepositoryTable repositories={repositories} />
      )}
    </main>
  );
}
