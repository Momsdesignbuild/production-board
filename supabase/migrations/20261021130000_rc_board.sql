-- R&C board: its own template and live-state row (board_state id 2). Applied by REST insert 2026-10-21; idempotent.
INSERT INTO public.frame_templates (id, name, job_rows)
VALUES ('00000000-0000-0000-0000-000000000002', 'R&C',
  (SELECT jsonb_agg(jsonb_build_object('name', '', 'color', 'blue')) FROM generate_series(1, 7))
  || jsonb_build_array(jsonb_build_object('name', 'Shop', 'color', 'blue', 'shop', true)))
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.board_state (id, data)
VALUES (2, '{"cards":[],"jobs":[],"drawing":null,"hasDrawing":false}')
ON CONFLICT (id) DO NOTHING;
