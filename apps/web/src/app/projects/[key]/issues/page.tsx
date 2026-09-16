import { Suspense } from 'react';
import { GettingStarted } from '@/components/getting-started';
import { QueryLoading } from '@/components/query-state';
import { isSupabaseConfigured } from '@/lib/config';
import { requireOrganizationOrSignIn } from '@/lib/session';
import { IssuesClient } from './issues-client';

export const dynamic = 'force-dynamic';

/**
 * The Suspense boundary is required, not decorative: the client below reads
 * the query string with `useSearchParams`, and Next will not render a
 * component that does so without one.
 */
export default async function IssuesPage({ params }: { params: Promise<{ key: string }> }) {
  if (!isSupabaseConfigured()) return <GettingStarted reason="no-database" />;

  const { key } = await params;
  await requireOrganizationOrSignIn();

  return (
    <Suspense fallback={<QueryLoading label="Loading issues" />}>
      <IssuesClient projectKey={key} />
    </Suspense>
  );
}
