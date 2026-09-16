import { GettingStarted } from '@/components/getting-started';
import { isSupabaseConfigured } from '@/lib/config';
import { requireOrganizationOrSignIn } from '@/lib/session';
import { RepositoriesClient } from './repositories-client';

// The rows read the newest analysis, so nothing here is worth pre-rendering.
export const dynamic = 'force-dynamic';

/**
 * A shell, deliberately.
 *
 * The session check stays on the server: it decides whether there is anyone to
 * serve, and that is not a question to ask the browser, which can lie about
 * it. The data below it comes over the API, under the policies that same
 * session's token carries.
 */
export default async function RepositoriesPage() {
  if (!isSupabaseConfigured()) return <GettingStarted reason="no-database" />;

  const organization = await requireOrganizationOrSignIn();

  return <RepositoriesClient organizationId={organization.id} />;
}
