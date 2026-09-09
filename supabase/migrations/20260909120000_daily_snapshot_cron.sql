-- 6:00am Minneapolis (11:00 UTC; 12:00 UTC would be CST — pg_cron is UTC-only,
-- so during standard time this fires at 5am, which is still before the shop opens).
--
-- Two jobs, one schedule:
--   1. day rollover — if a plan was saved for today and the live board hasn't
--      been touched today, the plan becomes the live board (same rule as
--      lib/promote.js, but here it runs even if nobody opens the board).
--   2. snapshot — make sure today has a board_history row even on a day when
--      nobody hits Save, so the analytics date math has no holes.
CREATE EXTENSION IF NOT EXISTS pg_cron;

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
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'board-daily-rollover';
SELECT cron.schedule('board-daily-rollover', '0 11 * * *', 'SELECT public.board_daily_rollover()');
