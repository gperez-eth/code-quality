import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Where GitHub sends the browser back. The one-time code is exchanged for a
 * session here, server-side, and the session lands in cookies the proxy then
 * keeps fresh.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  // Only ever a path on this site: a full URL here would be an open redirect
  // out of the sign-in flow, which is a decent phishing primitive.
  const requested = searchParams.get('next') ?? '/';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  if (!code) {
    const description = searchParams.get('error_description') ?? 'GitHub did not return an authorisation code.';
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(description)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  return NextResponse.redirect(`${origin}${next}`);
}
