-- Permit explicit user opt-in for the demo bot. Default remains OFF.
alter table public.risk_settings
  drop constraint if exists risk_settings_trading_enabled_check;
alter table public.risk_settings
  add constraint risk_settings_trading_enabled_check check (trading_enabled in (true,false));
alter table public.risk_settings alter column trading_enabled set default false;

-- The bot remains disabled until the owner explicitly enables bot_settings.bot_enabled
-- AND risk_settings.trading_enabled after configuring fixed cash limits.
comment on column public.risk_settings.trading_enabled is
  'Explicit user opt-in to automated DEMO trading only. Defaults false; server enforces demo account and cash risk limits.';
