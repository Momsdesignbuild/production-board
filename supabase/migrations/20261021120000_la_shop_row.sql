-- LA board: the bottom (8th) row becomes the fixed Shop row, not a job slot.
-- index.html shows it as "Shop" with no Add Job / hours; lib/crew-board.js treats badges in it as Shop.
UPDATE public.frame_templates
SET job_rows = jsonb_set(job_rows, '{7}', '{"name":"Shop","color":"blue","shop":true}'::jsonb), updated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000001' AND jsonb_array_length(job_rows) = 8;
