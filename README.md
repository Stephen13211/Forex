# Gold Hunter AI

A charcoal-and-gold Android XAUUSD trading companion built with Expo React Native and TypeScript.

## Current stage
Demo-only mobile app foundation. MT5 is NOT CONNECTED and the bot remains STOPPED until a real, authenticated Deriv MT5 demo bridge is implemented and verified.

## Planned stack
- Expo React Native + TypeScript + Expo Router
- Separate Gold Hunter AI Supabase project (to be created later)
- Supabase Auth, PostgreSQL and Edge Functions
- MQL5 Expert Advisor / Deriv MT5 demo bridge (later phase)

## Safety defaults
- Demo only; no live order execution
- Never invent broker balances, prices or profits
- Initial risk settings: R10 per trade, R30 daily loss, R90 weekly loss
- Maximum 2 entries per day, 1 open position, stop after 2 consecutive losses
- No martingale, grid, averaging down or recovery sizing

These are planned settings only; they are not active execution controls yet.