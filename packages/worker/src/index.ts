#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { analyze, toReport } from '@code-quality/analyzer';
import { ratingValue, type ScanReport, SONAR_WAY_GATE } from '@code-quality/core';
import {
  keyFromRemote,
  parseRemote,
  prepareCheckout,
  type RemoteInfo,
  type RepositorySource,
} from '@code-quality/git';
import {
  credentialsFromEnv,
  InstallationTokens,
  publishQualityGateCheck,
  type GateStatus,
} from '@code-quality/github';

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

// The lease this worker asks for on every claim. The server is free to hand
// back something else, and the heartbeat below schedules off whatever a job
// actually carries rather than this constant.
const LEASE_SECONDS = 60;

// A job stuck longer than this is not "slow", it is stuck: analyzing a
// repository does not naturally take ten minutes, so past this the worker
// abandons the job and reports a timeout instead of blocking the loop on it
// forever.
const JOB_TIMEOUT_MS = Number(process.env['CODE_QUALITY_JOB_TIMEOUT_MS'] ?? 600_000);

// walk.ts already refuses any single file over 1MB, but nothing capped the
// checkout as a whole — a repository that is mostly vendored dependencies or
// a handful of huge binaries could still fill the disk before a rule runs.
const MAX_REPO_MB = Number(process.env['CODE_QUALITY_MAX_REPO_MB'] ?? 500);

// Identifies this process in logs and leases, not who it is: hostname plus
// pid is enough for someone reading the dashboard to tell two workers apart.
const WORKER_ID = `${hostname()}:${process.pid}`;

// The GitHub App, if one is configured. Null is a supported state: an instance
// that only ever analyses public repositories needs no app, and one that still
// uses pasted tokens keeps working. The app's credentials belong here beside
// SUPABASE_SERVICE_ROLE_KEY — they are ours, not a customer's, which is what
// separates them from the repository tokens in Supabase Vault.
const GITHUB_APP = credentialsFromEnv();
const INSTALLATION_TOKENS = GITHUB_APP ? new InstallationTokens(GITHUB_APP) : null;

// Where the "Details" link on a check run points. Unset just omits the link:
// the worker has no way to know the dashboard's public URL, and guessing would
// send people somewhere that does not exist.
const DASHBOARD_URL = process.env['CODE_QUALITY_DASHBOARD_URL']?.replace(/\/+$/, '');

