import type {
  PortfolioSizingResult,
  SectorExposure,
  SizedAllocation,
  SizingCandidate,
  SizingConfig,
} from './types';

export function suggestWeightBoundsForCount(
  count: number,
  mode: 'SATELLITE' | 'FULL'
): { minWeightPct: number; maxWeightPct: number } {
  if (count <= 0) return { minWeightPct: 4, maxWeightPct: 6 };
  if (mode === 'FULL' && count >= 17) {
    return { minWeightPct: 4, maxWeightPct: 6 };
  }
  const eq = 100 / count;
  return {
    minWeightPct: Math.max(2, Math.floor(eq * 0.65 * 10) / 10),
    maxWeightPct: Math.min(25, Math.ceil(eq * 1.45 * 10) / 10),
  };
}

export function iterativeCapWeights(
  rawWeights: number[],
  minWeightPct: number,
  maxWeightPct: number
): { weights: number[]; cappedFlags: boolean[]; flooredFlags: boolean[] } {
  const n = rawWeights.length;
  if (n === 0) return { weights: [], cappedFlags: [], flooredFlags: [] };

  const minW = Math.max(0, minWeightPct);
  const maxW = Math.max(minW, maxWeightPct);

  if (n * maxW < 100 - 1e-6) {
    return {
      weights: rawWeights.map(() => maxW),
      cappedFlags: rawWeights.map(() => true),
      flooredFlags: rawWeights.map(() => false),
    };
  }

  if (n * minW > 100 + 1e-6) {
    const eq = 100 / n;
    return {
      weights: rawWeights.map(() => eq),
      cappedFlags: rawWeights.map(() => false),
      flooredFlags: rawWeights.map(() => true),
    };
  }

  const fixed = new Array<boolean>(n).fill(false);
  const result = new Array<number>(n).fill(0);
  const cappedFlags = new Array<boolean>(n).fill(false);
  const flooredFlags = new Array<boolean>(n).fill(false);

  const rawSum = rawWeights.reduce((acc, w) => acc + (Number.isFinite(w) && w > 0 ? w : 0), 0);
  const baseWeights =
    rawSum > 0
      ? rawWeights.map((w) => ((Number.isFinite(w) && w > 0 ? w : 0) / rawSum) * 100)
      : rawWeights.map(() => 100 / n);

  let remainingTarget = 100;

  for (let iter = 0; iter < n + 4; iter++) {
    let freeRawSum = 0;
    for (let i = 0; i < n; i++) {
      if (!fixed[i]) freeRawSum += baseWeights[i];
    }
    const freeCount = fixed.filter((f) => !f).length;
    if (freeCount === 0) break;

    let anyFixed = false;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      result[i] =
        freeRawSum > 0
          ? (baseWeights[i] / freeRawSum) * remainingTarget
          : remainingTarget / freeCount;
    }

    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      if (result[i] > maxW + 1e-9) {
        result[i] = maxW;
        fixed[i] = true;
        cappedFlags[i] = true;
        remainingTarget -= maxW;
        anyFixed = true;
      } else if (result[i] < minW - 1e-9) {
        result[i] = minW;
        fixed[i] = true;
        flooredFlags[i] = true;
        remainingTarget -= minW;
        anyFixed = true;
      }
    }
    if (!anyFixed) break;
  }

  const currentSum = result.reduce((a, b) => a + b, 0);
  const diff = 100 - currentSum;
  if (Math.abs(diff) > 1e-9) {
    const freeIdx = result.findIndex((_, i) => !fixed[i]);
    if (freeIdx >= 0) {
      result[freeIdx] = Math.max(minW, Math.min(maxW, result[freeIdx] + diff));
    }
  }

  return { weights: result, cappedFlags, flooredFlags };
}

/**
 * 台股反波動率倉位配置演算法：自動換算張（1,000 股）與零股，並檢核電子/半導體產業集中度上限
 */
