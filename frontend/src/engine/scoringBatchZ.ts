import { evaluateRating } from './ratingAndRegime';
import { evaluateStageZero } from './stageZero';
import type {
  BatchRankedStock,
  DimensionBreakdown,
  MarketRegime,
  StageZeroResult,
  TwStockCandidate,
} from './types';

export function normCdf(z: number): number {
  if (!Number.isFinite(z)) return 0.5;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function meanAndStd(values: number[]): { mean: number; std: number } {
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) return { mean: 0, std: 0 };
  const mean = valid.reduce((acc, v) => acc + v, 0) / valid.length;
  if (valid.length < 2) return { mean, std: 0 };
  const variance =
    valid.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / valid.length;
  return { mean, std: Math.sqrt(variance) };
}

export function computeWinsorizedZScores(
  values: number[],
  higherIsBetter: boolean
): number[] {
  if (values.length === 0) return [];
  const oriented = values.map((v) => {
    const safe = Number.isFinite(v) ? v : 0;
    return higherIsBetter ? safe : -safe;
  });

  const { mean: rawMean, std: rawStd } = meanAndStd(oriented);
  if (rawStd === 0) return oriented.map(() => 50);

  const lowerBound = rawMean - 3 * rawStd;
  const upperBound = rawMean + 3 * rawStd;
  const winsorized = oriented.map((v) => Math.max(lowerBound, Math.min(upperBound, v)));

  const { mean: wMean, std: wStd } = meanAndStd(winsorized);
  if (wStd === 0) return winsorized.map(() => 50);

  return winsorized.map((v) => {
    const z = (v - wMean) / wStd;
    return Number((normCdf(z) * 100).toFixed(2));
  });
}

type BatchSubKeys =
  | 'roicPct'
  | 'gpaPct'
  | 'ocfToNiPct'
  | 'piotroskiRaw'
  | 'evToEbitda'
  | 'fcfYieldPct'
  | 'effectivePe'
  | 'dividendYieldPct'
  | 'mom12m1mSharpe'
  | 'revMomSpread'
  | 'trendSlopeScore';

function extractMetric(stock: TwStockCandidate, key: BatchSubKeys): number {
  switch (key) {
    case 'effectivePe': {
      const pe = stock.forwardPe ?? stock.trailingPe;
      return !Number.isFinite(pe) || pe <= 0 ? 999 : pe;
    }
    case 'evToEbitda':
      return !Number.isFinite(stock.evToEbitda) || stock.evToEbitda <= 0 ? 999 : stock.evToEbitda;
    case 'revMomSpread':
      // 近 3 月累計營收 YoY + (3M YoY - 12M YoY) 動能差
      return stock.rev3mCumYoYPct + (stock.rev3mCumYoYPct - stock.rev12mCumYoYPct) * 0.5;
    default:
      return stock[key];
  }
}

const DIRECTIONS: Record<BatchSubKeys, boolean> = {
  roicPct: true,
  gpaPct: true,
  ocfToNiPct: true,
  piotroskiRaw: true,
  evToEbitda: false,
  fcfYieldPct: true,
  effectivePe: false,
  dividendYieldPct: true,
  mom12m1mSharpe: true,
  revMomSpread: true,
  trendSlopeScore: true,
};

function computePeerSubScores(
  targetId: string,
  peerGroup: TwStockCandidate[]
): Record<BatchSubKeys, number> {
  const idx = peerGroup.findIndex((s) => s.id === targetId);
  const res = {} as Record<BatchSubKeys, number>;
  (Object.keys(DIRECTIONS) as BatchSubKeys[]).forEach((key) => {
    const arr = peerGroup.map((s) => extractMetric(s, key));
    const scores = computeWinsorizedZScores(arr, DIRECTIONS[key]);
    res[key] = idx >= 0 ? scores[idx] : 50;
  });
  return res;
}

/**
 * 階段一（模式 B）：台股同產業 Winsorize Z-Score 批次排名引擎
 */
