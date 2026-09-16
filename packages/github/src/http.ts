/**
 * One way in to GitHub's REST API, so the headers and the error shape are
 * decided once.
 *
 * Both credentials this package deals in are `Bearer` tokens as far as the
 * wire is concerned — the app JWT and the installation token differ in what
 * they may do, not in how they are sent — so the caller passes whichever one
 * the endpoint expects and this stays out of it.
 */

const API = 'https://api.github.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  /** An app JWT or an installation token, depending on the endpoint. */
  token: string;
  body?: unknown;
}

export async function githubRequest(path: string, options: RequestOptions): Promise<unknown> {
  const method = options.method ?? 'GET';

  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${options.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'code-quality',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();

  if (!response.ok) {
    // GitHub's own words — "Integration not found", "Resource not accessible by
    // integration" — say far more than the status about a misconfigured app or
    // a permission nobody granted. Truncated, because a validation error can
    // run to kilobytes, and never including what was sent: a request body here
    // may carry a token.
    throw new Error(`GitHub ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }

  return text === '' ? null : JSON.parse(text);
}
