import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateGoldSetup, sizeVolumeFromCashRisk, type Candle } from "./strategy.ts";
import { estimateXauUsdRoundTurnCommission, sizeXauUsdVolumeWithFees } from "./broker-risk.ts";

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


Deno.test("XAUUSD USD-per-lot commission is included round turn", () => {
  const result = estimateXauUsdRoundTurnCommission({
    volumeProtocol:1000, entryPrice:3000, lotSizeProtocol:10000,
    accountCurrency:"USD", quoteCurrency:"USD", commissionType:2,
    preciseTradingCommissionRate:100000000, preciseMinCommission:0,
    minCommissionType:null, minCommissionAsset:null,
  });
  if (!result.ok) throw new Error(result.reason);
  assertEquals(result.lots,0.1);
  assertEquals(result.roundTurn,0.2);
});

Deno.test("XAUUSD minimum commission is applied on both sides", () => {
  const result = estimateXauUsdRoundTurnCommission({
    volumeProtocol:100, entryPrice:3000, lotSizeProtocol:10000,
    accountCurrency:"USD", quoteCurrency:"USD", commissionType:2,
    preciseTradingCommissionRate:1000000, preciseMinCommission:50000000,
    minCommissionType:1, minCommissionAsset:"USD",
  });
  if (!result.ok) throw new Error(result.reason);
  assertEquals(result.roundTurn,1);
});

Deno.test("XAUUSD commission-aware sizing stays inside the fixed cash cap", () => {
  const result = sizeXauUsdVolumeWithFees({
    cashRisk:11, stopDistance:1, entryPrice:3000, minVolume:100,
    maxVolume:10000, volumeStep:100, lotSizeProtocol:10000,
    accountCurrency:"USD", quoteCurrency:"USD", commissionType:2,
    preciseTradingCommissionRate:100000000, preciseMinCommission:0,
    minCommissionType:null, minCommissionAsset:null,
  });
  if (!result.ok) throw new Error(result.reason);
  if (result.estimatedTotalRisk > 11) throw new Error("Calculated risk exceeded the cash cap.");
  assertEquals(result.volume,1000);
});

Deno.test("Unsupported commission currency fails closed", () => {
  const result = estimateXauUsdRoundTurnCommission({
    volumeProtocol:1000, entryPrice:3000, lotSizeProtocol:10000,
    accountCurrency:"ZAR", quoteCurrency:"USD", commissionType:2,
    preciseTradingCommissionRate:100000000, preciseMinCommission:0,
    minCommissionType:null, minCommissionAsset:null,
  });
  assertEquals(result.ok,false);
});
