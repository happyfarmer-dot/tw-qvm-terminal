import { getBaseGradeFromScore, getFirstTranchePct } from './ratingAndRegime';
import type {
  CyclicalBreakdown,
  CyclicalMetrics,
  CyclicalRatingResult,
  CyclicalRegimeWeights,
  Grade,
  MarketRegime,
  StageZeroResult,
} from './types';

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function getCyclicalRegimeWeights(regime: MarketRegime): CyclicalRegimeWeights {
  if (regime === 'DEFENSIVE') {
    return { wCQ: 35, wCV: 45, wCM: 20 };
  }
  return { wCQ: 30, wCV: 40, wCM: 30 };
}

export function computeCyclicalFinalScore(
  breakdown: Pick<CyclicalBreakdown, 'sCQ' | 'sCV' | 'sCM'>,
  regime: MarketRegime
): number {
  const weights = getCyclicalRegimeWeights(regime);
  const sCQ = clamp(breakdown.sCQ, 0, 30);
  const sCV = clamp(breakdown.sCV, 0, 40);
  const sCM = clamp(breakdown.sCM, 0, 30);

  const raw = (sCQ / 30) * weights.wCQ + (sCV / 40) * weights.wCV + (sCM / 30) * weights.wCM;
  return Number(clamp(raw, 0, 100).toFixed(2));
}

export interface CyclicalEvaluationInput {
  profile: 'cyclical_heavy_asset' | 'cyclical_inventory_order';
  regime: MarketRegime;
  stageZero: StageZeroResult;
  metrics: CyclicalMetrics;
  price: number;
  ma120: number;
  ma200: number;
  rev3mCumYoYPct: number;
  rev12mCumYoYPct: number;
}

/**
 * 強景氣循環股特化評分與景氣過熱熔斷引擎 (Cyclical-QVM v1.0)
 */
