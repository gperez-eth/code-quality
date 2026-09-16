import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { PostgrestError } from '@supabase/supabase-js';
import { getSupabaseClient, type TypedSupabaseClient } from './client';

/**
 * What an endpoint hands over: a function that builds one request against the
 * typed Supabase client.
 *
 * The shape is deliberately the one PostgREST already resolves to, so a
 * builder can be returned as-is:
 *
 *   (client) => client.from('projects').select('*')
 *
 * and anything needing more than one step — a count alongside the rows, two
 * calls composed — is just an async function returning the same shape:
 *
 *   async (client) => {
 *     const { data, error, count } = await client.from('issues').select('*', { count: 'exact' });
 *     return error ? { data: null, error } : { data: { rows: data, total: count ?? 0 }, error: null };
 *   }
 */
export type SupabaseQuery<T> = (
  client: TypedSupabaseClient,
) => PromiseLike<{ data: T | null; error: PostgrestError | null }>;

/** Postgrest's error, flattened to something Redux can hold in its store. */
export interface SupabaseQueryError {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
}

function toQueryError(error: PostgrestError): SupabaseQueryError {
  return {
    message: error.message,
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  };
}

/**
 * The bridge between RTK Query and Supabase.
 *
 * Worth knowing when a query comes back empty rather than failing: every table
 * is behind RLS, so PostgREST answers what the *signed-in account* may see. A
 * row belonging to another organisation is not forbidden, it simply is not
 * there — which is the intended behaviour, and why an empty result is not on
 * its own a bug.
 */
export const supabaseBaseQuery: BaseQueryFn<SupabaseQuery<unknown>, unknown, SupabaseQueryError> = async (build) => {
  try {
    const { data, error } = await build(getSupabaseClient());
    if (error) return { error: toQueryError(error) };
    return { data };
  } catch (cause) {
    // A transport failure never reaches Postgrest, so it has no PostgrestError
    // to report: offline, DNS, a blocked request.
    return {
      error: { message: (cause as Error).message, code: 'NETWORK_ERROR', details: null, hint: null },
    };
  }
};
