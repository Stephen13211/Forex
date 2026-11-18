# Gold Hunter AI — demo test and release checklist

1. Install MetaTrader 5 desktop and log in to a Deriv DEMO account only.
2. Confirm account currency. The R10/R30/R90 risk values apply only when account currency is ZAR; convert for another currency.
3. Open the exact Deriv gold symbol. Record contract size, tick size, tick value (profit and loss), volume min/max/step, stop/freeze levels, spread and trading sessions.
4. Compile trading/GoldHunterEA.mq5 in MetaEditor. Do not remove DemoOnly. A compile success is not a strategy validation.
5. Strategy Tester: real ticks where available, variable spread, commission and swaps. Test several market regimes and keep a final untouched out-of-sample period.
6. Record number of trades, expectancy in R, profit factor, maximum equity drawdown, average win/loss, consecutive losses, spread sensitivity and monthly results.
7. Run forward demo for several weeks. Compare intended signal, actual fill, stop distance, risk amount and broker-side SL/TP.
8. Do not connect a live account or raise risk based on a short winning streak.

## Known implementation gaps before live use
The current EA file is an initial prototype and does not yet implement the entire specification: automatic swing-structure classification and non-repainting trendlines; zone map and liquidity sweep detection; quality-score engine; economic calendar blackout with fail-closed behaviour; session/DST handling; robust persistent daily/weekly and consecutive-loss state; partial exits/runner and trailing alternatives; comprehensive multi-position ownership checks; secure remote bridge/authentication/heartbeat; and mobile push alerts. These must be implemented and independently tested before any live use. The app currently displays honest connection placeholders and configuration/reference screens; it does not yet control an EA remotely.
