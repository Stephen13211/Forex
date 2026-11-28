-- Gold Hunter AI: let each user select the XAUUSD position size in lots.
-- Daily and weekly cash-loss columns are retained for backwards compatibility,
-- but the auto-trader no longer uses them to block entries.
alter table public.risk_settings
  add column if not exists lot_size numeric(12,4) not null default 0.01
  check (lot_size > 0);

comment on column public.risk_settings.lot_size is
  'User-selected XAUUSD position size in lots. The strategy stop is determined by market structure, not adjusted to fit this size.';
