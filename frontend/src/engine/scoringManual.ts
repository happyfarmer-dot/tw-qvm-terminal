import type { DimensionBreakdown, ManualScorecardInput, PiotroskiChecks } from './types';

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function calculatePiotroskiScore(checks: PiotroskiChecks): {
  rawScore: number;
  mappedQ4Score: number;
} {
  const rawScore = [
    checks.positiveRoa,
    checks.roaImproving,
    checks.positiveOcf,
    checks.ocfGreaterThanNetIncome,
    checks.lowerLongTermDebtRatio,
    checks.higherCurrentRatio,
    checks.noShareDilution,
    checks.higherGrossMargin,
    checks.higherAssetTurnover,
  ].filter(Boolean).length;

  let mappedQ4Score = 0;
  if (rawScore >= 8) {
    mappedQ4Score = 8;
  } else if (rawScore === 7) {
    mappedQ4Score = 6;
  } else if (rawScore === 6) {
    mappedQ4Score = 5;
  } else if (rawScore >= 4) {
    mappedQ4Score = 2;
  } else if (rawScore >= 2) {
    mappedQ4Score = 1;
  } else {
    mappedQ4Score = 0;
  }

  return { rawScore, mappedQ4Score };
}

export function scoreManualCard(input: ManualScorecardInput): DimensionBreakdown {
  const { rawScore, mappedQ4Score } = calculatePiotroskiScore(input.piotroskiChecks);

  const q1 = clamp(input.q1RoicScore, 0, 12);
  const q2 = clamp(input.q2GpaScore, 0, 10);
  const q3 = clamp(input.q3OcfNiScore, 0, 10);
  const sQ = Number(clamp(q1 + q2 + q3 + mappedQ4Score, 0, 40).toFixed(2));

  const v1 = clamp(input.v1EvMultipleScore, 0, 15);
  const v2 = clamp(input.v2FcfEvScore, 0, 12);
  const v3 = clamp(input.v3DivAndPeScore, 0, 8);
  const sV = Number(clamp(v1 + v2 + v3, 0, 35).toFixed(2));

  const m1 = clamp(input.m1PriceMomScore, 0, 10);
  const m2 = clamp(input.m2FundMomScore, 0, 10);
  const m3 = clamp(input.m3TrendFilterScore, 0, 5);
  const sM = Number(clamp(m1 + m2 + m3, 0, 25).toFixed(2));

  return {
    sQ,
    sV,
    sM,
    piotroskiRaw: rawScore,
    q4Mapped: mappedQ4Score,
  };
}
