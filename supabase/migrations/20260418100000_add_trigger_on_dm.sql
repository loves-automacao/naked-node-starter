-- Permite que uma automação também dispare quando o usuário manda DM diretamente
-- (inclui story replies/reactions, que caem como DM comum no inbox)
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS trigger_on_dm boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.automations.trigger_on_dm IS
  'Quando true, dispara também em message.received (inclui story replies).';
