ALTER TABLE public.automation_logs
  ADD COLUMN IF NOT EXISTS external_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_logs_unique_external_event
  ON public.automation_logs (user_id, event_type, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.increment_automation_counter(
  p_automation_id uuid,
  p_counter text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_counter NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'Invalid automation counter: %', p_counter
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.automations
  SET
    total_sent = total_sent + CASE WHEN p_counter = 'sent' THEN 1 ELSE 0 END,
    total_failed = total_failed + CASE WHEN p_counter = 'failed' THEN 1 ELSE 0 END
  WHERE id = p_automation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation not found: %', p_automation_id
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_automation_counter(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_automation_counter(uuid, text)
  TO service_role;