interface Job {
  id: string;
  organizationId: string;
  projectKey: string | null;
  projectName: string | null;
  provider: 'GITHUB' | 'GITLAB' | 'OTHER';
  repositoryUrl: string | null;
  branch: string | null;
  trigger: 'MANUAL' | 'PUSH' | 'SCHEDULE' | 'CLI';
  attempts: number;
  accessTokenId: string | null;
  accessToken: string | null;
  leaseSeconds: number;
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

/**
 * The installation this organisation's repositories are reachable through, or
 * null if they never installed the app.
 *
 * A suspended installation is excluded rather than reported: GitHub keeps the
 * row when a customer suspends, and minting against it fails. Falling back to a
 * stored token is the right behaviour, not an error.
 */
async function installationFor(supabase: SupabaseClient, organizationId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('github_installations')
    .select('id')
    .eq('organization_id', organizationId)
    .is('suspended_at', null)
    .order('installed_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not look up the GitHub installation: ${error.message}`);
  return (data as { id: number } | null)?.id ?? null;
}

/**
 * Works out what to clone with.
 *
 * An installation token wins over a stored one wherever both exist: it is
 * scoped to what the customer granted, it expires in an hour, and it is the
 * whole point of the app. The pasted personal access token stays as the
 * fallback for GitLab, for a repository the app is not installed on, and for
 * anyone who has not installed it — removing that path would break every
 * project connected before the app existed.
 *
 * Never logged, never returned to the caller, never written to a row: it goes
 * straight into the URL git dials, and `redact` scrubs anything printed.
 */
interface Credential {
  token: string | null;
  /** Set only when the token came from an installation, which is what may write a check run. */
  installationId: number | null;
}

async function cloneToken(supabase: SupabaseClient, job: Job, remoteIsGitHub: boolean): Promise<Credential> {
  if (!INSTALLATION_TOKENS || !remoteIsGitHub) return { token: job.accessToken, installationId: null };

  const installationId = await installationFor(supabase, job.organizationId);
  if (installationId === null) return { token: job.accessToken, installationId: null };

  try {
    const token = await INSTALLATION_TOKENS.get(installationId);
    console.log(`  authenticating as installation ${installationId}`);
    return { token, installationId };
  } catch (error) {
    // A misconfigured app should not strand a project that already had a
    // working token, so this degrades rather than fails — but it says so,
    // because silently using the weaker credential is how "the app does
    // nothing" goes unnoticed for a week.
    const reason = error instanceof Error ? error.message : String(error);
    if (!job.accessToken) throw new Error(`Could not mint an installation token: ${reason}`);
    console.warn(`  installation ${installationId} token failed, falling back to the stored token: ${reason}`);
    return { token: job.accessToken, installationId: null };
  }
}

/**
 * Says what the gate decided, on the commit that was analysed.
 *
 * Best-effort on purpose: the analysis is already stored and the dashboard
 * already shows it, so a check run that fails to publish is a missing
 * decoration, not a failed job. Throwing here would mark a perfectly good
 * analysis FAILED and queue a retry that re-clones and re-parses everything to
 * fix a comment on a pull request.
 *
 * Needs `Checks: Read & Write`, which an older installation will not have
 * granted — GitHub answers 403 until the customer accepts the new permissions,
 * and that is a normal state rather than an error to chase.
 */
async function decorateCommit(
  supabase: SupabaseClient,
  credential: Credential,
  remote: RemoteInfo,
  headSha: string,
  analysisId: string,
  projectKey: string,
  counters: Record<string, unknown>,
): Promise<void> {
  if (!credential.installationId || !credential.token || headSha === '' || analysisId === '') return;

  try {
    const { data } = await supabase.from('analyses').select('gate_status').eq('id', analysisId).maybeSingle();
    const gate = (data as { gate_status: GateStatus } | null)?.gate_status ?? null;

    await publishQualityGateCheck(
      credential.token,
      {
        owner: remote.owner,
        repo: remote.name,
        headSha,
        ...(DASHBOARD_URL ? { detailsUrl: `${DASHBOARD_URL}/projects/${encodeURIComponent(projectKey)}` } : {}),
      },
      {
        gate,
        newIssues: Number(counters['newIssues'] ?? 0),
        reopenedIssues: Number(counters['reopenedIssues'] ?? 0),
        closedIssues: Number(counters['closedIssues'] ?? 0),
        unchangedIssues: Number(counters['unchangedIssues'] ?? 0),
      },
    );

    console.log(`  published a check run on ${remote.path}@${headSha.slice(0, 7)}`);
  } catch (error) {
    console.warn(`  could not publish the check run: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sourceFor(job: Job, credential: Credential): RepositorySource {
  if (!job.repositoryUrl) throw new Error('A job needs a repository URL');
  return { url: job.repositoryUrl, ...(credential.token ? { token: credential.token } : {}) };
}

/**
 * Sums file sizes under a checkout, the same recursive shape as walk.ts's
 * own traversal but with no filtering: the .git directory and every
 * generated file count too, because it is disk space, not analysis time,
 * that a huge checkout threatens.
 */
async function directorySizeBytes(root: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    const path = join(root, entry.name);
    try {
      if (entry.isDirectory()) total += await directorySizeBytes(path);
      else if (entry.isFile()) total += (await stat(path)).size;
    } catch {
      // A file that vanished or a symlink that does not resolve is not what
      // this check exists to catch; skip it and keep summing.
      continue;
    }
  }

  return total;
}

async function runJob(supabase: SupabaseClient, job: Job): Promise<string> {
  if (!job.repositoryUrl) throw new Error('A job needs a repository URL');

  const remote = parseRemote(job.repositoryUrl);
  const credential = await cloneToken(supabase, job, remote.provider === 'github');
  const source = sourceFor(job, credential);
  const checkout = await prepareCheckout(source, job.branch ? { branch: job.branch } : {});

  // The per-file cap already exists — walk.ts skips anything over 1MB — but
  // that says nothing about the checkout as a whole, so this is the
  // repo-level cap that did not exist before.
  const repoBytes = await directorySizeBytes(checkout.path);
  const repoMb = repoBytes / (1024 * 1024);
  if (repoMb > MAX_REPO_MB) {
    throw new Error(`Repository checkout is ${repoMb.toFixed(1)}MB, over the ${MAX_REPO_MB}MB cap (CODE_QUALITY_MAX_REPO_MB)`);
  }

  const projectKey = normalizeKey(job.projectKey || keyFromRemote(remote));
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
    p_repository_url: remote.cleanUrl,
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

  await decorateCommit(supabase, credential, remote, checkout.commit.sha, analysisId, projectKey, result);

  console.log(
    `  ${projectKey}: ${String(result['newIssues'])} new, ${String(result['reopenedIssues'])} reopened, ` +
      `${String(result['closedIssues'])} closed, ${String(result['unchangedIssues'])} unchanged`,
  );

  return analysisId;
}

async function claim(supabase: SupabaseClient): Promise<Job | null> {
  const { data, error } = await supabase.rpc('claim_analysis_job', {
    p_worker_id: WORKER_ID,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw new Error(`Could not claim a job: ${error.message}`);
  return (data as Job | null) ?? null;
}

/**
 * Renews the lease on a job that is still running. False means the lease
 * already expired and something else — another worker's claim, or a sweep —
 * has taken the job back, so whatever is still running here is not this
 * worker's to finish anymore.
 */
async function heartbeat(supabase: SupabaseClient, jobId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('heartbeat_analysis_job', {
    p_job_id: jobId,
    p_lease_seconds: LEASE_SECONDS,
  });

  if (error) {
    // A failed heartbeat request is not the same as a lost lease: keep the
    // job rather than abandoning it over a request that merely failed.
    console.error(`  could not renew the lease on job ${jobId}: ${error.message}`);
    return true;
  }

  return data !== false;
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

/**
 * Requeues or fails whatever jobs' leases expired without a heartbeat —
 * a worker that crashed, was killed, or simply lost its network partway
 * through. There is no cron in this project, so rather than stand up a
 * scheduled process just to call this occasionally, every worker calls it on
 * its own poll: it is cheap, idempotent, and the loop is already running
 * forever anyway.
 */
async function reclaimStranded(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.rpc('reclaim_stranded_jobs');
  if (error) {
    console.error(`worker: could not reclaim stranded jobs: ${error.message}`);
    return;
  }

  const count = typeof data === 'number' ? data : 0;
  if (count > 0) console.log(`worker: reclaimed ${count} stranded job${count === 1 ? '' : 's'}`);
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

  console.log(`worker: polling every ${POLL_INTERVAL_MS}ms as ${WORKER_ID}`);
  console.log(
    GITHUB_APP
      ? `worker: GitHub App ${GITHUB_APP.appId} configured; private repositories clone with installation tokens`
      : 'worker: no GitHub App configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY); private repositories need a stored token',
  );

  while (running) {
    try {
      await reclaimStranded(supabase);
    } catch (error) {
      console.error(`worker: ${(error as Error).message}`);
    }

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

    // Captured so the heartbeat's closures keep the narrowed, non-null type:
    // `job` itself gets reassigned next time round the loop.
    const currentJob = job;
    console.log(`worker: job ${currentJob.id} (attempt ${currentJob.attempts}, lease ${currentJob.leaseSeconds}s)`);

    let leaseLost = false;
    let signalLeaseLost: () => void = () => {};
    const leaseLostSignal = new Promise<void>((resolve) => {
      signalLeaseLost = resolve;
    });

    // A third of the lease, so it is renewed well before it could expire
    // under ordinary jitter, and never so often that it floods the RPC.
    const heartbeatMs = Math.max(1_000, (currentJob.leaseSeconds / 3) * 1000);
    const lease = setInterval(() => {
      heartbeat(supabase, currentJob.id)
        .then((alive) => {
          if (!alive) {
            leaseLost = true;
            signalLeaseLost();
          }
        })
        .catch((error: unknown) => {
          console.error(`  could not renew the lease on job ${currentJob.id}: ${(error as Error).message}`);
        });
    }, heartbeatMs);

    // Held outside the try so the finally can clear it. An uncleared
    // ten-minute timer outlives a two-second job and keeps the process
    // alive, so SIGINT would hang instead of stopping after the job in hand.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    // Set when the work has to be walked away from rather than reported on.
    let abandoned: string | null = null;

    try {
      const timedOut = new Promise<'timeout'>((resolve) => {
        timeoutHandle = setTimeout(() => resolve('timeout'), JOB_TIMEOUT_MS);
      });

      // analyze() has no cancellation hook, so nothing here can make the
      // CPU-bound work itself stop the instant a lease is lost or a timeout
      // hits. "Abandon" means this loop stops waiting on it and never calls
      // finish for it again — the same as if the process had died mid-job,
      // which is exactly the case reclaimStranded() and another worker's
      // claim exist to recover from.
      const outcome = await Promise.race([
        runJob(supabase, currentJob).then((analysisId) => ({ analysisId })),
        leaseLostSignal.then(() => 'lease-lost' as const),
        timedOut,
      ]);

      if (outcome === 'lease-lost') {
        console.log(`  lease lost: another worker reclaimed job ${currentJob.id}, abandoning it here`);
        abandoned = 'the lease was lost';
      } else if (outcome === 'timeout') {
        const message = `Timed out after ${JOB_TIMEOUT_MS}ms (CODE_QUALITY_JOB_TIMEOUT_MS)`;
        console.error(`  failed: ${message}`);
        await finish(supabase, currentJob.id, null, message);
        abandoned = 'the job outran its timeout';
      } else {
        await finish(supabase, currentJob.id, outcome.analysisId || null, null);
      }
    } catch (error) {
      if (leaseLost) {
        console.log(`  lease lost: another worker reclaimed job ${currentJob.id}, abandoning it here`);
        abandoned = 'the lease was lost';
      } else {
        const message = (error as Error).message;
        console.error(`  failed: ${message}`);
        // The message is shown to whoever asked for the analysis, and the git
        // layer already strips credentials out of anything it reports.
        await finish(supabase, currentJob.id, null, message);
      }
    } finally {
      clearInterval(lease);
      if (timeoutHandle) clearTimeout(timeoutHandle);

      if (abandoned) {
        // The work itself cannot be stopped — analyze() takes no cancellation
        // signal — so carrying on would leave it running: still burning CPU,
        // still holding a checkout, and still able to reach import_analysis
        // and publish an analysis for a job already reported as failed. A
        // retry would then publish a second one for the same commit.
        //
        // Ending the process is the only thing in reach that actually stops
        // it. That is not a loss: the lease expires, reclaim_stranded_jobs()
        // re-queues the job behind its backoff, and whoever restarts this
        // worker — or another one already running — picks it up. The recovery
        // path built for a worker that dies is exactly the right one here,
        // because this IS a worker that needs to die.
        console.error(`worker: exiting because ${abandoned}; the job is left for the sweeper to re-queue`);
        // process.exit, not a return: returning would leave the orphaned work
        // holding the event loop open, and it would go on to publish anyway.
        // The finish call above is already awaited, so nothing is lost here.
        process.exit(1);
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(`code-quality-worker: ${(error as Error).message}`);
  process.exitCode = 1;
});
