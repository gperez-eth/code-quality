import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/** The Supabase client with the schema baked in, so every query is checked. */
export type TypedSupabaseClient = SupabaseClient<Database>;

let cached: TypedSupabaseClient | undefined;

/**
 * One client per tab. `createBrowserClient` reads the session from the same
 * cookies the server writes, so a query issued from a component carries the
 * signed-in account's JWT and lands under its RLS policies.
 *
 * Memoised because a second client would keep its own auth listener and the
 * two would race on token refresh.
 */
export function getSupabaseClient(): TypedSupabaseClient {
  cached ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return cached;
}
