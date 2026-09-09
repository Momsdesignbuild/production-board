-- First BuilderTrend time-clock punch per person per day, written by the MDB
-- mini (only machine with a BT session). Hammer Time reads this; the board
-- doesn't carry carpenters. Read-only for the public role like everything else.
CREATE TABLE IF NOT EXISTS "public"."crew_punches" (
    "date" date NOT NULL,
    "name" text NOT NULL,
    "job" text NOT NULL,
    "punched_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY ("date", "name")
);
ALTER TABLE "public"."crew_punches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON "public"."crew_punches" FOR SELECT USING (true);
GRANT SELECT ON TABLE "public"."crew_punches" TO "anon";
GRANT SELECT ON TABLE "public"."crew_punches" TO "authenticated";
GRANT ALL ON TABLE "public"."crew_punches" TO "service_role";
