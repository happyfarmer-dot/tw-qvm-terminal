import { getBaseGradeFromScore, getFirstTranchePct } from './ratingAndRegime';
import type {
  FinancialBreakdown,
  FinancialRatingResult,
  FinancialRegimeWeights,
  FinancialSectorMetrics,
  FinancialStageZeroResult,
  Grade,
  MarketRegime,
  StageZeroInput,
  StageZeroRedFlag,
} from './types';

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function getFinancialRegimeWeights(regime: MarketRegime): FinancialRegimeWeights {
  if (regime === 'DEFENSIVE') {
    return { wFQ: 45, wFV: 45, wFM: 10 };
  }
  return { wFQ: 40, wFV: 40, wFM: 20 };
}

export function computeFinancialFinalScore(
  breakdown: Pick<FinancialBreakdown, 'sFQ' | 'sFV' | 'sFM'>,
  regime: MarketRegime
): number {
  const weights = getFinancialRegimeWeights(regime);
  const sFQ = clamp(breakdown.sFQ, 0, 40);
  const sFV = clamp(breakdown.sFV, 0, 40);
  const sFM = clamp(breakdown.sFM, 0, 20);
  const raw = (sFQ / 40) * weights.wFQ + (sFV / 40) * weights.wFV + (sFM / 20) * weights.wFM;
  return Number(clamp(raw, 0, 100).toFixed(2));
}

/**
 * Justified P/B 推算（含嚴格防發散截斷保護）
 * sustainableGrowthG = min(max(avgRoe5Y * (1 - payout), 0), ke - 0.025, 0.05)
 * justifiedPB = (avgRoe5Y - g) / (ke - g)
 */
export function computeJustifiedPB(params: {
  avgRoePct: number | null;
  payoutRatioPct: number | null;
  kePct: number;
}): { sustainableGrowthGPct: number | null; justifiedPB: number | null } {
  const { avgRoePct, payoutRatioPct, kePct } = params;
  if (avgRoePct === null || !Number.isFinite(avgRoePct) || avgRoePct <= 0) {
    return { sustainableGrowthGPct: null, justifiedPB: null };
  }
  const keDec = Number.isFinite(kePct) && kePct > 3 ? kePct / 100 : 0.08;
  const roeDec = avgRoePct / 100;
  const payoutDec =
    payoutRatioPct !== null && Number.isFinite(payoutRatioPct)
      ? Math.max(0, Math.min(1, payoutRatioPct / 100))
      : 0.5;

  const rawG = roeDec * (1 - payoutDec);
  const maxSafeG = Math.max(0, Math.min(keDec - 0.025, 0.05));
  const gDec = Math.min(Math.max(rawG, 0), maxSafeG);

  const denom = keDec - gDec;
  if (denom <= 0.005) {
    return {
      sustainableGrowthGPct: Number((gDec * 100).toFixed(2)),
      justifiedPB: null,
    };
  }
  const jpb = (roeDec - gDec) / denom;
  if (!Number.isFinite(jpb) || jpb <= 0) {
    return {
      sustainableGrowthGPct: Number((gDec * 100).toFixed(2)),
      justifiedPB: null,
    };
  }
  return {
    sustainableGrowthGPct: Number((gDec * 100).toFixed(2)),
    justifiedPB: Number(jpb.toFixed(3)),
  };
}

/**
 * 金融業專屬階段零防雷閘門
 * 自動跳過 Beneish / Altman / OCF / 存貨檢查；
 * 監理欄位若為 null，絕不誤判 F 級但標記 hasUnverifiedRegulatoryFields = true
 */
