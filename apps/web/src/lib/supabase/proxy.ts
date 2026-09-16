import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the auth token and hands it to both sides: to the Server
 * Components through `request.cookies`, so they do not each try to refresh the
 * same token, and to the browser through `response.cookies`.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) supabaseResponse.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) supabaseResponse.headers.set(key, value);
        },
      },
    },
  );

  // Nothing may go between createServerClient and getClaims: anything that
  // touches cookies in between logs users out at random, and the symptom is
  // miles from the cause.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
