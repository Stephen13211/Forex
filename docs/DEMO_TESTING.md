# Gold Hunter AI — cTrader demo test and release checklist

1. Create or sign in to a Deriv **cTrader DEMO** account. Do not use Deriv MT5 or Deriv Trader for this integration.
2. Authorise Gold Hunter AI through the approved cTrader Open API application. Keep the client secret and OAuth tokens on the trusted backend only.
3. Confirm account currency and resolve the exact broker gold symbol (XAUUSD or a broker-specific name).
4. Read the symbol's tick size, tick value, contract size, minimum/maximum volume, volume step, stop-distance rules, spread and trading sessions from cTrader. Never assume generic gold contract values.
5. Confirm live demo quotes and historical candles are timestamped and fresh. Block new entries if the feed is stale or disconnected.
6. Test order submission on demo with a structural swing stop and take-profit attached at the broker. Re-read the position from cTrader and verify the exact broker-side SL/TP before considering the order protected.
7. Verify cash-risk sizing from stop distance and broker metadata. If the broker minimum volume exceeds the configured cash-risk cap, skip the trade; never move the stop to fit the lot.
8. Test reconnects, expired OAuth tokens, duplicate order prevention, rejected orders, partial fills, manual closes, stop-outs and backend restarts.
9. Forward-test for several weeks. Record signal, intended and actual fill, stop distance, risk in account currency, slippage, costs, broker-side protection and result.
10. Do not connect a live account or raise risk based on a short winning streak.

## Known implementation gaps before live use

The Android app currently provides the interface and Supabase authentication. The secure cTrader OAuth callback/token service, persistent market-data connection, candle aggregation, complete strategy engine, order execution, broker-side protective-order verification, reconnect handling, and reliable app/backend status synchronisation still need implementation and testing. An APK build or successful database setup does not mean the bot can trade.

The full strategy also requires independently validated swing-structure classification, non-repainting trendlines, zone mapping, liquidity sweep detection, quality scoring, economic-calendar blackout with fail-closed behaviour, DST-aware session handling, and persistent daily/weekly/consecutive-loss state.
