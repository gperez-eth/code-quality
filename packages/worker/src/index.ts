#!/usr/bin/env node
import { basename } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { analyze, toReport } from '@code-quality/analyzer';
import { ratingValue, type ScanReport, SONAR_WAY_GATE } from '@code-quality/core';
import { keyFromRemote, parseRemote, prepareCheckout, type RepositorySource } from '@code-quality/git';

/**
 * The analysis worker.
 *
 * Asking for an analysis is an insert; this is what does it. Cloning a
 * repository and running tree-sitter over it is minutes of CPU on someone
 * else's code — it has no business inside a web request, which is why the
 * dashboard only writes a row to `analysis_jobs` and returns.
 *
 * Runs as the service role, because it needs the decrypted repository token
 * and has to write analyses for organisations it is not a member of. That
 * makes this the most privileged thing in the system: it never takes input
 * from a browser, only jobs the database hands it.
 */

const POLL_INTERVAL_MS = Number(process.env['CODE_QUALITY_POLL_MS'] ?? 5_000);

interface Job {
  id: string;
  organizationId: string;
  projectKey: string | null;
  projectName: string | null;
  provider: 'GITHUB' | 'GITLAB' | 'LOCAL' | 'OTHER';
  repositoryUrl: string | null;
  localPath: string | null;
  branch: string | null;
  trigger: 'MANUAL' | 'PUSH' | 'SCHEDULE' | 'CLI';
  attempts: number;
  accessTokenId: string | null;
  accessToken: string | null;
}

/** A key is what ends up in the URL, so it has to survive being typed. */
function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultGatePayload() {
  return {
    name: SONAR_WAY_GATE.name,
    conditions: SONAR_WAY_GATE.conditions.map((condition) => ({
      metric: condition.metric,
      operator: condition.operator,
      threshold: typeof condition.threshold === 'number' ? condition.threshold : ratingValue(condition.threshold),
      scope: condition.scope,
    })),
  };
}

function sourceFor(job: Job): RepositorySource {
  if (job.provider === 'LOCAL') {
    if (!job.localPath) throw new Error('A local job needs a path');
    return { kind: 'local', path: job.localPath };
  }

  if (!job.repositoryUrl) throw new Error('A remote job needs a repository URL');
  return { kind: 'remote', url: job.repositoryUrl, ...(job.accessToken ? { token: job.accessToken } : {}) };
}

async function runJob(supabase: SupabaseClient, job: Job): Promise<string> {
  const source = sourceFor(job);
  const checkout = await prepareCheckout(source, job.branch ? { branch: job.branch } : {});

  const fallbackKey =
    source.kind === 'local' ? normalizeKey(basename(checkout.path)) : keyFromRemote(parseRemote(source.url));
  const projectKey = normalizeKey(job.projectKey || fallbackKey);
  if (!projectKey) throw new Error('Could not work out a project key for this repository');

  const report: ScanReport = toReport(await analyze(checkout.path));

  const { data, error } = await supabase.rpc('import_analysis', {
    p_organization_id: job.organizationId,
    p_project_key: projectKey,
    p_report: report,
    p_default_gate: defaultGatePayload(),
    p_project_name: job.projectName ?? projectKey,
    p_provider: job.provider,
    p_branch: checkout.branch,
    p_trigger: job.trigger,
    ...(source.kind === 'local' ? { p_local_path: checkout.path } : { p_repository_url: parseRemote(source.url).cleanUrl }),
    // The vault id, never the token: the project keeps a reference, and only
    // this worker ever sees the plaintext.
    ...(job.accessTokenId ? { p_access_token_id: job.accessTokenId } : {}),
    ...(checkout.commit.sha ? { p_commit_sha: checkout.commit.sha } : {}),
    ...(checkout.commit.message ? { p_commit_message: checkout.commit.message } : {}),
    ...(checkout.commit.author ? { p_commit_author: checkout.commit.author } : {}),
    ...(checkout.commit.authoredAt ? { p_committed_at: checkout.commit.authoredAt.toISOString() } : {}),
  });

  if (error) throw new Error(`Import failed: ${error.message}`);

  const result = (data ?? {}) as Record<string, unknown>;
  const analysisId = typeof result['analysisId'] === 'string' ? result['analysisId'] : '';
  console.log(
    `  ${projectKey}: ${String(result['newIssues'])} new, ${String(result['reopenedIssues'])} reopened, ` +
      `${String(result['closedIssues'])} closed, ${String(result['unchangedIssues'])} unchanged`,
  );

  return analysisId;
}

async function claim(supabase: SupabaseClient): Promise<Job | null> {
  const { data, error } = await supabase.rpc('claim_analysis_job');
  if (error) throw new Error(`Could not claim a job: ${error.message}`);
  return (data as Job | null) ?? null;
}

async function finish(supabase: SupabaseClient, jobId: string, analysisId: string | null, failure: string | null) {
  const { error } = await supabase.rpc('finish_analysis_job', {
    p_job_id: jobId,
    ...(analysisId ? { p_analysis_id: analysisId } : {}),
    ...(failure ? { p_error: failure } : {}),
  });

  // Nothing to do but say so: the job stays RUNNING and a later sweep will
  // have to reclaim it. Losing the worker here is better than losing the loop.
  if (error) console.error(`  could not mark job ${jobId} finished: ${error.message}`);
}

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.error('code-quality-worker: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let running = true;
  const stop = () => {
    // Finish the job in hand rather than abandoning it half-imported.
    console.log('worker: stopping after the current job');
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`worker: polling every ${POLL_INTERVAL_MS}ms`);

  while (running) {
    let job: Job | null = null;

    try {
      job = await claim(supabase);
    } catch (error) {
      console.error(`worker: ${(error as Error).message}`);
    }

    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    console.log(`worker: job ${job.id} (attempt ${job.attempts})`);

    try {
      const analysisId = await runJob(supabase, job);
      await finish(supabase, job.id, analysisId || null, null);
    } catch (error) {
      const message = (error as Error).message;
      console.error(`  failed: ${message}`);
      // The message is shown to whoever asked for the analysis, and the git
      // layer already strips credentials out of anything it reports.
      await finish(supabase, job.id, null, message);
    }
  }
}

main().catch((error: unknown) => {
  console.error(`code-quality-worker: ${(error as Error).message}`);
  process.exitCode = 1;
});
