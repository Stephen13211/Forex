# Gold Hunter AI

Charcoal-and-gold Android app for a Deriv MT5 XAUUSD demo-trading workflow.

## Included
- Expo React Native app with Home, Chart, Strategy, Risk, History, MT5 and Profile tabs.
- Supabase email/password sign-in, registration, session persistence and password-reset email request.
- Supabase client configured for the separate Gold Hunter AI project.
- Initial PostgreSQL schema and row-level security policies in `supabase/setup.sql`.
- Multi-timeframe strategy specification in `docs/COMPLETE_STRATEGY.md`.
- Initial MQL5 Expert Advisor prototype in `trading/GoldHunterEA.mq5`.
- GitHub Actions workflow to type-check, export Android JS bundle, and build an installable debug APK.

## Android APK
1. Open the repository's **Actions** tab.
2. Select **Gold Hunter AI Android APK**.
3. Wait for the push-triggered workflow to finish (or use **Run workflow**).
4. Open the successful run and download the `gold-hunter-ai-android-debug` artifact.
5. Extract the ZIP and install `app-debug.apk` on Android. Allow installation from the browser/file manager if prompted.

This is a debug/testing APK, not a Play Store release. An APK exists only after the workflow succeeds and uploads the artifact.

## Supabase setup
Follow [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) and run [supabase/setup.sql](supabase/setup.sql) in the SQL Editor of the Gold Hunter AI Supabase project.

## Current trading readiness — read before use
- Broker: Deriv only. Trading mode: demo only.
- The mobile app does not yet place or remotely control trades.
- The EA is a prototype and has not been compiled or validated in MetaEditor in this environment.
- Full swing-structure/trendline/zone/sweep scoring, economic-calendar blackout, DST-aware session filtering, persistent loss state and secure remote bridge still require implementation and testing.
- Never connect a live account or assume profitability. Validate on historical data and forward demo first.

## Agreed initial demo limits
R10 risk per trade, R30 daily loss stop, R90 weekly loss stop, max 2 entries/day, max 1 open position, stop after 2 consecutive losses and minimum 1:2 reward:risk. These amounts apply only to a ZAR account and are not yet enforced by the mobile UI. The EA must verify account currency and actual broker contract/tick/volume specifications, and skip if risk cannot be calculated safely.
