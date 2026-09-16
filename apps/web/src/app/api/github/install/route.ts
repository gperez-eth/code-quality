import { NextResponse, type NextRequest } from 'next/server';
import { currentOrganization } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Sends someone off to install the GitHub App.
 *
 * The only thing that happens here is minting the `state` GitHub will echo
 * back. It is what makes the return leg believable: without it the setup
 * redirect is a URL anyone can type, carrying an installation id anyone can
 * guess. See `claim_github_install` for the rest of the check — the state
 * proves the flow started here, the webhook proves whose installation it is.
 */

const APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

function back(origin: string, error: string): NextResponse {
  return NextResponse.redirect(`${origin}/?github_error=${encodeURIComponent(error)}`);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { origin } = new URL(request.url);

  const organization = await currentOrganization();
  if (!organization) return NextResponse.redirect(`${origin}/login`);

  if (!APP_SLUG) {
    return back(origin, 'No GitHub App is configured. Set NEXT_PUBLIC_GITHUB_APP_SLUG.');
  }

  const supabase = await createClient();
  const { data: state, error } = await supabase.rpc('begin_github_install', {
    p_organization_id: organization.id,
  });

  if (error || !state) return back(origin, error?.message ?? 'Could not start the installation.');

  // `installations/new` is the app-owner-agnostic entry point: GitHub asks
  // which account to install on, which is the question we cannot answer for
  // them and must not guess.
  return NextResponse.redirect(
    `https://github.com/apps/${APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`,
  );
}
