import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { authenticatedUrl, keyFromRemote, parseRemote, redact, type RemoteInfo } from './remote.js';

const run = promisify(execFile);

/** Where clones live when the caller does not say. */
export const DEFAULT_WORKSPACE = process.env['CODE_QUALITY_WORKSPACE'] ?? join(tmpdir(), 'code-quality-workspaces');

/**
 * A remote to clone. There is deliberately no local-path variant: we host the
 * analysis, so a filesystem path would be a path on the worker's own box —
 * reachable, and never what the caller meant. See ADR-0006 in the vault.
 */
export interface RepositorySource {
  url: string;
  token?: string;
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  author: string;
  authoredAt: Date;
  message: string;
}

export interface Checkout {
  /** Directory the analyzer should scan. */
  path: string;
  branch: string;
  commit: CommitInfo;
  remote?: RemoteInfo;
}

export interface PrepareOptions {
  /** Defaults to the repository's own default branch. */
  branch?: string;
  /** Analyse this exact commit instead of the tip of the branch. */
  commit?: string;
  workspace?: string;
}

/**
 * Runs git with an argument list — never a shell string — so a branch named
 * `; rm -rf /` is just a branch that does not exist.
 */
async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await run('git', args, {
      ...(cwd ? { cwd } : {}),
      maxBuffer: 32 * 1024 * 1024,
      // Never let git stop for credentials: fail instead of hanging a request.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    });
    return stdout.trim();
  } catch (error) {
    const details = error as { stderr?: string; message: string };
    throw new Error(redact(details.stderr?.trim() || details.message));
  }
}

const COMMIT_FORMAT = ['%H', '%h', '%an', '%aI', '%s'].join('%x1f');

function parseCommit(line: string): CommitInfo {
  const [sha, shortSha, author, authoredAt, ...message] = line.split('');

  return {
    sha: sha ?? '',
    shortSha: shortSha ?? '',
    author: author ?? '',
    authoredAt: new Date(authoredAt ?? 0),
    message: message.join(''),
  };
}

export async function isRepository(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, '.git'))).isDirectory() || (await stat(join(path, '.git'))).isFile();
  } catch {
    return false;
  }
}

export async function readCommit(path: string, ref = 'HEAD'): Promise<CommitInfo> {
  return parseCommit(await git(['log', '-1', `--format=${COMMIT_FORMAT}`, ref], path));
}

export async function currentBranch(path: string): Promise<string> {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], path);
  // A detached HEAD reports "HEAD"; the caller wants something it can show.
  return branch === 'HEAD' ? await git(['rev-parse', '--short', 'HEAD'], path) : branch;
}

export async function listBranches(path: string): Promise<string[]> {
  const output = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'], path);

  const branches = output
    .split('\n')
    .map((line) => line.replace(/^origin\//, '').trim())
    .filter((line) => line !== '' && line !== 'HEAD');

  return [...new Set(branches)].sort();
}

/** Commits on a branch, newest first: the Activity view reads from this. */
export async function listCommits(path: string, ref = 'HEAD', limit = 20): Promise<CommitInfo[]> {
  const output = await git(['log', `-${limit}`, `--format=${COMMIT_FORMAT}`, ref], path);
  return output === '' ? [] : output.split('\n').map(parseCommit);
}

/** What `origin/HEAD` points at — the branch the repository itself calls default. */
export async function defaultBranch(path: string): Promise<string> {
  try {
    // symbolic-ref knows what origin/HEAD points at, which is the real default.
    const ref = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], path);
    return ref.replace(/^origin\//, '');
  } catch {
    return currentBranch(path);
  }
}

async function cloneOrFetch(remote: RemoteInfo, token: string | undefined, workspace: string): Promise<string> {
  const path = join(workspace, keyFromRemote(remote));
  const url = authenticatedUrl(remote, token);

  if (await isRepository(path)) {
    // The stored remote never carries a token, so it is set per fetch.
    await git(['remote', 'set-url', 'origin', url], path);
    await git(['fetch', '--prune', 'origin'], path);
  } else {
    await mkdir(workspace, { recursive: true });
    await git(['clone', '--no-checkout', url, path]);
  }

  // Put the credential-free URL back: the working copy outlives the request.
  await git(['remote', 'set-url', 'origin', remote.cleanUrl], path);
  return path;
}

/**
 * Gets a working copy ready to analyse from a remote git repository. It is
 * cloned once into the workspace and fetched after that, so the second
 * analysis of a repository is cheap.
 */
export async function prepareCheckout(source: RepositorySource, options: PrepareOptions = {}): Promise<Checkout> {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;

  const remote = parseRemote(source.url);
  const path = await cloneOrFetch(remote, source.token, workspace);
  const branch = options.branch ?? (await defaultBranch(path));
  const target = options.commit ?? `origin/${branch}`;

  await git(['checkout', '--force', '--detach', target], path);

  return { path, branch, commit: await readCommit(path), remote };
}
