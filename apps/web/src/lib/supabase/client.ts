import { createBrowserClient } from '@supabase/ssr';

/** Supabase as seen from the browser: only ever holds the publishable key. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
