# Gold Hunter AI — strategy specification

## Intended test market
XAUUSD on Deriv MT5 demo. Attach the EA to the broker's exact gold symbol chart; symbol suffixes are supported by using _Symbol. Verify contract specifications first.

## Timeframe hierarchy
- H4: broad trend.
- H1: confirmation. If H4 and H1 disagree, no trade.
- M15: pullback and closed-candle break setup.
- M5: directional confirmation.

## Direction and entry
Bullish: H4/H1 EMA50 above EMA200; M15/M5 EMA alignment bullish; M15 pulls back toward EMA50, then a closed bullish candle breaks the prior M15 candle high; M5 candle bullish.
Bearish: inverse conditions. The EA uses closed candles for signal confirmation.

## Risk gates
Default risk input is 10 in account currency. Only use 10 if the demo account is denominated in ZAR. Daily loss 30, weekly loss 90, 2 entries/day, stop after 2 consecutive losing exits, one open account position, 2R target, no martingale/grid/recovery sizing. Lot size is calculated from the live symbol tick size/value and rounded down to broker volume step. If minimum volume exceeds risk budget, skip.

## Important limitations in v1
This is an initial executable ruleset, not a validated profitable strategy. EMA alignment is a simple trend proxy; the EA does not yet implement discretionary swing-structure classification, automatic trendline drawing, liquidity-sweep scoring, economic-calendar news blocking, partial exits, or robust persistent loss counters across terminal restarts. The daily/weekly equity baselines and counters are in-memory and reset on EA restart; test with this limitation understood. Max spread is in broker points and must be calibrated for the exact XAUUSD symbol.

## Test protocol
1. Use a Deriv MT5 DEMO account only.
2. Open XAUUSD (or broker's exact gold symbol), timeframe M15, and attach EA.
3. Confirm account currency, symbol tick size/value, contract size, minimum volume, volume step, spread and stop-level constraints.
4. Strategy Tester: real ticks if available, variable spread, commissions and swaps enabled; cover multiple market regimes.
5. Optimise only on an in-sample period, then test untouched out-of-sample data. Record trades, net profit, max drawdown, profit factor, expectancy, average R, consecutive losses, spread sensitivity and trade count.
6. Run demo forward test for several weeks. Do not connect a live account or increase risk because of a short winning streak.
