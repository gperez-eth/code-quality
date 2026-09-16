import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/api/database.types';

/**
 * Supabase as seen from Server Components, Server Actions and Route Handlers.
 *
 * Reads the session out of the request cookies rather than any global state,
 * so two requests never see each other's user — and carries the schema, so a
 * server-side query is checked against the same generated types the browser
 * uses.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
          } catch {
            // A Server Component cannot write cookies. Harmless: the proxy is
            // what refreshes the session, and it runs before this.
          }
        },
      },
    },
  );
}
