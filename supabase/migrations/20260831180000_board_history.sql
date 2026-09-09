-- Per-calendar-day snapshots of board_state.data, keyed by date. Today's row
-- is kept in sync automatically on every save-board call. Future dates hold
-- a plan that hasn't gone live yet; past dates are read-only history.
CREATE TABLE IF NOT EXISTS "public"."board_history" (
    "date" date NOT NULL,
    "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "public"."board_history" OWNER TO "postgres";

ALTER TABLE ONLY "public"."board_history"
    ADD CONSTRAINT "board_history_pkey" PRIMARY KEY ("date");

ALTER TABLE "public"."board_history" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON "public"."board_history" FOR SELECT USING (true);
CREATE POLICY "public insert" ON "public"."board_history" FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON "public"."board_history" FOR UPDATE USING (true);

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."board_history" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."board_history" TO "authenticated";
GRANT ALL ON TABLE "public"."board_history" TO "service_role";
