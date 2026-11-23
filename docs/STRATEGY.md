# Gold Hunter AI — cTrader strategy specification

## Intended test market
XAUUSD gold CFD on a Deriv **cTrader DEMO** account. Resolve the exact broker symbol and verify its contract specifications before sizing or execution.

## Timeframe hierarchy
- H4: broad trend and market structure.
- H1: confirmation. If H4 and H1 disagree, no trade.
- M15: pullback, setup and closed-candle structure break.
- M5: entry confirmation.

## Direction and entry
Bullish structure requires higher highs and higher lows on H4 and H1; bearish structure requires lower highs and lower lows. EMA50/EMA200 alignment is supporting evidence, not a replacement for structure. M15 must form a valid pullback and close through the relevant local structure in the higher-timeframe direction. M5 must confirm before entry. Sideways, unclear, stale or overextended conditions mean NO TRADE.

## Structural stop and sizing
- BUY: stop below the confirmed previous swing low, with a volatility/ATR buffer.
- SELL: stop above the confirmed previous swing high, with a volatility/ATR buffer.
- Stop price is determined by market structure first and is never moved to accommodate volume.
- Size from a fixed cash-risk amount in the actual cTrader account currency, using the broker's tick size/value, contract size, volume minimum/maximum/step and stop distance.
- Round volume down. If minimum permitted volume exceeds the configured cash-risk limit, skip the trade.
- No percentage-based sizing, martingale, grid, averaging down or recovery trades.

## Risk gates
No arbitrary daily trade-count cap. Take valid setups only, with one open position maximum, a pause after two consecutive losses, and owner-configured daily/weekly cash-loss safeguards. Do not assume R10/R30/R90 or any other cash amount until explicitly configured in the correct account currency. Initial minimum reward:risk is 1:2 after expected costs.

## Test protocol
1. Use Deriv cTrader DEMO only.
2. Verify exact gold symbol metadata and fresh price/candle data.
3. Backtest with realistic spread, commission, swaps and slippage where data permits; preserve untouched out-of-sample data.
4. Record trade count, expectancy in R, profit factor, maximum drawdown, average win/loss, consecutive losses, spread sensitivity and monthly results.
5. Forward-test for several weeks and verify every order's actual fill, cash risk and broker-side SL/TP.
6. Never infer future profitability from a small backtest or short winning streak.
