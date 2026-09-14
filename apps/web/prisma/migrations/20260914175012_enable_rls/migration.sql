-- Supabase auto-exposes every table in the `public` schema through its
-- PostgREST API. Without Row Level Security, the project's public anon key
-- could read/write these tables directly over HTTP, bypassing the app
-- entirely. Prisma connects as the `postgres` role, which bypasses RLS
-- regardless of policies, so enabling it here — with no policies — fully
-- blocks the PostgREST API without affecting the app.
ALTER TABLE "public"."pdf_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