export function evaluateCyclicalRating(input: CyclicalEvaluationInput): CyclicalRatingResult {
  const {
    profile,
    regime,
    stageZero,
    metrics,
    price,
    ma120,
    ma200,
    rev3mCumYoYPct,
    rev12mCumYoYPct,
  } = input;

  const weights = getCyclicalRegimeWeights(regime);
  const firstTranchePct = getFirstTranchePct(regime);

  // === 1. CQ 跨週期體質 (滿分 30) ===
  // CQ1: 5-7Y 平均 ROIC (10 分)
  let cq1 = 4;
  if (metrics.avgRoic5to7Y !== null) {
    if (metrics.avgRoic5to7Y >= 12) cq1 = 10;
    else if (metrics.avgRoic5to7Y >= 8) cq1 = 7;
    else if (metrics.avgRoic5to7Y >= 4) cq1 = 4;
    else cq1 = 1;
  }

  // CQ2: 谷底生存力－最差年度流動比與淨負債比 (10 分)
  let cq2 = 5;
  const cr = metrics.worstYearLiquidity.currentRatio;
  const ndEq = metrics.worstYearLiquidity.netDebtToEquityPct;
  if (cr !== null) {
    if (cr >= 1.8 && (ndEq === null || ndEq <= 30)) cq2 = 10;
    else if (cr >= 1.4 && (ndEq === null || ndEq <= 60)) cq2 = 7;
    else if (cr >= 1.2) cq2 = 4;
    else cq2 = 1;
  }

  // CQ3: 資本擴張紀律－反資產暴增 (10 分; assetGrowthYoY > 30% 得 0 分)
  let cq3 = 5;
  if (metrics.assetGrowthYoY !== null) {
    if (metrics.assetGrowthYoY > 30) cq3 = 0;
    else if (metrics.assetGrowthYoY > 15) cq3 = 4;
    else cq3 = 10;
  }
  if (metrics.capexToDepreciation !== null && metrics.capexToDepreciation > 2.2) {
    cq3 = Math.max(0, cq3 - 2);
  }

  const sCQ = clamp(cq1 + cq2 + cq3, 0, 30);

  // === 2. CV 週期估值 (滿分 40) ===
  // CV1: 5-7Y P/B 河流位階 (heavy_asset: 20, inventory_order: 15)
  const cv1Max = profile === 'cyclical_heavy_asset' ? 20 : 15;
  let cv1 = cv1Max * 0.4;
  if (metrics.pbPercentile5to7Y !== null) {
    if (metrics.pbPercentile5to7Y <= 30) cv1 = cv1Max;
    else if (metrics.pbPercentile5to7Y <= 50) cv1 = Number((cv1Max * 0.7).toFixed(1));
    else if (metrics.pbPercentile5to7Y < 80) cv1 = Number((cv1Max * 0.3).toFixed(1));
    else cv1 = 0; // >= 80% 強制 0 分
  }

  // CV2: Damodaran 常態化 EV/EBIT (heavy_asset: 12, inventory_order: 17)
  const cv2Max = profile === 'cyclical_heavy_asset' ? 12 : 17;
  const cheapThresh = profile === 'cyclical_heavy_asset' ? 10 : 12;
  const expThresh = profile === 'cyclical_heavy_asset' ? 22 : 25;
  let cv2 = cv2Max * 0.4;
  if (metrics.normalizedEvToEbit !== null) {
    const mult = metrics.normalizedEvToEbit;
    if (mult <= 0 || mult > expThresh) cv2 = 0;
    else if (mult <= cheapThresh) cv2 = cv2Max;
    else {
      const ratio = 1 - (mult - cheapThresh) / (expThresh - cheapThresh);
      cv2 = Number((cv2Max * clamp(ratio, 0, 1)).toFixed(1));
    }
  } else if (metrics.normalizedEBIT !== null && metrics.normalizedEBIT <= 0) {
    cv2 = 0;
  }

  // CV3: 現期 ROE 過熱偏離檢核 (8 分; roeZScoreVs5to7Y > 1.5 強制 0 分)
  let cv3 = 4;
  if (metrics.roeZScoreVs5to7Y !== null) {
    if (metrics.roeZScoreVs5to7Y > 1.5) cv3 = 0;
    else if (metrics.roeZScoreVs5to7Y > 0.5) cv3 = 4;
    else cv3 = 8;
  }

  const sCV = Number(clamp(cv1 + cv2 + cv3, 0, 40).toFixed(2));

  // === 3. CM 拐點動能 (滿分 30) ===
  // CM1: 存貨/訂單領先拐點 (12 分)
  let cm1 = 5;
  const dioDropping = metrics.dioQoqChange !== null && metrics.dioQoqChange < 0;
  const revAccelerating = rev3mCumYoYPct > rev12mCumYoYPct && rev3mCumYoYPct > -5;
  const dioRising2Q = (metrics.consecutiveDioRiseQuarters ?? 0) >= 2;
  const clExpanding =
    metrics.contractLiabilitiesYoY !== null && metrics.contractLiabilitiesYoY > 5;

  if (dioRising2Q) {
    cm1 = 1;
  } else if (dioDropping && (revAccelerating || (profile === 'cyclical_inventory_order' && clExpanding))) {
    cm1 = 12;
  } else if (dioDropping || revAccelerating || clExpanding) {
    cm1 = 7;
  } else {
    cm1 = 3;
  }

  // CM2: 毛利率二階導數拐點 (8 分; 處於 5Y 前 15% 高檔且 QoQ 轉負強制 0 分)
  let cm2 = 4;
  const gmPct = metrics.grossMargin5yPercentile;
  const gmQoQ = metrics.grossMarginQoQ;
  if (gmPct !== null && gmQoQ !== null) {
    if (gmPct >= 85 && gmQoQ < 0) {
      cm2 = 0;
    } else if (gmPct <= 50 && gmQoQ > 0) {
      cm2 = 8;
    } else if (gmQoQ > 0) {
      cm2 = 5;
    } else {
      cm2 = 2;
    }
  }

  // CM3: 趨勢與正乖離防護 (10 分)
  let cm3 = 4;
  const bias =
    metrics.biasFromMa200Pct ??
    (ma200 > 0 ? ((price - ma200) / ma200) * 100 : 0);
  const aboveKeyMa = price >= ma120 || price >= ma200;
  if (!aboveKeyMa || bias > 45) {
    cm3 = bias > 45 ? 1 : 2;
  } else if (bias <= 25) {
    cm3 = 10;
  } else {
    cm3 = 5;
  }

  const sCM = clamp(cm1 + cm2 + cm3, 0, 30);

  const breakdown: CyclicalBreakdown = {
    cq1AvgRoic: cq1,
    cq2TroughLiquidity: cq2,
    cq3AssetDiscipline: cq3,
    sCQ,
    cv1PbRiver: cv1,
    cv2NormEvEbit: cv2,
    cv3RoeOverheat: cv3,
    sCV,
    cm1InvOrderInflection: cm1,
    cm2GmSecondDeriv: cm2,
    cm3TrendAndBias: cm3,
    sCM,
  };

  const cqRatioPct = Number(((sCQ / 30) * 100).toFixed(1));
  const cvRatioPct = Number(((sCV / 40) * 100).toFixed(1));
  const cmRatioPct = Number(((sCM / 30) * 100).toFixed(1));
  const finalScore = computeCyclicalFinalScore(breakdown, regime);

  // 4. 景氣過熱熔斷器條件檢查
  const highPb = metrics.pbPercentile5to7Y !== null && metrics.pbPercentile5to7Y >= 85;
  const assetBloat = metrics.assetGrowthYoY !== null && metrics.assetGrowthYoY > 30;
  const dioAndGmReversal =
    (metrics.consecutiveDioRiseQuarters ?? 0) >= 2 &&
    metrics.grossMarginQoQ !== null &&
    metrics.grossMarginQoQ < 0;

  const isPeakCircuitBreakerTriggered = highPb && (assetBloat || dioAndGmReversal);
  const peakCircuitBreakerReasons: string[] = [];
  if (isPeakCircuitBreakerTriggered) {
    peakCircuitBreakerReasons.push(
      '觸發景氣過熱熔斷器：P/B 處於 5–7 年極端高檔且出現產能擴張／存貨反轉訊號，嚴禁於週期高點追買'
    );
  }

  if (!stageZero.passed) {
    return {
      profile,
      breakdown,
      finalScore,
      baseGrade: 'F',
      finalGrade: 'F',
      cqRatioPct,
      cvRatioPct,
      cmRatioPct,
      antiBiasDowngraded: false,
      antiBiasReasons: [],
      isPeakCircuitBreakerTriggered,
      peakCircuitBreakerReasons,
      regime,
      weights,
      firstTranchePct,
      stageZero,
    };
  }

  const baseGrade = getBaseGradeFromScore(finalScore);
  let finalGrade: Grade = baseGrade;
  const antiBiasReasons: string[] = [];

  // 防偏科檢查（循環版）：A 級須同時滿足 CQ >= 12/30 (40%)、CV >= 16/40 (40%)、CM >= 12/30 (40%)
  if (baseGrade === 'A') {
    const failed: string[] = [];
    if (sCQ < 12) failed.push(`跨週期體質 CQ (${sCQ}/30)`);
    if (sCV < 16) failed.push(`週期估值 CV (${sCV}/40)`);
    if (sCM < 12) failed.push(`拐點動能 CM (${sCM}/30)`);
    if (failed.length > 0) {
      finalGrade = 'B';
      antiBiasReasons.push(`循環防偏科降級：${failed.join('、')} 未達 40% 門檻，由 A 降為 B 級`);
    }
  }
  if (finalGrade === 'B' && sCQ < 12) {
    finalGrade = 'C';
    antiBiasReasons.push(`循環品質底線降級：CQ (${sCQ}/30) < 40%，由 B 降為 C 級`);
  }

  // 景氣過熱熔斷器高於防偏科檢查，鎖死上限為 C 級
  if (isPeakCircuitBreakerTriggered && (finalGrade === 'A' || finalGrade === 'B')) {
    finalGrade = 'C';
  }

  return {
    profile,
    breakdown,
    finalScore,
    baseGrade,
    finalGrade,
    cqRatioPct,
    cvRatioPct,
    cmRatioPct,
    antiBiasDowngraded: finalGrade !== baseGrade && !isPeakCircuitBreakerTriggered,
    antiBiasReasons,
    isPeakCircuitBreakerTriggered,
    peakCircuitBreakerReasons,
    regime,
    weights,
    firstTranchePct,
    stageZero,
  };
}
