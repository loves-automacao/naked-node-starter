
ALTER TABLE public.automation_logs
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS trigger_keyword text,
  ADD COLUMN IF NOT EXISTS stopped_at_step text,
  ADD COLUMN IF NOT EXISTS total_duration_ms integer,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

CREATE TABLE IF NOT EXISTS public.automation_log_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  log_id uuid NOT NULL REFERENCES public.automation_logs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  duration_ms integer,
  error_message text,
  api_status_code integer,
  api_response jsonb,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.automation_log_steps TO authenticated;
GRANT ALL ON public.automation_log_steps TO service_role;

ALTER TABLE public.automation_log_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own log steps"
  ON public.automation_log_steps
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_automation_log_steps_log_id_created
  ON public.automation_log_steps (log_id, created_at);
CREATE INDEX IF NOT EXISTS idx_automation_log_steps_user_id
  ON public.automation_log_steps (user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_log_steps;
