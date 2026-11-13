-- BuilderTrend time-clock shifts for the people on the Trench / Hammer rosters, one row per shift (BT shift id).
-- Written every few minutes by the MDB mini (scripts/punch-log.mjs); the Logs popup reads it via /api/analytics?log=.
-- time_in / time_out are Central wall-clock ISO strings exactly as BuilderTrend returns them.
CREATE TABLE IF NOT EXISTS "public"."crew_log" (
    "id" bigint PRIMARY KEY,
    "crew" text NOT NULL CHECK ("crew" IN ('trench','hammer')),
    "name" text NOT NULL,
    "job" text NOT NULL,
    "date" date NOT NULL,
    "time_in" text NOT NULL,
    "time_out" text,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "crew_log_crew_date" ON "public"."crew_log" ("crew", "date");
ALTER TABLE "public"."crew_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON "public"."crew_log" FOR SELECT USING (true);
GRANT SELECT ON TABLE "public"."crew_log" TO "anon";
GRANT SELECT ON TABLE "public"."crew_log" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_log" TO "service_role";
