export type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
export type Direction = "buy" | "sell" | "none";
export type Trend = "bullish" | "bearish" | "sideways" | "unknown";
export type StrategyResult = {
  direction: Direction; score: number; status: "candidate" | "no_trade";
  h4: Trend; h1: Trend; setup: string; confirmation: string;
  entry: number | null; stop: number | null; target: number | null;
  atrM15: number | null; reasons: string[];
};

const finite = (n: number) => Number.isFinite(n);
function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}
function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs = candles.slice(1).map((c, i) => Math.max(
    c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close),
  ));
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function swings(candles: Candle[], side: "high" | "low", wing = 2) {
  const found: { index: number; price: number }[] = [];
  for (let i = wing; i < candles.length - wing; i++) {
    const p = side === "high" ? candles[i].high : candles[i].low;
    let valid = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      const other = side === "high" ? candles[j].high : candles[j].low;
      if (side === "high" ? other >= p : other <= p) { valid = false; break; }
    }
    if (valid) found.push({ index: i, price: p });
  }
  return found;
}
function trend(candles: Candle[]): Trend {
  if (candles.length < 220) return "unknown";
  const closes = candles.map(c => c.close);
  const fast = ema(closes, 50), slow = ema(closes, 200);
  const highs = swings(candles, "high"), lows = swings(candles, "low");
  if (fast === null || slow === null || highs.length < 2 || lows.length < 2) return "unknown";
  const h = highs.slice(-2), l = lows.slice(-2);
  const structureUp = h[1].price > h[0].price && l[1].price > l[0].price;
  const structureDown = h[1].price < h[0].price && l[1].price < l[0].price;
  if (structureUp && fast > slow && closes.at(-1)! > fast) return "bullish";
  if (structureDown && fast < slow && closes.at(-1)! < fast) return "bearish";
  return "sideways";
}
function validCandles(c: Candle[]) {
  return c.length >= 220 && c.every(x => [x.time,x.open,x.high,x.low,x.close].every(finite)
    && x.high >= Math.max(x.open,x.close,x.low) && x.low <= Math.min(x.open,x.close,x.high));
}

/**
 * Conservative deterministic first-pass strategy. This deliberately returns NO TRADE
 * when any timeframe, structure, volatility, or risk prerequisite is missing.
 * News/session/spread and broker contract checks remain external mandatory gates.
 */