export function evaluateFinancialStageZero(params: {
  profile: 'financial_bank' | 'financial_life_fhc';
  commonInput: StageZeroInput;
  finMetrics: FinancialSectorMetrics;
}): FinancialStageZeroResult {
  const { profile, commonInput, finMetrics } = params;
  const redFlags: StageZeroRedFlag[] = [];
  const pendingManualChecks: string[] = [];

  // 1. 資本適足紅線
  if (finMetrics.fhcCarPct === null) {
    pendingManualChecks.push('金控集團資本適足率 CAR (%) 未填入');
  } else if (isFiniteNum(finMetrics.fhcCarPct) && finMetrics.fhcCarPct < 105) {
    redFlags.push({
      code: 'FIN_FHC_CAR',
      title: '金控集團資本適足率不足 (< 105%)',
      detail: `CAR = ${finMetrics.fhcCarPct.toFixed(1)}%（低於 105% 防雷底線）。`,
    });
  }

  if (finMetrics.bankBisPct === null) {
    pendingManualChecks.push('銀行總資本適足率 BIS (%) 未填入');
  } else if (isFiniteNum(finMetrics.bankBisPct) && finMetrics.bankBisPct < 10.5) {
    redFlags.push({
      code: 'FIN_BANK_BIS',
      title: '銀行總資本適足率 BIS 不足 (< 10.5%)',
      detail: `BIS = ${finMetrics.bankBisPct.toFixed(2)}%（低於 10.5% 法定門檻）。`,
    });
  }

  const cet1Threshold = finMetrics.isDsib ? 9.5 : 7.0;
  if (finMetrics.bankCet1Pct === null) {
    pendingManualChecks.push('銀行普通股權益第一類資本 CET1 (%) 未填入');
  } else if (isFiniteNum(finMetrics.bankCet1Pct) && finMetrics.bankCet1Pct < cet1Threshold) {
    redFlags.push({
      code: 'FIN_BANK_CET1',
      title: `銀行 CET1 資本適足率不足 (< ${cet1Threshold}%${finMetrics.isDsib ? ' D-SIBs' : ''})`,
      detail: `CET1 = ${finMetrics.bankCet1Pct.toFixed(2)}%（低於 ${cet1Threshold}% 紅線）。`,
    });
  }

  if (profile === 'financial_life_fhc') {
    if (finMetrics.lifeSolvencyRatioPct === null) {
      pendingManualChecks.push('壽險子公司清償比率 (RBC / TW-ICS %) 未填入');
    } else {
      const regime = finMetrics.lifeSolvencyRegime ?? 'RBC';
      const minSolvency = regime === 'TW-ICS' ? 100 : 200;
      if (isFiniteNum(finMetrics.lifeSolvencyRatioPct) && finMetrics.lifeSolvencyRatioPct < minSolvency) {
        redFlags.push({
          code: 'FIN_LIFE_SOLVENCY',
          title: `壽險清償比率 (${regime}) 低於法定門檻 (< ${minSolvency}%)`,
          detail: `${regime} = ${finMetrics.lifeSolvencyRatioPct.toFixed(1)}%（低於 ${minSolvency}%）。`,
        });
      }
    }
  }

  // 2. 雙重槓桿紅線 (DLR > 125%)
  if (finMetrics.doubleLeverageRatioPct === null) {
    pendingManualChecks.push('金控雙重槓桿比 DLR (%) 未填入');
  } else if (
    isFiniteNum(finMetrics.doubleLeverageRatioPct) &&
    finMetrics.doubleLeverageRatioPct > 125
  ) {
    redFlags.push({
      code: 'FIN_DLR_HIGH',
      title: '金控雙重槓桿比過高 (> 125%)',
      detail: `DLR = ${finMetrics.doubleLeverageRatioPct.toFixed(1)}%（突破 125% 法定警戒紅線）。`,
    });
  }

  // 3. 資產品質崩壞 (NPL > 1.0% OR Coverage < 100%)
  if (finMetrics.nplRatioPct === null) {
    pendingManualChecks.push('銀行逾放比 NPL (%) 未填入');
  } else if (isFiniteNum(finMetrics.nplRatioPct) && finMetrics.nplRatioPct > 1.0) {
    redFlags.push({
      code: 'FIN_NPL_HIGH',
      title: '銀行逾放比惡化 (> 1.0%)',
      detail: `NPL = ${finMetrics.nplRatioPct.toFixed(2)}%（超過 1.0% 紅線）。`,
    });
  }

  if (finMetrics.nplCoverageRatioPct === null) {
    pendingManualChecks.push('備抵呆帳覆蓋率 (%) 未填入');
  } else if (
    isFiniteNum(finMetrics.nplCoverageRatioPct) &&
    finMetrics.nplCoverageRatioPct < 100
  ) {
    redFlags.push({
      code: 'FIN_COVERAGE_LOW',
      title: '備抵呆帳覆蓋率過低 (< 100%)',
      detail: `覆蓋率僅 ${finMetrics.nplCoverageRatioPct.toFixed(1)}%（低於 100% 危險線）。`,
    });
  }

  // 4. 台股共通紅線：流動性 < 3,000 萬、處置股、設質 >= 70%、會計師/裁罰異常
  if (
    isFiniteNum(commonInput.avgDailyTurnover20dTWD) &&
    commonInput.avgDailyTurnover20dTWD < 30_000_000
  ) {
    redFlags.push({
      code: 'TW_LOW_TURNOVER',
      title: '台股流動性不足 (< NT$ 3,000 萬)',
      detail: `20 日均成交額 NT$ ${(commonInput.avgDailyTurnover20dTWD / 1e6).toFixed(2)} 百萬。`,
    });
  }
  if (commonInput.isDispositionStock === true) {
    redFlags.push({
      code: 'TW_DISPOSITION',
      title: '列為處置股',
      detail: '目前為處置分盤交易。',
    });
  }
  if (isFiniteNum(commonInput.directorPledgeRatio) && commonInput.directorPledgeRatio >= 70) {
    redFlags.push({
      code: 'TW_DIRECTOR_PLEDGE',
      title: '董監設質比率過高 (>= 70%)',
      detail: `設質比率達 ${commonInput.directorPledgeRatio.toFixed(1)}%。`,
    });
  }
  if (commonInput.hasAuditOrGovernanceRedFlag === null) {
    pendingManualChecks.push('會計師意見／重大監理裁罰需人工覆核');
  } else if (commonInput.hasAuditOrGovernanceRedFlag === true) {
    redFlags.push({
      code: 'TW_AUDIT_GOV',
      title: '會計師保留意見／重大裁罰異常',
      detail: '出現查核意見異常或重大治理／金管會裁罰紅旗。',
    });
  }

  const hasUnverifiedRegulatoryFields = pendingManualChecks.length > 0;
  const passed = redFlags.length === 0;

  return {
    passed,
    gradeOverride: passed ? null : 'F',
    redFlags,
    pendingManualChecks,
    hasUnverifiedRegulatoryFields,
  };
}

