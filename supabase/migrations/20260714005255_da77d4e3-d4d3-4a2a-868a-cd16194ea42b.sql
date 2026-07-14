
-- automation_logs: owner-scoped write policies
CREATE POLICY "Users can insert their own logs"
  ON public.automation_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own logs"
  ON public.automation_logs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own logs"
  ON public.automation_logs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- automation_log_steps: owner-scoped write policies
CREATE POLICY "Users can insert their own log steps"
  ON public.automation_log_steps FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own log steps"
  ON public.automation_log_steps FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own log steps"
  ON public.automation_log_steps FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- profiles: explicit self-insert policy
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
