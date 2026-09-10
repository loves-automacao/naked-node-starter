ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS delayed_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delayed_message text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delayed_delay_minutes integer NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS delayed_exit_on_reply boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS zernio_sequence_id text;