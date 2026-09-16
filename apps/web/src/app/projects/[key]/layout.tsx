import { GettingStarted } from '@/components/getting-started';
import { isSupabaseConfigured } from '@/lib/config';
import { requireOrganizationOrSignIn } from '@/lib/session';
import { ProjectChrome } from './project-chrome';

export const dynamic = 'force-dynamic';

/**
 * The session check stays here, on the server, and the chrome below fetches
 * over the API. Note what is *not* here any more: no organisation is passed
 * down. The project lookup is scoped by the policies on the caller's token,
 * so a key belonging to another tenant simply does not resolve.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ key: string }>;
}) {
  if (!isSupabaseConfigured()) return <GettingStarted reason="no-database" />;

  const { key } = await params;
  const organization = await requireOrganizationOrSignIn();

  return (
    <ProjectChrome organizationId={organization.id} projectKey={key}>
      {children}
    </ProjectChrome>
  );
}
