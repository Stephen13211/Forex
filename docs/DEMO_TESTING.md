# Demo testing checklist

## Compile
Copy trading/GoldHunterEA.mq5 into MetaTrader 5 > File > Open Data Folder > MQL5 > Experts. Open in MetaEditor and compile. Resolve any broker/build-specific warnings before use.

## Demo only
The EA refuses to initialise unless the account is a DEMO account. Do not remove this safeguard for initial testing.

## Inputs
- RiskPerTradeAccountCurrency: 10 only if account currency is ZAR; otherwise use a correctly converted risk amount.
- MaxDailyLossAccountCurrency: 30 (same currency as account).
- MaxWeeklyLossAccountCurrency: 90 (same currency as account).
- MaxSpreadPoints: calibrate against actual broker symbol.
- MinimumRR: 2.0.

## Strategy Tester
Use XAUUSD, M15, every tick based on real ticks where available. Include realistic spread, commission and swap. Test at least 2-3 years if data quality allows. Keep a separate untouched out-of-sample period. A backtest is not a guarantee of future results.

## Known unfinished safeguards
The first EA release is a research prototype. Daily/weekly counters are not persistent after terminal restart; no economic-calendar blackout; no broker-specific stop-distance preflight; no partial close/trailing; no comprehensive multi-position filtering by symbol+magic; and no independent trade-server heartbeat. Do not use on a live account.