export interface FinancialEvaluationInput {
  profile: 'financial_bank' | 'financial_life_fhc';
  regime: MarketRegime;
  commonStageZeroInput: StageZeroInput;
  metrics: FinancialSectorMetrics;
  price: number;
  ma200: number;
  customKePct?: number;
  customPayoutPct?: number | null;
}

/**
 * 銀行與金控業特化評分與熔斷引擎 (Fin-QVM v1.0)
 */
export function evaluateFinancialRating(input: FinancialEvaluationInput): FinancialRatingResult {
  const {
    profile,
    regime,
    commonStageZeroInput,
    metrics,
    price,
    ma200,
    customKePct,
    customPayoutPct,
  } = input;

  const weights = getFinancialRegimeWeights(regime);
  const firstTranchePct = getFirstTranchePct(regime);

  const stageZero = evaluateFinancialStageZero({
    profile,
    commonInput: commonStageZeroInput,
    finMetrics: metrics,
  });

  // === FQ 體質與資產品質 (滿分 40) ===
  // FQ1: 資本適足緩衝 (12 分)
  let fq1 = 6;
  const car = metrics.fhcCarPct;
  const cet1 = metrics.bankCet1Pct;
  const cet1Floor = metrics.isDsib ? 9.5 : 7.0;
  if (car !== null && cet1 !== null) {
    const carBuf = car - 105;
    const cet1Buf = cet1 - cet1Floor;
    if (carBuf >= 18 && cet1Buf >= 2.0) fq1 = 12;
    else if (carBuf >= 10 && cet1Buf >= 1.0) fq1 = 9;
    else if (carBuf >= 5 && cet1Buf >= 0.3) fq1 = 5;
    else fq1 = 2;
  }

  // FQ2: 資產品質雙率 (銀行型 12 / 壽險型 8)
  const fq2Max = profile === 'financial_bank' ? 12 : 8;
  let fq2 = fq2Max * 0.5;
  const npl = metrics.nplRatioPct;
  const cov = metrics.nplCoverageRatioPct;
  if (npl !== null && cov !== null) {
    if (npl < 0.2 && cov >= 600) fq2 = fq2Max;
    else if (npl <= 0.35 && cov >= 400) fq2 = Number((fq2Max * 0.75).toFixed(1));
    else if (npl > 0.5 || cov < 250) fq2 = 0;
    else fq2 = Number((fq2Max * 0.4).toFixed(1));
  }

  // FQ3: DLR 結構與跨週期 ROE 穩定度 (銀行型 8 / 壽險型 12)
  const fq3Max = profile === 'financial_bank' ? 8 : 12;
  let fq3 = fq3Max * 0.5;
  const dlr = metrics.doubleLeverageRatioPct;
  const roe5 = metrics.avgRoe5Y;
  const minRoe = metrics.minAnnualRoe5Y;
  const roeTarget = profile === 'financial_bank' ? 9.0 : 10.0;
  if (dlr !== null && dlr > 120) {
    fq3 = 0;
  } else if (roe5 !== null && roe5 < 6.0) {
    fq3 = 0;
  } else if (
    (dlr === null || dlr <= 115) &&
    roe5 !== null &&
    roe5 >= roeTarget &&
    (minRoe === null || minRoe > 0)
  ) {
    fq3 = fq3Max;
  } else if (roe5 !== null && roe5 >= 7.5) {
    fq3 = Number((fq3Max * 0.65).toFixed(1));
  } else {
    fq3 = Number((fq3Max * 0.3).toFixed(1));
  }

  // FQ4: 淨值保護與配息真實力 (8 分)
  let fq4 = 4;
  if (metrics.ociRestrictsDividend === true) {
    fq4 = 0;
  } else if (
    metrics.ociRestrictsDividend === false &&
    (metrics.consecutiveCashDivYears ?? 0) >= 5 &&
    metrics.usesCapitalReserveForDividend !== true
  ) {
    fq4 = 8;
  } else if ((metrics.consecutiveCashDivYears ?? 0) >= 5) {
    fq4 = 5;
  }

  const sFQ = Number(clamp(fq1 + fq2 + fq3 + fq4, 0, 40).toFixed(2));

  // === FV 金融專屬估值 (滿分 40) ===
  const effectiveKePct =
    typeof customKePct === 'number' && Number.isFinite(customKePct)
      ? customKePct
      : metrics.defaultKe * 100;
  const effectivePayoutPct =
    customPayoutPct !== undefined ? customPayoutPct : metrics.avgPayoutRatio5Y;

  const { justifiedPB } = computeJustifiedPB({
    avgRoePct: metrics.avgRoe5Y,
    payoutRatioPct: effectivePayoutPct,
    kePct: effectiveKePct,
  });

  const pbValRatio =
    metrics.currentPB !== null && justifiedPB !== null && justifiedPB > 0
      ? Number((metrics.currentPB / justifiedPB).toFixed(3))
      : metrics.pbValuationRatio;

  // FV1: Justified P/B 折價率 (18 分)
  let fv1 = 7;
  if (pbValRatio !== null) {
    if (pbValRatio <= 0.85) fv1 = 18;
    else if (pbValRatio <= 1.05) fv1 = 11;
    else if (pbValRatio < 1.25) fv1 = 5;
    else fv1 = 0; // >= 1.25 強制 0 分
  }

  // FV2: 5-7 年 P/B 河流位階 (12 分)
  let fv2 = 5;
  if (metrics.pbPercentile5to7Y !== null) {
    if (metrics.pbPercentile5to7Y <= 30) fv2 = 12;
    else if (metrics.pbPercentile5to7Y <= 55) fv2 = 8;
    else if (metrics.pbPercentile5to7Y < 85) fv2 = 4;
    else fv2 = 0; // >= 85% 強制 0 分
  }

  // FV3: 實質現金殖利率利差 (10 分)
  let fv3 = 4;
  const yld = metrics.cashDividendYieldPct;
  const payout = metrics.latestPayoutRatioPct ?? metrics.avgPayoutRatio5Y;
  if (yld !== null) {
    if (yld < 2.5 || (payout !== null && payout > 100)) {
      fv3 = 1;
    } else if (yld >= 4.5 && (payout === null || (payout >= 40 && payout <= 85))) {
      fv3 = 10;
    } else if (yld >= 3.5) {
      fv3 = 6;
    } else {
      fv3 = 3;
    }
  }

  const sFV = Number(clamp(fv1 + fv2 + fv3, 0, 40).toFixed(2));

  // === FM 金融動能與趨勢 (滿分 20) ===
  // FM1: 獲利／淨收益動能 (10 分)
  let fm1 = 5;
  const r3 = metrics.netRevenue3mYoY;
  const r12 = metrics.netRevenue12mYoY;
  if (r3 !== null) {
    if (r3 < -15) fm1 = 0;
    else if (r3 > 0 && (r12 === null || r3 >= r12)) fm1 = 10;
    else if (r3 > 0) fm1 = 7;
    else fm1 = 3;
  }

  // FM2: 長期趨勢與除息前正乖離防護 (10 分)
  let fm2 = 4;
  const bias =
    metrics.biasFromMa200Pct ??
    (ma200 > 0 ? ((price - ma200) / ma200) * 100 : 0);
  if (price < ma200 || bias > 25) {
    fm2 = bias > 25 ? 1 : 2;
  } else if (bias <= 15) {
    fm2 = 10;
  } else {
    fm2 = 6;
  }

  const sFM = Number(clamp(fm1 + fm2, 0, 20).toFixed(2));

  const breakdown: FinancialBreakdown = {
    fq1CapitalBuffer: fq1,
    fq2AssetQuality: fq2,
    fq3RoeAndDlr: fq3,
    fq4DividendReal: fq4,
    sFQ,
    fv1JustifiedPb: fv1,
    fv2PbRiver: fv2,
    fv3YieldSpread: fv3,
    sFV,
    fm1NetRevMom: fm1,
    fm2TrendAndBias: fm2,
    sFM,
  };

  const fqRatioPct = Number(((sFQ / 40) * 100).toFixed(1));
  const fvRatioPct = Number(((sFV / 40) * 100).toFixed(1));
  const fmRatioPct = Number(((sFM / 20) * 100).toFixed(1));
  const finalScore = computeFinancialFinalScore(breakdown, regime);

  // 高息陷阱／信用惡化熔斷器
  const ociAndDilutionTrap =
    metrics.ociRestrictsDividend === true &&
    metrics.recentDilutiveOfferingPct !== null &&
    metrics.recentDilutiveOfferingPct > 10;
  const creditDeteriorationTrap =
    metrics.nplConsecutiveRiseQuarters !== null &&
    metrics.nplConsecutiveRiseQuarters >= 2 &&
    metrics.nplCoverageRatioPct !== null &&
    metrics.nplCoverageRatioPct < 300;

  const isFinancialTrapCircuitBreakerTriggered = ociAndDilutionTrap || creditDeteriorationTrap;
  const financialTrapReasons: string[] = [];
  if (ociAndDilutionTrap) {
    financialTrapReasons.push(
      `觸發高息假象／增資稀釋熔斷器：OCI 限制配息且近 1 年現金增資稀釋 ${metrics.recentDilutiveOfferingPct?.toFixed(1)}% (> 10%)`
    );
  }
  if (creditDeteriorationTrap) {
    financialTrapReasons.push(
      `觸發信用惡化熔斷器：NPL 連續 ${metrics.nplConsecutiveRiseQuarters} 季上升且備抵呆帳覆蓋率僅 ${metrics.nplCoverageRatioPct?.toFixed(1)}% (< 300%)`
    );
  }

  if (!stageZero.passed) {
    return {
      profile,
      breakdown,
      finalScore,
      baseGrade: 'F',
      finalGrade: 'F',
      fqRatioPct,
      fvRatioPct,
      fmRatioPct,
      antiBiasDowngraded: false,
      antiBiasReasons: [],
      isFinancialTrapCircuitBreakerTriggered,
      financialTrapReasons,
      hasUnverifiedRegulatoryFields: stageZero.hasUnverifiedRegulatoryFields,
      effectiveKePct,
      effectivePayoutPct,
      recalculatedJustifiedPB: justifiedPB,
      recalculatedPbValuationRatio: pbValRatio,
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
    const failed: string[] = [];
    if (sFQ < 16) failed.push(`體質品質 FQ (${sFQ}/40)`);
    if (sFV < 16) failed.push(`金融估值 FV (${sFV}/40)`);
    if (sFM < 8) failed.push(`獲利動能 FM (${sFM}/20)`);
    if (failed.length > 0) {
      finalGrade = 'B';
      antiBiasReasons.push(`金融防偏科降級：${failed.join('、')} 未達 40% 門檻，由 A 降為 B 級`);
    }
  }
  if (finalGrade === 'B' && sFQ < 16) {
    finalGrade = 'C';
    antiBiasReasons.push(`金融體質底線降級：FQ (${sFQ}/40) < 40%，由 B 降為 C 級`);
  }

  // 金融陷阱熔斷器高於防偏科檢查，鎖死上限為 C 級
  if (isFinancialTrapCircuitBreakerTriggered && (finalGrade === 'A' || finalGrade === 'B')) {
    finalGrade = 'C';
  }

  return {
    profile,
    breakdown,
    finalScore,
    baseGrade,
    finalGrade,
    fqRatioPct,
    fvRatioPct,
    fmRatioPct,
    antiBiasDowngraded: finalGrade !== baseGrade && !isFinancialTrapCircuitBreakerTriggered,
    antiBiasReasons,
    isFinancialTrapCircuitBreakerTriggered,
    financialTrapReasons,
    hasUnverifiedRegulatoryFields: stageZero.hasUnverifiedRegulatoryFields,
    effectiveKePct,
    effectivePayoutPct,
    recalculatedJustifiedPB: justifiedPB,
    recalculatedPbValuationRatio: pbValRatio,
    regime,
    weights,
    firstTranchePct,
    stageZero,
  };
}
