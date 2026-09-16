'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Where this deployment answers. Behind a proxy the Host header is the
 * forwarded one, so the callback URL matches what the browser actually used.
 */
async function siteOrigin(): Promise<string> {
  const headerList = await headers();
  const origin = headerList.get('origin');
  if (origin) return origin;

  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  const protocol = headerList.get('x-forwarded-proto') ?? 'http';
  if (host) return `${protocol}://${host}`;

  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}

export async function signInWithGitHub(): Promise<void> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: `${await siteOrigin()}/auth/callback` },
  });

  if (error) throw new Error(`GitHub sign-in could not start: ${error.message}`);
  if (!data.url) throw new Error('GitHub sign-in returned no URL to continue at.');

  // redirect() throws, so it goes last: nothing after it runs.
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