export function evaluateGoldSetup(input: {
  h4: Candle[]; h1: Candle[]; m15: Candle[]; m5: Candle[];
  minimumRewardRisk?: number; atrBufferMultiplier?: number;
}): StrategyResult {
  const reasons: string[] = [];
  const noTrade = (h4: Trend, h1: Trend, setup: string, confirmation: string, score = 0): StrategyResult => ({
    direction: "none", score, status: "no_trade", h4, h1, setup, confirmation,
    entry: null, stop: null, target: null, atrM15: null, reasons,
  });
  if (![input.h4,input.h1,input.m15,input.m5].every(validCandles)) {
    reasons.push("Insufficient or invalid OHLC candles; at least 220 bars are required for EMA200.");
    return noTrade("unknown","unknown","unavailable","unavailable");
  }
  const h4 = trend(input.h4), h1 = trend(input.h1);
  if (h4 === "unknown" || h1 === "unknown") { reasons.push("Higher-timeframe trend is not established."); return noTrade(h4,h1,"none","none"); }
  if (h4 !== h1 || h4 === "sideways") { reasons.push("H4 and H1 must agree in a clear directional structure."); return noTrade(h4,h1,"none","none"); }
  const direction: Direction = h4 === "bullish" ? "buy" : "sell";
  const m15 = input.m15, m5 = input.m5;
  const a = atr(m15);
  if (!a || !finite(a) || a <= 0) { reasons.push("M15 ATR is unavailable."); return noTrade(h4,h1,"none","none"); }
  const highs = swings(m15, "high"), lows = swings(m15, "low");
  if (highs.length < 2 || lows.length < 2) { reasons.push("Not enough confirmed M15 swing structure."); return noTrade(h4,h1,"none","none"); }
  const last = m15.at(-1)!, prior = m15.at(-2)!;
  const recentHigh = highs.at(-1)!, recentLow = lows.at(-1)!;
  const ema50 = ema(m15.map(c=>c.close),50)!;
  const pullback = direction === "buy"
    ? last.low <= ema50 + a * 0.25 && last.low >= ema50 - a * 0.75
    : last.high >= ema50 - a * 0.25 && last.high <= ema50 + a * 0.75;
  const trendPivots = direction === "buy" ? lows.slice(-2) : highs.slice(-2);
  const trendline = trendPivots.length === 2
    ? trendPivots[0].price + (trendPivots[1].price - trendPivots[0].price)
      * (m15.length - 1 - trendPivots[0].index) / (trendPivots[1].index - trendPivots[0].index)
    : null;
  const trendlineConfluence = trendline !== null && (direction === "buy"
    ? Math.abs(last.low - trendline) <= a * 0.5
    : Math.abs(last.high - trendline) <= a * 0.5);
  const sweepCutoff = m15.length - 7;
  const priorLiquidityPivot = (direction === "buy" ? lows : highs).filter(p => p.index < sweepCutoff).at(-1);
  const sweepBars = m15.slice(-5);
  const liquiditySweep = !!priorLiquidityPivot && (direction === "buy"
    ? sweepBars.some(c => c.low < priorLiquidityPivot.price && c.close > priorLiquidityPivot.price)
    : sweepBars.some(c => c.high > priorLiquidityPivot.price && c.close < priorLiquidityPivot.price));
  const break = direction === "buy"
    ? last.close > highs.at(-1)!.price && prior.close <= highs.at(-1)!.price
    : last.close < lows.at(-1)!.price && prior.close >= lows.at(-1)!.price;
  if (!pullback) { reasons.push("No qualifying M15 pullback near EMA50."); return noTrade(h4,h1,"no_pullback","waiting",40); }
  if (!trendlineConfluence) { reasons.push("No confirmed trendline confluence at the M15 pullback."); return noTrade(h4,h1,"pullback","waiting_for_trendline",50); }
  if (!liquiditySweep) { reasons.push("No confirmed liquidity sweep and close-back-through at a prior M15 swing."); return noTrade(h4,h1,"pullback","waiting_for_liquidity_sweep",60); }
  if (!break) { reasons.push("No completed M15 close through confirmed local structure."); return noTrade(h4,h1,"sweep","waiting_for_M15_break",70); }
  const m5Last = m5.at(-1)!, m5Prev = m5.at(-2)!;
  const confirmed = direction === "buy"
    ? m5Last.close > m5Prev.high && m5Last.close > m5Last.open
    : m5Last.close < m5Prev.low && m5Last.close < m5Last.open;
  if (!confirmed) { reasons.push("M5 has not confirmed the M15 break."); return noTrade(h4,h1,"M15_break","waiting_for_M5",80); }
  const entry = m5Last.close;
  const buffer = a * (input.atrBufferMultiplier ?? 0.2);
  const stop = direction === "buy" ? recentLow.price - buffer : recentHigh.price + buffer;
  const distance = Math.abs(entry - stop);
  if (!finite(distance) || distance <= 0 || distance > a * 3) {
    reasons.push("Structural stop distance is invalid or exceeds three M15 ATR; no stop adjustment is allowed.");
    return noTrade(h4,h1,"confirmed","confirmed",75);
  }
  const rr = Math.max(2, input.minimumRewardRisk ?? 2);
  const target = direction === "buy" ? entry + distance * rr : entry - distance * rr;
  const score = 100;
  reasons.push("H4/H1 direction aligned, M15 EMA pullback, trendline confluence, liquidity sweep and structure break present, M5 confirmation present.");
  reasons.push("Stop is beyond the latest confirmed M15 swing with an ATR buffer; volume must be sized to the owner's fixed cash-risk cap.");
  reasons.push("External spread, news, session, freshness, account and broker-contract gates must pass before any order.");
  return { direction, score, status:"candidate", h4,h1,setup:"pullback_and_structure_break",confirmation:"m5_close_confirmation",
    entry,stop,target,atrM15:a,reasons };
}

/** Convert a fixed cash-risk cap to broker volume. Round down only; never widen the stop. */
export function sizeVolumeFromCashRisk(input: {
  cashRisk: number; stopDistance: number; tickSize: number; tickValuePerLot: number;
  minVolume: number; maxVolume: number; volumeStep: number;
}) {
  const {cashRisk,stopDistance,tickSize,tickValuePerLot,minVolume,maxVolume,volumeStep}=input;
  if (![cashRisk,stopDistance,tickSize,tickValuePerLot,minVolume,maxVolume,volumeStep].every(finite)
      || cashRisk<=0 || stopDistance<=0 || tickSize<=0 || tickValuePerLot<=0
      || minVolume<=0 || maxVolume<minVolume || volumeStep<=0) {
    return {ok:false as const, reason:"Missing or invalid broker contract or fixed cash-risk inputs."};
  }
  const lossPerLot = stopDistance / tickSize * tickValuePerLot;
  const raw = cashRisk / lossPerLot;
  const volume = Math.floor(Math.min(raw,maxVolume) / volumeStep) * volumeStep;
  if (volume < minVolume) return {ok:false as const, reason:"Broker minimum volume would exceed the configured cash-risk cap."};
  return {ok:true as const, volume, estimatedCashRisk:volume*lossPerLot, lossPerLot};
}
