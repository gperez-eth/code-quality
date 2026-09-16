import { createSign } from 'node:crypto';
import { githubRequest } from './http.js';

/**
 * Authenticating as a GitHub App.
 *
 * Two credentials, two lifetimes, and they are easy to confuse:
 *
 * - The **app JWT** is signed here with the app's private key. It proves "I am
 *   this app" and nothing more — it cannot read a repository. GitHub caps it at
 *   ten minutes.
 * - The **installation token** is what the JWT buys: a real credential for one
 *   customer's installation, scoped to the repositories they selected and the
 *   permissions they granted, and expiring in an hour. This is what clones.
 *
 * That split is the whole reason a GitHub App beats a pasted personal access
 * token: the customer can see exactly what it reaches, revoke it in one click,
 * and nothing long-lived of theirs is ever stored here.
 */

/** GitHub allows ten minutes; nine leaves room for a slow clock. */
const JWT_TTL_SECONDS = 9 * 60;

/**
 * How long before expiry a cached token stops being reused. An analysis can
 * take minutes and the token has to outlive the clone, not just the request
 * that fetched it.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface AppCredentials {
  /** The numeric App ID from the app's settings page. */
  appId: string;
  /** The PEM private key, PKCS#1 or PKCS#8 — node accepts both. */
  privateKey: string;
}

export interface InstallationToken {
  token: string;
  expiresAt: Date;
}

export interface InstallationAccount {
  id: number;
  login: string;
  /** "User" or "Organization", as GitHub spells them. */
  type: string | null;
  suspended: boolean;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * A private key pasted into a single-line `.env` arrives with its newlines
 * escaped, because a PEM is multi-line and a dotenv value is not. Putting them
 * back is the difference between a working app and an opaque "error:0909006C"
 * from OpenSSL, so it happens once, here, rather than at each call site.
 */
export function normalizePrivateKey(key: string): string {
  // Surrounding quotes survive some dotenv parsers and are not part of the PEM.
  const unquoted = key.trim().replace(/^["']|["']$/g, '');
  return unquoted.replace(/\\n/g, '\n');
}

/**
 * Signs the short-lived JWT that authenticates as the app itself.
 *
 * `iat` is backdated a minute on purpose: GitHub rejects a token issued in its
 * future, and a workstation clock that is thirty seconds fast is common enough
 * that the alternative is an intermittent 401 nobody can reproduce.
 */
export function appJwt(credentials: AppCredentials, now: Date = new Date()): string {
  const issued = Math.floor(now.getTime() / 1000) - 60;

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: issued, exp: issued + JWT_TTL_SECONDS, iss: credentials.appId }),
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();

  const signature = base64url(signer.sign(normalizePrivateKey(credentials.privateKey)));
  return `${header}.${payload}.${signature}`;
}

/**
 * Trades the app JWT for a token that can actually clone. Scoped to the
 * installation, and to whatever the customer granted it.
 */
export async function mintInstallationToken(
  credentials: AppCredentials,
  installationId: number,
): Promise<InstallationToken> {
  const body = (await githubRequest(`/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    token: appJwt(credentials),
  })) as { token?: string; expires_at?: string } | null;

  if (!body?.token) throw new Error(`GitHub returned no token for installation ${installationId}`);

  return {
    token: body.token,
    expiresAt: body.expires_at ? new Date(body.expires_at) : new Date(Date.now() + 3600_000),
  };
}

/** Who installed the app, for showing "installed on acme" without guessing. */
export async function fetchInstallation(
  credentials: AppCredentials,
  installationId: number,
): Promise<InstallationAccount> {
  const body = (await githubRequest(`/app/installations/${installationId}`, {
    token: appJwt(credentials),
  })) as {
    id?: number;
    account?: { login?: string; type?: string };
    suspended_at?: string | null;
  } | null;

  return {
    id: body?.id ?? installationId,
    login: body?.account?.login ?? '',
    type: body?.account?.type ?? null,
    suspended: Boolean(body?.suspended_at),
  };
}

/**
 * Mints installation tokens and holds on to them until they are nearly spent.
 *
 * A worker analysing ten repositories for one customer should authenticate
 * once, not ten times: GitHub rate-limits app JWT calls, and a token is good
 * for an hour. The cache is per process and deliberately not persisted —
 * a credential that outlives the process that earned it is a credential
 * somebody has to remember to clean up.
 */
export class InstallationTokens {
  readonly #credentials: AppCredentials;
  readonly #cache = new Map<number, InstallationToken>();

  constructor(credentials: AppCredentials) {
    this.#credentials = credentials;
  }

  async get(installationId: number): Promise<string> {
    const cached = this.#cache.get(installationId);
    if (cached && cached.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
      return cached.token;
    }

    const minted = await mintInstallationToken(this.#credentials, installationId);
    this.#cache.set(installationId, minted);
    return minted.token;
  }

  /** Drops a token the API has already refused, so the next call mints afresh. */
  forget(installationId: number): void {
    this.#cache.delete(installationId);
  }
}

/**
 * Reads the app's credentials from the environment, or returns null when the
 * app is not configured.
 *
 * Null is a supported state, not a failure: an installation of this product
 * that only analyses public repositories never needs an app, and the worker
 * falls back to the stored token path. Failing to start would make the app
 * mandatory by accident.
 *
 * These belong to the worker's environment, beside `SUPABASE_SERVICE_ROLE_KEY`
 * — they are *our* credential, not a customer's, which is what separates them
 * from the repository tokens in Supabase Vault. They must never appear in
 * `apps/web/.env`, and never under a `NEXT_PUBLIC_` name.
 */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AppCredentials | null {
  const appId = env['GITHUB_APP_ID']?.trim();
  const privateKey = env['GITHUB_APP_PRIVATE_KEY']?.trim();

  if (!appId || !privateKey) return null;
  return { appId, privateKey: normalizePrivateKey(privateKey) };
}
