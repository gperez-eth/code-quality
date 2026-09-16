-- drizzle is gone from the project, and so is the schema it used to record
-- which migrations it had applied. Supabase's own migration table is the only
-- bookkeeping left.
DROP TABLE IF EXISTS "drizzle"."__drizzle_migrations";
DROP SCHEMA IF EXISTS "drizzle" CASCADE;
