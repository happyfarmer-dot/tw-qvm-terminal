import type {
  BenchmarkRegimeInput,
  DimensionBreakdown,
  Grade,
  MarketRegime,
  RatingResult,
  RegimeEvaluation,
  RegimeWeights,
  StageZeroResult,
} from './types';

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function getRegimeWeights(regime: MarketRegime): RegimeWeights {
  if (regime === 'DEFENSIVE') {
    return { wQ: 50, wV: 40, wM: 10 };
  }
  return { wQ: 40, wV: 35, wM: 25 };
}

export function getFirstTranchePct(regime: MarketRegime): number {
  return regime === 'DEFENSIVE' ? 0.3 : 0.5;
}

/**
 * 台股大盤體制自動判定輔助器：
 * 同時滿足 (a) 收盤低於 200MA 且 (b) 近 20 日最大回撤 > 10% 或 20 日年化波動率 > 25% -> 建議防禦模式
 */
export function evaluateRegimeSuggestion(
  input: BenchmarkRegimeInput,
  currentRegime: MarketRegime
): RegimeEvaluation {
  const belowMa200 =
    Number.isFinite(input.indexClose) &&
    Number.isFinite(input.ma200) &&
    input.ma200 > 0 &&
    input.indexClose < input.ma200;

  const deepDrawdown = Number.isFinite(input.drawdown20dPct) && input.drawdown20dPct > 10;
  const highVol =
    Number.isFinite(input.annualizedVol20dPct) && input.annualizedVol20dPct > 25;

  const reasons: string[] = [];
  if (belowMa200) {
    reasons.push(
      `加權指數 (${input.indexClose.toLocaleString()}) 低於 200MA (${input.ma200.toLocaleString()})`
    );
  }
  if (deepDrawdown) {
    reasons.push(`近 20 日最大回撤 ${input.drawdown20dPct.toFixed(1)}% (> 10%)`);
  }
  if (highVol) {
    reasons.push(`近 20 日年化波動率 ${input.annualizedVol20dPct.toFixed(1)}% (> 25%)`);
  }

  const shouldDefensive = belowMa200 && (deepDrawdown || highVol);
  const suggestedRegime: MarketRegime = shouldDefensive ? 'DEFENSIVE' : 'NORMAL';

  return {
    suggestedRegime,
    shouldPromptSwitch: suggestedRegime !== currentRegime,
    reasons,
    weights: getRegimeWeights(suggestedRegime),
    firstTranchePct: getFirstTranchePct(suggestedRegime),
  };
}

/**
 * 統一標準化總分公式：
 * FinalScore = (S_Q / 40) * wQ + (S_V / 35) * wV + (S_M / 25) * wM
 */
export function computeFinalScore(
  breakdown: Pick<DimensionBreakdown, 'sQ' | 'sV' | 'sM'>,
  regime: MarketRegime
): number {
  const weights = getRegimeWeights(regime);
  const sQ = clamp(breakdown.sQ, 0, 40);
  const sV = clamp(breakdown.sV, 0, 35);
  const sM = clamp(breakdown.sM, 0, 25);

  const raw = (sQ / 40) * weights.wQ + (sV / 35) * weights.wV + (sM / 25) * weights.wM;
  return Number(clamp(raw, 0, 100).toFixed(2));
}

export function getBaseGradeFromScore(finalScore: number): Grade {
  if (finalScore >= 80) return 'A';
  if (finalScore >= 65) return 'B';
  if (finalScore >= 50) return 'C';
  return 'D';
}

export function evaluateRating(params: {
  breakdown: DimensionBreakdown;
  regime: MarketRegime;
  stageZero: StageZeroResult;
}): RatingResult {
  const { breakdown, regime, stageZero } = params;
  const weights = getRegimeWeights(regime);
  const firstTranchePct = getFirstTranchePct(regime);

  const sQ = clamp(breakdown.sQ, 0, 40);
  const sV = clamp(breakdown.sV, 0, 35);
  const sM = clamp(breakdown.sM, 0, 25);

  const qRatioPct = Number(((sQ / 40) * 100).toFixed(1));
  const vRatioPct = Number(((sV / 35) * 100).toFixed(1));
  const mRatioPct = Number(((sM / 25) * 100).toFixed(1));

  const finalScore = computeFinalScore({ sQ, sV, sM }, regime);

  if (!stageZero.passed) {
    return {
      finalScore,
      baseGrade: 'F',
      finalGrade: 'F',
      antiBiasDowngraded: false,
      antiBiasReasons: [],
      qRatioPct,
      vRatioPct,
      mRatioPct,
      regime,
      weights,
      firstTranchePct,
      stageZero,
    };
  }

  const baseGrade = getBaseGradeFromScore(finalScore);
  let finalGrade: Grade = baseGrade;
  const antiBiasReasons: string[] = [];

  if (baseGrade === 'A') {
    const failedDims: string[] = [];
    if (sQ < 16) failedDims.push(`品質 Q (${sQ.toFixed(1)}/40, ${qRatioPct}%)`);
    if (sV < 14) failedDims.push(`價值 V (${sV.toFixed(1)}/35, ${vRatioPct}%)`);
    if (sM < 10) failedDims.push(`動能 M (${sM.toFixed(1)}/25, ${mRatioPct}%)`);

    if (failedDims.length > 0) {
      finalGrade = 'B';
      if (sM < 10 && sQ >= 16 && sV >= 14) {
        antiBiasReasons.push('觸發防偏科降級：動能維度不足 40%（M < 10/25），疑似價值陷阱');
      } else {
        antiBiasReasons.push(
          `觸發防偏科降級：${failedDims.join('、')} 未達 40% 門檻，由 A 級強制降為 B 級`
        );
      }
    }
  }

  if (finalGrade === 'B' && sQ < 16) {
    finalGrade = 'C';
    antiBiasReasons.push(
      `觸發品質底線降級：品質維度僅 ${sQ.toFixed(1)}/40 (${qRatioPct}% < 40%)，由 B 級強制降為 C 級`
    );
  }

  return {
    finalScore,
    baseGrade,
    finalGrade,
    antiBiasDowngraded: finalGrade !== baseGrade,
    antiBiasReasons,
    qRatioPct,
    vRatioPct,
    mRatioPct,
    regime,
    weights,
    firstTranchePct,
    stageZero,
  };
}
