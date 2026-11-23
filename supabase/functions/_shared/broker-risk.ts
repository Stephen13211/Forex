export type XauUsdCommissionInput = {
  volumeProtocol: number;
  entryPrice: number;
  lotSizeProtocol: number;
  accountCurrency: string;
  quoteCurrency: string;
  commissionType: number | null;
  preciseTradingCommissionRate: number | null;
  preciseMinCommission: number | null;
  minCommissionType: number | null;
  minCommissionAsset: string | null;
};

export type CommissionEstimate =
  | { ok: true; roundTurn: number; perSide: number; lots: number; }
  | { ok: false; reason: string; };

/**
 * Conservative round-turn estimate for XAUUSD on a USD-denominated account.
 * cTrader volume and lotSize are both protocol cents (1/100 of a unit).
 * Unsupported commission models or currencies fail closed.
 */
export function estimateXauUsdRoundTurnCommission(input: XauUsdCommissionInput): CommissionEstimate {
  const {
    volumeProtocol, entryPrice, lotSizeProtocol, accountCurrency, quoteCurrency,
    commissionType, preciseTradingCommissionRate, preciseMinCommission,
    minCommissionType, minCommissionAsset,
  } = input;
  if (![volumeProtocol, entryPrice, lotSizeProtocol].every(Number.isFinite)
      || volumeProtocol <= 0 || entryPrice <= 0 || lotSizeProtocol <= 0) {
    return { ok: false, reason: "Invalid XAUUSD volume, entry price or lot-size metadata." };
  }
  if (accountCurrency.toUpperCase() !== "USD" || quoteCurrency.toUpperCase() !== "USD") {
    return { ok: false, reason: "Automatic cash-risk sizing currently requires both XAUUSD quote currency and account deposit currency to be USD." };
  }
  if (preciseTradingCommissionRate === null || !Number.isFinite(preciseTradingCommissionRate)
      || preciseTradingCommissionRate < 0) {
    return { ok: false, reason: "cTrader did not provide a valid precise trading-commission rate." };
  }

  const units = volumeProtocol / 100;
  const lots = volumeProtocol / lotSizeProtocol;
  const rate = preciseTradingCommissionRate / 1e8;
  let calculatedPerSide = 0;

  if (rate > 0) {
    if (commissionType === 1) {
      // USD per million USD notional traded.
      calculatedPerSide = (units * entryPrice / 1_000_000) * rate;
    } else if (commissionType === 2 || commissionType === 4) {
      // USD per lot or quote-currency (USD for XAUUSD) per lot.
      calculatedPerSide = lots * rate;
    } else {
      return { ok: false, reason: "This broker commission type is not yet supported by the verified XAUUSD cash-risk calculator." };
    }
  }

  const minFee = preciseMinCommission === null ? 0 : preciseMinCommission / 1e8;
  if (!Number.isFinite(minFee) || minFee < 0) {
    return { ok: false, reason: "cTrader minimum-commission metadata is invalid." };
  }
  if (minFee > 0) {
    const asset = String(minCommissionAsset ?? "").toUpperCase();
    const supportedAsset = asset === "USD" &&
      (minCommissionType === 1 || minCommissionType === 2);
    if (!supportedAsset) {
      return { ok: false, reason: "The broker minimum commission currency/type cannot be safely converted to the account currency." };
    }
  }

  const perSide = Math.max(calculatedPerSide, minFee);
  const roundTurn = perSide * 2;
  if (!Number.isFinite(roundTurn) || roundTurn < 0) {
    return { ok: false, reason: "The broker commission estimate is not finite." };
  }
  return { ok: true, roundTurn, perSide, lots };
}

/** Find the largest broker step that keeps stop-loss loss plus round-turn fees under the cash cap. */
export function sizeXauUsdVolumeWithFees(input: {
  cashRisk: number;
  stopDistance: number;
  entryPrice: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  lotSizeProtocol: number;
  commissionType: number | null;
  preciseTradingCommissionRate: number | null;
  preciseMinCommission: number | null;
  minCommissionType: number | null;
  minCommissionAsset: string | null;
  accountCurrency: string;
  quoteCurrency: string;
}) {
  const { cashRisk, stopDistance, entryPrice, minVolume, maxVolume, volumeStep, lotSizeProtocol } = input;
  if (![cashRisk, stopDistance, entryPrice, minVolume, maxVolume, volumeStep, lotSizeProtocol].every(Number.isFinite)
      || cashRisk <= 0 || stopDistance <= 0 || entryPrice <= 0 || minVolume <= 0
      || maxVolume < minVolume || volumeStep <= 0 || lotSizeProtocol <= 0) {
    return { ok: false as const, reason: "Missing or invalid broker contract or fixed cash-risk inputs." };
  }
  const firstStep = Math.ceil(minVolume / volumeStep - 1e-9);
  const lastStep = Math.floor(maxVolume / volumeStep + 1e-9);
  const estimate = (step: number) => {
    const volume = step * volumeStep;
    const commission = estimateXauUsdRoundTurnCommission({
      volumeProtocol: volume,
      entryPrice,
      lotSizeProtocol,
      accountCurrency: input.accountCurrency,
      quoteCurrency: input.quoteCurrency,
      commissionType: input.commissionType,
      preciseTradingCommissionRate: input.preciseTradingCommissionRate,
      preciseMinCommission: input.preciseMinCommission,
      minCommissionType: input.minCommissionType,
      minCommissionAsset: input.minCommissionAsset,
    });
    if (!commission.ok) return { ok: false as const, reason: commission.reason, volume, totalRisk: Number.POSITIVE_INFINITY };
    const priceRisk = stopDistance * (volume / 100);
    return { ok: true as const, volume, priceRisk, commission: commission.roundTurn, totalRisk: priceRisk + commission.roundTurn };
  };

  const minimum = estimate(firstStep);
  if (!minimum.ok) return { ok: false as const, reason: minimum.reason };
  if (minimum.totalRisk > cashRisk + 1e-8) {
    return { ok: false as const, reason: "Broker minimum volume plus estimated round-turn commission exceeds the fixed cash-risk cap." };
  }

  let low = firstStep, high = lastStep, best = minimum;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = estimate(mid);
    if (candidate.ok && candidate.totalRisk <= cashRisk + 1e-8) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (!best.ok) return { ok: false as const, reason: "No valid broker volume fits the cash-risk cap." };
  return {
    ok: true as const,
    volume: best.volume,
    estimatedPriceRisk: best.priceRisk,
    estimatedRoundTurnCommission: best.commission,
    estimatedTotalRisk: best.totalRisk,
    lots: best.volume / lotSizeProtocol,
  };
}
