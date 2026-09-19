ALTER TABLE public.automations ALTER COLUMN delayed_delay_minutes SET DEFAULT 1380;
UPDATE public.automations SET delayed_delay_minutes = 1380 WHERE delayed_delay_minutes = 1440;