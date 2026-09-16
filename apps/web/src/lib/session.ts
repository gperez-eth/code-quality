import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Enums } from '@/lib/api/database.types';
import { createClient } from './supabase/server';

/**
 * Who is asking, and on whose behalf.
 *
 * This is the Data Access Layer: the session is checked here, next to the
 * data, rather than trusted from the proxy — a cookie is spoofable and the
 * proxy only keeps it fresh. Both lookups are memoised with React's `cache`,
 * so a page asking in five places still costs one round trip.
 *
 * It reaches the database the same way everything else does now: over the API,
 * with the caller's own token, under the caller's own policies.
 */

/** The signed-in account, or null when nobody is. */
export const currentUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims.sub ?? null;
});

export interface CurrentOrganization {
  id: string;
  slug: string;
  name: string;
  role: Enums<'org_role'>;
}

/**
 * The organisation the request acts on. Today that is the oldest one the
 * account belongs to — its personal organisation. Once people can belong to
 * several, this is where a switcher reads from, and every caller downstream
 * keeps working.
 *
 * The `user_id` filter is not redundant with RLS: the policy on
 * `organization_members` exposes every membership row of an organisation you
 * belong to, which in a shared organisation means your colleagues' rows too.
 */
export const currentOrganization = cache(async (): Promise<CurrentOrganization | null> => {
  const userId = await currentUserId();
  if (!userId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organization_members')
    .select('role, organization:organizations(id, slug, name)')
    .eq('user_id', userId)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  if (error || !data?.organization) return null;

  return {
    id: data.organization.id,
    slug: data.organization.slug,
    name: data.organization.name,
    role: data.role,
  };
});

/** For pages: send anyone without a session to sign in rather than throwing. */
export async function requireOrganizationOrSignIn(): Promise<CurrentOrganization> {
  const organization = await currentOrganization();
  if (!organization) redirect('/login');
  return organization;
}

/**
 * The organisation every write is scoped to. It throws rather than falling
 * back to, say, the first organisation in the table: a wrong answer here
 * writes one customer's analysis into another customer's project, and no later
 * check would catch it.
 */
export async function requireOrganization(): Promise<string> {
  const organization = await currentOrganization();
  if (!organization) throw new Error('Not signed in.');
  return organization.id;
}
