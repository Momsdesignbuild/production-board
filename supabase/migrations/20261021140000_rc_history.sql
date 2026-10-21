-- R&C calendar: its own history table (same shape as board_history), so LA's history, cron and analytics are untouched.
-- Reads are public (SELECT only); every write goes through /api with the service role.
CREATE TABLE IF NOT EXISTS public.board_history_rc (
    date date PRIMARY KEY,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.board_history_rc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.board_history_rc FOR SELECT USING (true);
GRANT SELECT ON public.board_history_rc TO anon, authenticated;
GRANT ALL ON public.board_history_rc TO service_role;
