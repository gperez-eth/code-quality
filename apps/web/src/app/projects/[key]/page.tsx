import { GettingStarted } from '@/components/getting-started';
import { isSupabaseConfigured } from '@/lib/config';
import { requireOrganizationOrSignIn } from '@/lib/session';
import { OverviewClient } from './overview-client';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({ params }: { params: Promise<{ key: string }> }) {
  if (!isSupabaseConfigured()) return <GettingStarted reason="no-database" />;

  const { key } = await params;
  await requireOrganizationOrSignIn();

  return <OverviewClient projectKey={key} />;
}