export function calculatePortfolioSizing(
  candidates: SizingCandidate[],
  config: SizingConfig
): PortfolioSizingResult {
  const warnings: string[] = [];
  const totalCapital =
    Number.isFinite(config.totalActiveCapital) && config.totalActiveCapital > 0
      ? config.totalActiveCapital
      : 0;

  if (candidates.length === 0) {
    return {
      allocations: [],
      sectorExposures: [],
      totalWeightPct: 0,
      totalAllocatedAmount: 0,
      cashReservePct: 100,
      warnings: ['尚未選入任何台股配置標的。'],
    };
  }

  const invVols = candidates.map((c) => {
    const safeVol = Number.isFinite(c.annualizedVolPct) && c.annualizedVolPct > 1 ? c.annualizedVolPct : 25;
    return 1 / safeVol;
  });
  const invVolSum = invVols.reduce((acc, v) => acc + v, 0);
  const rawInverseVolWeightsPct = invVols.map((v) =>
    invVolSum > 0 ? (v / invVolSum) * 100 : 100 / candidates.length
  );

  const { weights: constrainedWeights, cappedFlags, flooredFlags } = iterativeCapWeights(
    rawInverseVolWeightsPct,
    config.minWeightPct,
    config.maxWeightPct
  );

  if (candidates.length * config.maxWeightPct < 100 - 1e-6) {
    warnings.push(
      `候選檔數 (${candidates.length} 檔) × 單股上限 (${config.maxWeightPct}%) = ${(
        candidates.length * config.maxWeightPct
      ).toFixed(1)}% < 100%，剩餘資金保留為新台幣現金；可點擊「依檔數自動微調上限」或新增標的。`
    );
  }

  const sectorCap = Math.max(10, Math.min(100, config.sectorCapPct));
  const sectorUnscaledSums = new Map<string, number>();
  candidates.forEach((c, idx) => {
    sectorUnscaledSums.set(c.sector, (sectorUnscaledSums.get(c.sector) ?? 0) + constrainedWeights[idx]);
  });

  const sectorScaleFactor = new Map<string, number>();
  sectorUnscaledSums.forEach((sumW, sector) => {
    if (sumW > sectorCap + 1e-6) {
      warnings.push(
        `產業集中度警告：「${sector}」合計權重達 ${sumW.toFixed(1)}%，超過上限 ${sectorCap}%（嚴防台股電子/半導體過度集中）！`
      );
      sectorScaleFactor.set(sector, config.applySectorScaling ? sectorCap / sumW : 1);
    } else {
      sectorScaleFactor.set(sector, 1);
    }
  });

  const sectorFinalSums = new Map<string, number>();
  const allocations: SizedAllocation[] = candidates.map((c, idx) => {
    const scale = sectorScaleFactor.get(c.sector) ?? 1;
    const finalWeight = constrainedWeights[idx] * scale;
    sectorFinalSums.set(c.sector, (sectorFinalSums.get(c.sector) ?? 0) + finalWeight);

    const allocatedAmount = Math.round((totalCapital * finalWeight) / 100);
    const safePrice = Number.isFinite(c.price) && c.price > 0 ? c.price : 1;
    const suggestedShares = Math.floor(allocatedAmount / safePrice);
    const twLots = Math.floor(suggestedShares / 1000);
    const twOddShares = suggestedShares % 1000;

    return {
      candidate: c,
      rawInverseVolWeightPct: Number(rawInverseVolWeightsPct[idx].toFixed(2)),
      constrainedWeightPct: Number(constrainedWeights[idx].toFixed(2)),
      finalWeightPct: Number(finalWeight.toFixed(4)),
      allocatedAmount,
      suggestedShares,
      twLots,
      twOddShares,
      isCappedAtMax: cappedFlags[idx],
      isFlooredAtMin: flooredFlags[idx],
      sectorScaledDown: scale < 1,
    };
  });

  const sectorExposures: SectorExposure[] = Array.from(sectorUnscaledSums.entries())
    .map(([sector, unscaled]) => {
      const finalW = sectorFinalSums.get(sector) ?? unscaled;
      return {
        sector,
        unscaledWeightPct: Number(unscaled.toFixed(2)),
        finalWeightPct: Number(finalW.toFixed(2)),
        exceedsCap: unscaled > sectorCap + 1e-6,
        capPct: sectorCap,
      };
    })
    .sort((a, b) => b.finalWeightPct - a.finalWeightPct);

  const totalWeightPct = Number(
    allocations.reduce((acc, a) => acc + a.finalWeightPct, 0).toFixed(4)
  );
  const totalAllocatedAmount = allocations.reduce((acc, a) => acc + a.allocatedAmount, 0);
  const cashReservePct = Number(Math.max(0, 100 - totalWeightPct).toFixed(2));

  return {
    allocations,
    sectorExposures,
    totalWeightPct,
    totalAllocatedAmount,
    cashReservePct,
    warnings,
  };
}
