-- Frame templates: the structural job-row layout (how many rows, each row's
-- default color) is being pulled out of the hardcoded JOB_ROWS constant in
-- index.html and into data, so it can be edited and swapped between saved
-- layouts. job_rows shape matches the old JS constant exactly: an array of
-- {name, color} — name here is just a legacy default seed, never the real
-- job name (real names live in board_state/board_history's jobs array).
CREATE TABLE IF NOT EXISTS "public"."frame_templates" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "job_rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "public"."frame_templates" OWNER TO "postgres";

ALTER TABLE ONLY "public"."frame_templates"
    ADD CONSTRAINT "frame_templates_pkey" PRIMARY KEY ("id");

ALTER TABLE "public"."frame_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON "public"."frame_templates" FOR SELECT USING (true);
CREATE POLICY "public insert" ON "public"."frame_templates" FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON "public"."frame_templates" FOR UPDATE USING (true);

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."frame_templates" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."frame_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."frame_templates" TO "service_role";

-- board_config: a singleton row (id is always 1) that points at whichever
-- frame_template is live right now. Only one row ever exists.
CREATE TABLE IF NOT EXISTS "public"."board_config" (
    "id" integer NOT NULL,
    "active_frame_template_id" uuid,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "board_config_singleton" CHECK ("id" = 1)
);

ALTER TABLE "public"."board_config" OWNER TO "postgres";

ALTER TABLE ONLY "public"."board_config"
    ADD CONSTRAINT "board_config_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."board_config"
    ADD CONSTRAINT "board_config_active_frame_template_fkey"
    FOREIGN KEY ("active_frame_template_id") REFERENCES "public"."frame_templates"("id");

ALTER TABLE "public"."board_config" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON "public"."board_config" FOR SELECT USING (true);
CREATE POLICY "public insert" ON "public"."board_config" FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON "public"."board_config" FOR UPDATE USING (true);

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."board_config" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."board_config" TO "authenticated";
GRANT ALL ON TABLE "public"."board_config" TO "service_role";

-- board_history needs to remember which frame was live on a given day, so
-- history playback shows the frame that was actually there, not today's.
ALTER TABLE "public"."board_history" ADD COLUMN IF NOT EXISTS "frame_template_id" uuid REFERENCES "public"."frame_templates"("id");

-- seed the "Default" template from the exact 8-row/all-blue layout that's
-- hardcoded in index.html today, and make it the active one, so migrating
-- to this data model changes nothing about how the live board looks.
INSERT INTO "public"."frame_templates" ("id", "name", "job_rows")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default',
  '[{"name":"","color":"blue"},{"name":"","color":"blue"},{"name":"","color":"blue"},{"name":"","color":"blue"},{"name":"","color":"blue"},{"name":"","color":"blue"},{"name":"","color":"blue"},{"name":"","color":"blue"}]'::jsonb
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "public"."board_config" ("id", "active_frame_template_id")
VALUES (1, '00000000-0000-0000-0000-000000000001')
ON CONFLICT ("id") DO NOTHING;