export function rankBatchWithZScore(
  candidates: TwStockCandidate[],
  regime: MarketRegime
): BatchRankedStock[] {
  const stageZeroMap = new Map<string, StageZeroResult>();
  const passedStocks: TwStockCandidate[] = [];

  for (const c of candidates) {
    const sz = evaluateStageZero(c.stageZeroInput, c.recommendedProfile);
    stageZeroMap.set(c.id, sz);
    if (sz.passed) passedStocks.push(c);
  }

  const sectorGroups = new Map<string, TwStockCandidate[]>();
  for (const s of passedStocks) {
    const list = sectorGroups.get(s.sector) ?? [];
    list.push(s);
    sectorGroups.set(s.sector, list);
  }

  const ranked: BatchRankedStock[] = candidates.map((stock) => {
    const stageZero = stageZeroMap.get(stock.id)!;

    if (!stageZero.passed) {
      const zeroBreakdown: DimensionBreakdown = {
        sQ: 0,
        sV: 0,
        sM: 0,
        piotroskiRaw: stock.piotroskiRaw,
      };
      return {
        stock,
        stageZero,
        rating: evaluateRating({ breakdown: zeroBreakdown, regime, stageZero }),
        breakdown: zeroBreakdown,
        sectorSampleCount: 0,
        fallbackToMarketPool: false,
        subScoresPct: {
          roic: 0,
          gpa: 0,
          ocfNi: 0,
          piotroski: 0,
          evMultiple: 0,
          fcfYield: 0,
          pe: 0,
          divYield: 0,
          priceMom: 0,
          fundMom: 0,
          trend: 0,
        },
        marketRank: 0,
      };
    }

    const sectorPeers = sectorGroups.get(stock.sector) ?? [];
    const fallbackToMarketPool = sectorPeers.length < 3;
    const peerPool = fallbackToMarketPool ? passedStocks : sectorPeers;
    const sub = computePeerSubScores(stock.id, peerPool);

    const sQ = Number(
      (
        (sub.roicPct / 100) * 12 +
        (sub.gpaPct / 100) * 10 +
        (sub.ocfToNiPct / 100) * 10 +
        (sub.piotroskiRaw / 100) * 8
      ).toFixed(2)
    );
    const sV = Number(
      (
        (sub.evToEbitda / 100) * 15 +
        (sub.fcfYieldPct / 100) * 12 +
        (sub.effectivePe / 100) * 4 +
        (sub.dividendYieldPct / 100) * 4
      ).toFixed(2)
    );
    const sM = Number(
      (
        (sub.mom12m1mSharpe / 100) * 10 +
        (sub.revMomSpread / 100) * 10 +
        (sub.trendSlopeScore / 100) * 5
      ).toFixed(2)
    );

    const breakdown: DimensionBreakdown = {
      sQ,
      sV,
      sM,
      piotroskiRaw: stock.piotroskiRaw,
    };

    return {
      stock,
      stageZero,
      rating: evaluateRating({ breakdown, regime, stageZero }),
      breakdown,
      sectorSampleCount: sectorPeers.length,
      fallbackToMarketPool,
      subScoresPct: {
        roic: sub.roicPct,
        gpa: sub.gpaPct,
        ocfNi: sub.ocfToNiPct,
        piotroski: sub.piotroskiRaw,
        evMultiple: sub.evToEbitda,
        fcfYield: sub.fcfYieldPct,
        pe: sub.effectivePe,
        divYield: sub.dividendYieldPct,
        priceMom: sub.mom12m1mSharpe,
        fundMom: sub.revMomSpread,
        trend: sub.trendSlopeScore,
      },
      marketRank: 0,
    };
  });

  const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };
  ranked.sort((a, b) => {
    const gDiff = gradeOrder[a.rating.finalGrade] - gradeOrder[b.rating.finalGrade];
    if (gDiff !== 0) return gDiff;
    return b.rating.finalScore - a.rating.finalScore;
  });
  ranked.forEach((item, i) => {
    item.marketRank = i + 1;
  });
  return ranked;
}
