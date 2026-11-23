import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateGoldSetup, sizeVolumeFromCashRisk, type Candle } from "./strategy.ts";

function flatCandles(count: number): Candle[] {
  return Array.from({length:count},(_,i)=>({time:i*900000,open:2000,high:2001,low:1999,close:2000,volume:1}));
}

Deno.test("strategy refuses incomplete candle history", () => {
  const candles = flatCandles(80);
  const result = evaluateGoldSetup({h4:candles,h1:candles,m15:candles,m5:candles});
  assertEquals(result.direction,"none");
  assertEquals(result.status,"no_trade");
});

Deno.test("fixed cash sizing rounds volume down to broker step", () => {
  const result = sizeVolumeFromCashRisk({
    cashRisk:100, stopDistance:10, tickSize:1, tickValuePerLot:10,
    minVolume:0.01, maxVolume:10, volumeStep:0.01,
  });
  if (!result.ok) throw new Error(result.reason);
  assertEquals(result.volume,1);
  assertEquals(result.estimatedCashRisk,100);
});

Deno.test("fixed cash sizing skips when minimum lot exceeds risk cap", () => {
  const result = sizeVolumeFromCashRisk({
    cashRisk:5, stopDistance:10, tickSize:1, tickValuePerLot:10,
    minVolume:0.1, maxVolume:10, volumeStep:0.1,
  });
  assertEquals(result.ok,false);
});
