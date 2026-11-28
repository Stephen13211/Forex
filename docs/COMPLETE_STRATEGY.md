# Gold Hunter AI — Complete strategy ruleset (research specification)

## Market and hierarchy
Instrument: Deriv cTrader gold CFD symbol (verify exact symbol, often XAUUSD or broker-specific suffix). Primary execution chart M15. H4 is the broad regime, H1 confirms it, M15 creates the setup, M5 confirms entry. If H4 and H1 disagree, the only valid signal is NO TRADE.

## Direction
Bullish regime requires H4 and H1 bullish structure (higher highs/higher lows) with EMA50 above EMA200 and price behaviour consistent with that direction. Bearish regime is the inverse (lower lows/lower highs; EMA50 below EMA200). EMAs support structure; they are not a standalone signal. Sideways, compressed, unclear, late-stage or reversal conditions are filtered out.

## Zones and trendlines
Build zones from confirmed H4/H1 swing highs/lows, previous day and week high/low, repeated reactions, polarity flips, Asian session high/low and relevant session extremes. Use configurable zone width based on ATR/spread; never imply a level is exact to a single tick. Trendlines connect at least two confirmed swing highs (descending) or swing lows (ascending); a third touch strengthens confluence. Extend only after swings are confirmed. Invalidate a line after a decisive close through it and do not repaint historical signals.

## Setup sequence
1. H4/H1 agree in direction and structure.
2. M15 retraces against the trend toward a valid zone, trendline, EMA50 or VWAP confluence.
3. Observe weakening countertrend pressure. A wick alone is not sufficient.
4. Optional liquidity-sweep confirmation: price takes a known recent swing/session high or low and closes back inside the range; do not label every wick a sweep.
5. M15 closes through the relevant local structure level in trend direction (BOS/CHOCH context must be explicit).
6. M5 confirms direction, preferably with a retest/hold; no chasing an extended candle.
7. Confirm target room and minimum 2R after spread, commission and expected slippage.
8. Convert the owner's selected lot size using the broker's contract size and volume min/max/step. Do not resize the chosen lot or move the structural stop; estimate and log the cash loss implied by the stop distance and selected size.

## Quality score (initial heuristic, not a probability)
H4/H1 alignment 20; H1 structure 10; M15 pullback into zone 15; trendline confluence 10; liquidity sweep 10; M15 structure break 15; M5 confirmation 10; reward/risk and room to target 10. Minimum 80/100. Do not double-count correlated features. A high score never overrides a mandatory risk, spread, news, data-freshness or trend-alignment gate.

## Risk limits for demo validation
The owner chooses a fixed lot size. Convert it using the actual broker contract size and volume minimum/maximum/step. Never move the structural stop to fit lot size; estimate and log the cash loss implied by the selected size and stop distance. No arbitrary daily trade-count cap or daily/weekly cash-loss caps. Take valid setups subject to one open position at a time and a pause after three consecutive losses in a South African trading day. No martingale, grid, averaging down, recovery trades or increasing size after losses. Never force trades to meet a daily money target. Minimum initial R:R 1:2.

## Trade management variants to compare, not assume profitable
Backtest separately: (A) fixed 2R exit; (B) partial at 2R with runner toward next opposing zone; (C) structure/ATR trailing. Only move stop to breakeven after confirmed favourable movement and costs are accounted for. Do not select a variant from a tiny sample.

## Filters
- London and New York session windows using broker-server time and daylight-saving-aware conversion.
- Max spread and spread-expansion guard; calibrate points to actual symbol.
- ATR volatility floor/ceiling; avoid dead markets and abnormal spikes.
- Avoid entry too close to opposing H1/H4 zones.
- High-impact USD calendar blocks: CPI/Core CPI, PCE/Core PCE, NFP, unemployment, FOMC rate decision/statement/press conference, major Fed speeches, GDP. Initial blackout: 30 min before/after standard events; NFP 30 before/45 after; FOMC 45 before/60 after. If calendar feed is unavailable/stale, block new trades. Cancel pending entries in blackout; do not automatically close an open trade solely because news is approaching.
- Reject stale ticks, missing candles, invalid indicator buffers, disconnected bridge, duplicate signal/order IDs and any state uncertainty.

## Execution and outage behaviour
Every position must be opened with broker-side SL and TP. Existing protective orders remain at broker if app/backend/internet disconnects. No new entries if bridge heartbeat, auth, price feed, calendar or risk state is stale. EA must independently enforce risk limits; backend/UI limits are not the authority.

## Validation
Use Deriv MT5 DEMO and real-tick backtests with variable spread, commission, swaps and slippage assumptions. Use in-sample development and untouched out-of-sample validation; then multi-week forward demo. Report trade count, expectancy in R, profit factor, max drawdown, average win/loss, consecutive losses, spread sensitivity and monthly breakdown. A backtest does not guarantee future performance. The R100/day aspiration on R1,000 is 10% daily and is not a safe or dependable target.
