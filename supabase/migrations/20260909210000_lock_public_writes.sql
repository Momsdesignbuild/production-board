-- The anon key ships in the page, so any policy that lets "public" write means
-- anyone with the key can rewrite the board without the PIN. Every write in the
-- app goes through /api/* with the service role (which bypasses RLS), so public
-- only needs SELECT (live refresh + realtime). Drop the rest.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND cmd IN ('INSERT','UPDATE','DELETE')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;
-- belt and braces: no table-level write grants for anon/authenticated either
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
