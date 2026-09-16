import { GettingStarted } from '@/components/getting-started';
import { isSupabaseConfigured } from '@/lib/config';
import { requireOrganizationOrSignIn } from '@/lib/session';
import { BranchesClient } from './branches-client';

export const dynamic = 'force-dynamic';

export default async function BranchesPage({ params }: { params: Promise<{ key: string }> }) {
  if (!isSupabaseConfigured()) return <GettingStarted reason="no-database" />;

  const { key } = await params;
  const organization = await requireOrganizationOrSignIn();

  return <BranchesClient organizationId={organization.id} projectKey={key} />;
}
