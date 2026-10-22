-- 6am rollover now covers R&C (board_state id 2 / board_history_rc) exactly like LA.
-- LA statements are unchanged from 20260909120000_daily_snapshot_cron.sql. The cron schedule is untouched.
CREATE OR REPLACE FUNCTION public.board_daily_rollover() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE board_state b
     SET data = h.data, updated_at = now()
    FROM board_history h
   WHERE b.id = 1
     AND h.date = (now() AT TIME ZONE 'America/Chicago')::date
     AND (b.updated_at AT TIME ZONE 'America/Chicago')::date < h.date;

  INSERT INTO board_history (date, data)
  SELECT (now() AT TIME ZONE 'America/Chicago')::date, data FROM board_state WHERE id = 1
  ON CONFLICT (date) DO NOTHING;

  UPDATE board_state b
     SET data = h.data, updated_at = now()
    FROM board_history_rc h
   WHERE b.id = 2
     AND h.date = (now() AT TIME ZONE 'America/Chicago')::date
     AND (b.updated_at AT TIME ZONE 'America/Chicago')::date < h.date;

  INSERT INTO board_history_rc (date, data)
  SELECT (now() AT TIME ZONE 'America/Chicago')::date, data FROM board_state WHERE id = 2
  ON CONFLICT (date) DO NOTHING;
$$;
