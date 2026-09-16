/**
 * What the app needs before it can do anything: the project URL and the
 * publishable key, both from `apps/web/.env`. Everything reaches the database
 * through the API, so there is nothing else to configure.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
