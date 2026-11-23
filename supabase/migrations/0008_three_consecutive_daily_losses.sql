-- Gold Hunter AI: pause after three consecutive losing trades in one
-- South African trading day. Daily/weekly cash-loss limits remain independent.
alter table public.risk_settings
  alter column max_consecutive_losses set default 3;

alter table public.risk_settings
  drop constraint if exists risk_settings_max_consecutive_losses_check;

update public.risk_settings
set max_consecutive_losses = 3,
    updated_at = now();

alter table public.risk_settings
  add constraint risk_settings_max_consecutive_losses_check
  check (max_consecutive_losses = 3);
