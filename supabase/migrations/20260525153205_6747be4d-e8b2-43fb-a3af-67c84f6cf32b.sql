CREATE TABLE public.admins (
  telegram_id BIGINT PRIMARY KEY,
  added_by_telegram_id BIGINT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
-- No policies: access only via service role (bot server).