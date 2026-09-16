export type Provider = 'github' | 'gitlab' | 'other';

export interface RemoteInfo {
  provider: Provider;
  host: string;
  /** "owner/repo", as both GitHub and GitLab name things. */
  path: string;
  owner: string;
  name: string;
  /** The URL with any credentials stripped: what is safe to store and show. */
  cleanUrl: string;
}

const SSH_SYNTAX = /^(?:(?<user>[^@]+)@)?(?<host>[^:/]+):(?<path>.+)$/;

function providerFor(host: string): Provider {
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  if (host === 'gitlab.com' || host.startsWith('gitlab.')) return 'gitlab';
  return 'other';
}

/**
 * Understands the three shapes people paste: an HTTPS URL, an SSH URL, and
 * `git@host:owner/repo.git`. Credentials in the URL are dropped rather than
 * kept, so a pasted token never reaches the database or a log line.
 */
export function parseRemote(url: string): RemoteInfo {
  const trimmed = url.trim();
  if (trimmed === '') throw new Error('A repository URL is required');

  let host: string;
  let path: string;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    host = parsed.host;
    path = parsed.pathname;
  } else {
    const match = SSH_SYNTAX.exec(trimmed);
    if (!match?.groups) throw new Error(`Not a repository URL: ${trimmed}`);
    host = match.groups['host']!;
    path = match.groups['path']!;
  }

  const segments = path.replace(/^\/+/, '').replace(/\.git$/, '').split('/').filter(Boolean);
  const name = segments.at(-1);
  if (!name || segments.length < 2) throw new Error(`Cannot tell the owner and repository from: ${trimmed}`);

  return {
    provider: providerFor(host),
    host,
    path: segments.join('/'),
    owner: segments.slice(0, -1).join('/'),
    name,
    cleanUrl: `https://${host}/${segments.join('/')}.git`,
  };
}

/**
 * Builds the URL git actually dials, with the token as the password. Callers
 * must keep the result out of logs: use `redact` on anything they print.
 */
export function authenticatedUrl(remote: RemoteInfo, token?: string): string {
  if (!token) return remote.cleanUrl;

  // GitLab wants a username alongside the token; GitHub accepts anything.
  const user = remote.provider === 'gitlab' ? 'oauth2' : 'x-access-token';
  return `https://${user}:${encodeURIComponent(token)}@${remote.host}/${remote.path}.git`;
}

/** Removes credentials from any text before it is logged or stored. */
export function redact(text: string): string {
  return text.replace(/\/\/[^/@\s]*:[^/@\s]*@/g, '//***:***@');
}

/** A default project key: "owner/repo" reads better as "owner-repo" in a URL. */
export function keyFromRemote(remote: RemoteInfo): string {
  return remote.path.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}
