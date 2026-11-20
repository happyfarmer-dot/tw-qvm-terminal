import { describe, expect, it } from 'vitest';
import { MOCK_TW_HOLDINGS, MOCK_TW_STOCKS } from '../../data/mockTwStocks';
import {
  computeCyclicalFinalScore,
  evaluateCyclicalRating,
} from '../cyclicalScoring';
import { calculatePortfolioSizing } from '../portfolioSizing';
import {
  computeFinalScore,
  evaluateRating,
  evaluateRegimeSuggestion,
  getFirstTranchePct,
} from '../ratingAndRegime';
import { rankBatchWithZScore } from '../scoringBatchZ';
import { calculatePiotroskiScore, scoreManualCard } from '../scoringManual';
import { evaluateStageZero } from '../stageZero';
import {
  adviseEntry,
  adviseHoldingExit,
  calculateTwFrictionCost,
  getNextTwPitReviewDate,
} from '../tradeAdvisor';
import type { HoldingPosition, StageZeroInput } from '../types';

function makeHealthyTwStageZero(): StageZeroInput {
  return {
    price: 150,
    isManufacturing: true,
    beneishMScore: -2.4,
    altmanZScore: 4.8,
    altmanZDoublePrime: null,
    cumulative3yOCF: 5_000_000_000,
    cumulative5yOCF: 8_000_000_000,
    latestCurrentRatio: 2.1,
    latestNetDebtToEquityPct: -10,
    hasAuditOrGovernanceRedFlag: false,
    isFullCashDeliveryOrSuspended: false,
    directorPledgeRatio: 4,
    directorInsufficientHoldingMonths: 0,
    avgDailyTurnover20dTWD: 300_000_000,
    isDispositionStock: false,
    shareDilution3yPct: 1,
    isRoicDeclining: false,
    consecutive2qArOrInvBloat: false,
  };
}

describe('TW-QVM 核心引擎 6 大基礎規則驗證', () => {
  it('1. 階段零一票否決：總分 95 觸發 Beneish > -1.78 或董監設質 >= 70% 必為 F 級且 P0 清倉', () => {
    const szBeneish = evaluateStageZero({
      ...makeHealthyTwStageZero(),
      beneishMScore: -1.7,
    });
    expect(szBeneish.passed).toBe(false);
    expect(szBeneish.gradeOverride).toBe('F');

    const szPledge = evaluateStageZero({
      ...makeHealthyTwStageZero(),
      directorPledgeRatio: 70,
    });
    expect(szPledge.passed).toBe(false);

    const rating = evaluateRating({
      breakdown: { sQ: 39, sV: 33, sM: 23 }, // 95 分
      regime: 'NORMAL',
      stageZero: szPledge,
    });
    expect(rating.finalScore).toBe(95);
    expect(rating.finalGrade).toBe('F');

    const holding: HoldingPosition = {
      id: 'H-F',
      symbol: '6599',
      name: '地雷股',
      sector: '電子零組件業',
      valuationProfile: 'standard',
      shares: 3000,
      costPrice: 100,
      currentPrice: 110,
      highestPriceSinceEntry: 115,
      atr20: 3,
      ma60: 102,
      ma120: 98,
      ma200: 95,
      daysBelow200Ma: 0,
      moatPermanentlyBroken: false,
      stopDrawdownThresholdPct: 15,
      currentRating: rating,
      currentBreakdown: { sQ: 39, sV: 33, sM: 23 },
    };
    const exit = adviseHoldingExit({
      holding,
      totalActivePortfolioValue: 1_000_000,
    });
    expect(exit.primaryPriority).toBe('P0');
    expect(exit.recommendedSellPct).toBe(100);
  });

  it('2. 防偏科降級：常態 Q=38, V=35, M=8（總分 81）因 M < 10 強制降為 B 級', () => {
    const sz = evaluateStageZero(makeHealthyTwStageZero());
    const rating = evaluateRating({
      breakdown: { sQ: 38, sV: 35, sM: 8 },
      regime: 'NORMAL',
      stageZero: sz,
    });
    expect(rating.finalScore).toBe(81);
    expect(rating.baseGrade).toBe('A');
    expect(rating.finalGrade).toBe('B');
    expect(rating.antiBiasDowngraded).toBe(true);
  });

  it('3. 防禦體制重加權：50/40/10 滿分嚴格等於 100，首倉比例變更為 30%', () => {
    expect(computeFinalScore({ sQ: 40, sV: 35, sM: 25 }, 'DEFENSIVE')).toBe(100);
    expect(getFirstTranchePct('NORMAL')).toBe(0.5);
    expect(getFirstTranchePct('DEFENSIVE')).toBe(0.3);

    const sz = evaluateStageZero(makeHealthyTwStageZero());
    const rating = evaluateRating({
      breakdown: { sQ: 38, sV: 32, sM: 20 },
      regime: 'DEFENSIVE',
      stageZero: sz,
    });
    const entry = adviseEntry(rating);
    expect(entry.allowEntry).toBe(true);
    expect(entry.firstTranchePct).toBe(30);
    expect(entry.secondTranchePct).toBe(70);

    const regSuggest = evaluateRegimeSuggestion(
      { indexClose: 19800, ma200: 21400, drawdown20dPct: 11.5, annualizedVol20dPct: 26.2 },
      'NORMAL'
    );
    expect(regSuggest.suggestedRegime).toBe('DEFENSIVE');
  });

  it('4. P0–P4 優先序衝突判定：P0 > P1-C > P1 > P2 > P3 > P4', () => {
    const szPass = evaluateStageZero(makeHealthyTwStageZero());
    const ratingOk = evaluateRating({
      breakdown: { sQ: 30, sV: 24, sM: 12 },
      regime: 'NORMAL',
      stageZero: szPass,
    });

    const p1AndP3: HoldingPosition = {
      id: 'H-P1-P3',
      symbol: '2317',
      name: '測試',
      sector: '其他電子業',
      valuationProfile: 'standard',
      shares: 10_000,
      costPrice: 200,
      currentPrice: 160,
      highestPriceSinceEntry: 210,
      atr20: 10,
      ma60: 175,
      ma120: 180,
      ma200: 185,
      daysBelow200Ma: 6,
      moatPermanentlyBroken: false,
      stopDrawdownThresholdPct: 15,
      currentRating: ratingOk,
      currentBreakdown: { sQ: 30, sV: 24, sM: 12 },
    };

    const resP1 = adviseHoldingExit({
      holding: p1AndP3,
      totalActivePortfolioValue: 2_000_000,
    });
    expect(resP1.primaryPriority).toBe('P1');

    const resP0 = adviseHoldingExit({
      holding: { ...p1AndP3, moatPermanentlyBroken: true },
      totalActivePortfolioValue: 2_000_000,
    });
    expect(resP0.primaryPriority).toBe('P0');
  });

  it('5. 緩衝區續抱（72 分）與台股 0.3% 證交稅成本計算', () => {
    const szPass = evaluateStageZero(makeHealthyTwStageZero());
    const rating72 = evaluateRating({
      breakdown: { sQ: 30, sV: 25, sM: 17 },
      regime: 'NORMAL',
      stageZero: szPass,
    });
    expect(rating72.finalScore).toBe(72);

    const holding72: HoldingPosition = {
      id: 'H-72',
      symbol: '2382',
      name: '廣達',
      sector: '電腦及週邊設備業',
      valuationProfile: 'standard',
      shares: 1000,
      costPrice: 280,
      currentPrice: 295,
      highestPriceSinceEntry: 305,
      atr20: 9,
      ma60: 285,
      ma120: 275,
      ma200: 265,
      daysBelow200Ma: 0,
      moatPermanentlyBroken: false,
      stopDrawdownThresholdPct: 15,
      currentRating: rating72,
      currentBreakdown: { sQ: 30, sV: 25, sM: 17 },
    };

    const exit = adviseHoldingExit({
      holding: holding72,
      totalActivePortfolioValue: 3_000_000,
    });
    expect(exit.primaryPriority).toBe('HOLD');
    expect(exit.bufferProtected).toBe(true);

    const cost = calculateTwFrictionCost(1_000_000, {
      feeDiscount: 0.6,
      applyMinFee20: true,
      slippageRoundTripPct: 0.15,
    });
    expect(cost.securitiesTax).toBe(3000);
    expect(cost.buyFee).toBe(855);
    expect(cost.sellFee).toBe(855);
    expect(cost.slippageCost).toBe(1500);
  });

  it('6. 反波動率倉位加總 100%、低波動高於高波動、產業上限檢查與張/零股換算', () => {
    const cands = [
      { id: '1', symbol: '2308', name: '低波1', sector: '電子零組件', price: 392, annualizedVolPct: 18, finalScore: 88, grade: 'A' as const },
      { id: '2', symbol: '2330', name: '低波2', sector: '半導體', price: 1055, annualizedVolPct: 22, finalScore: 90, grade: 'A' as const },
      { id: '3', symbol: '2382', name: '中波1', sector: '電腦週邊', price: 298, annualizedVolPct: 28, finalScore: 82, grade: 'A' as const },
      { id: '4', symbol: '2345', name: '中波2', sector: '通信網路', price: 615, annualizedVolPct: 33, finalScore: 84, grade: 'A' as const },
      { id: '5', symbol: '3131', name: '高波1', sector: '半導體設備', price: 418, annualizedVolPct: 45, finalScore: 83, grade: 'A' as const },
      { id: '6', symbol: '1216', name: '極低波', sector: '食品工業', price: 82, annualizedVolPct: 14, finalScore: 81, grade: 'A' as const },
      { id: '7', symbol: '2317', name: '中波3', sector: '其他電子', price: 212, annualizedVolPct: 30, finalScore: 85, grade: 'A' as const },
      { id: '8', symbol: '2454', name: '高波2', sector: 'IC設計', price: 1310, annualizedVolPct: 40, finalScore: 86, grade: 'A' as const },
    ];

    const res = calculatePortfolioSizing(cands, {
      totalActiveCapital: 4_000_000,
      portfolioMode: 'SATELLITE',
      minWeightPct: 4,
      maxWeightPct: 20,
      sectorCapPct: 25,
      applySectorScaling: true,
    });

    expect(Math.abs(res.totalWeightPct - 100)).toBeLessThan(0.01);
    const lowestVol = res.allocations.find((a) => a.candidate.symbol === '1216')!;
    const highestVol = res.allocations.find((a) => a.candidate.symbol === '3131')!;
    expect(lowestVol.finalWeightPct).toBeGreaterThan(highestVol.finalWeightPct);
    expect(lowestVol.twLots * 1000 + lowestVol.twOddShares).toBe(lowestVol.suggestedShares);
  });
});

describe('Cyclical-QVM v1.0 強景氣循環股特化模組測試', () => {
  it('7. 高點陷阱對比測試：範例 7 跑標準模式為 A 級，跑循環模式必觸發過熱熔斷器並鎖死 C 級', () => {
    const trapStock = MOCK_TW_STOCKS.find((s) => s.symbol === '2603')!;
    expect(trapStock).toBeDefined();

    // 1) 標準模式 (Z-Score 同市場批次對比，或直接標準評分) -> 低 PE 5.5x + 高 ROIC 34% + 強動能 => A 級
    const rankedStd = rankBatchWithZScore(MOCK_TW_STOCKS, 'NORMAL');
    const trapStd = rankedStd.find((r) => r.stock.symbol === '2603')!;
    expect(trapStd.rating.finalGrade).toBe('A');

    // 2) 切換為循環模式 -> P/B 92% >= 85% 且資產擴張 42% > 30% + DIO 連 2 季升 & 毛利轉負 => 過熱熔斷強制鎖死 C 級
    const szCyc = evaluateStageZero(trapStock.stageZeroInput, 'cyclical_heavy_asset');
    const cycRes = evaluateCyclicalRating({
      profile: 'cyclical_heavy_asset',
      regime: 'NORMAL',
      stageZero: szCyc,
      metrics: trapStock.cyclicalMetrics,
      price: trapStock.price,
      ma120: trapStock.ma120,
      ma200: trapStock.ma200,
      rev3mCumYoYPct: trapStock.rev3mCumYoYPct,
      rev12mCumYoYPct: trapStock.rev12mCumYoYPct,
    });
    expect(cycRes.isPeakCircuitBreakerTriggered).toBe(true);
    expect(['C', 'D']).toContain(cycRes.finalGrade);

    // 驗證若原始評分達 B/A 級 (>= 65) 但觸發過熱熔斷器時，必強制鎖死為 C 級
    const highBaseTrap = evaluateCyclicalRating({
      profile: 'cyclical_heavy_asset',
      regime: 'NORMAL',
      stageZero: szCyc,
      metrics: {
        ...trapStock.cyclicalMetrics,
        avgRoic5to7Y: 16,
        worstYearLiquidity: { year: '2020', currentRatio: 2.0, netDebtToEquityPct: 10 },
        normalizedEvToEbit: 9.0,
        roeZScoreVs5to7Y: 0.2,
        dioQoqChange: -3,
        consecutiveDioRiseQuarters: 0,
        grossMargin5yPercentile: 40,
        grossMarginQoQ: 1.5,
        biasFromMa200Pct: 12,
        pbPercentile5to7Y: 86,
        assetGrowthYoY: 35,
      },
      price: trapStock.price,
      ma120: trapStock.ma120,
      ma200: trapStock.ma200,
      rev3mCumYoYPct: 20,
      rev12mCumYoYPct: 10,
    });
    expect(highBaseTrap.baseGrade === 'A' || highBaseTrap.baseGrade === 'B').toBe(true);
    expect(highBaseTrap.isPeakCircuitBreakerTriggered).toBe(true);
    expect(highBaseTrap.finalGrade).toBe('C');

    // 額外驗證範例 8（谷底復甦右側拐點）於循環模式可拿到 A 級
    const recoveryStock = MOCK_TW_STOCKS.find((s) => s.symbol === '3131')!;
    const szRec = evaluateStageZero(recoveryStock.stageZeroInput, 'cyclical_inventory_order');
    const recRes = evaluateCyclicalRating({
      profile: 'cyclical_inventory_order',
      regime: 'NORMAL',
      stageZero: szRec,
      metrics: recoveryStock.cyclicalMetrics,
      price: recoveryStock.price,
      ma120: recoveryStock.ma120,
      ma200: recoveryStock.ma200,
      rev3mCumYoYPct: recoveryStock.rev3mCumYoYPct,
      rev12mCumYoYPct: recoveryStock.rev12mCumYoYPct,
    });
    expect(recRes.isPeakCircuitBreakerTriggered).toBe(false);
    expect(recRes.finalGrade).toBe('A');
  });

  it('8. P1-C 優先序測試：循環持倉尚未跌破 200MA，只要 P/B >= 80% 且毛利率 QoQ < 0（或破 60MA）必輸出 P1-C', () => {
    const cycHolding = MOCK_TW_HOLDINGS.find((h) => h.symbol === '2603')!;
    expect(cycHolding).toBeDefined();
    expect(cycHolding.currentPrice).toBeGreaterThan(cycHolding.ma200); // 尚未破 200MA
    expect(cycHolding.daysBelow200Ma).toBe(0);

    const exit = adviseHoldingExit({
      holding: cycHolding,
      totalActivePortfolioValue: 2_000_000,
    });
    expect(exit.primaryPriority).toBe('P1-C');
    expect(exit.recommendedSellPct).toBe(50);
    expect(exit.trailingStopPrice).toBeCloseTo(
      cycHolding.highestPriceSinceEntry - 2.0 * cycHolding.atr20,
      2
    );
  });

  it('9. 循環權重歸一化測試：防禦模式 (35/45/20) 下滿分嚴格等於 100', () => {
    const maxDef = computeCyclicalFinalScore({ sCQ: 30, sCV: 40, sCM: 30 }, 'DEFENSIVE');
    expect(maxDef).toBe(100);
    const maxNorm = computeCyclicalFinalScore({ sCQ: 30, sCV: 40, sCM: 30 }, 'NORMAL');
    expect(maxNorm).toBe(100);
  });

  it('補充：反靜默失真 null 待核對項目與 PIT 行事曆驗證', () => {
    const szNull = evaluateStageZero({
      ...makeHealthyTwStageZero(),
      hasAuditOrGovernanceRedFlag: null,
      directorPledgeRatio: null,
    });
    expect(szNull.passed).toBe(true);
    expect(szNull.pendingManualChecks.length).toBe(2);

    const pit = getNextTwPitReviewDate(new Date(2026, 4, 5));
    expect(pit.nextQuarterlyDate).toBe('2026-05-16');
    expect(pit.nextMonthlyRevDate).toBe('2026-05-10');

    const p9 = calculatePiotroskiScore({
      positiveRoa: true,
      roaImproving: true,
      positiveOcf: true,
      ocfGreaterThanNetIncome: true,
      lowerLongTermDebtRatio: true,
      higherCurrentRatio: true,
      noShareDilution: true,
      higherGrossMargin: true,
      higherAssetTurnover: true,
    });
    expect(p9.rawScore).toBe(9);
    expect(p9.mappedQ4Score).toBe(8);

    const card = scoreManualCard({
      q1RoicScore: 12,
      q2GpaScore: 10,
      q3OcfNiScore: 10,
      piotroskiChecks: {
        positiveRoa: true,
        roaImproving: true,
        positiveOcf: true,
        ocfGreaterThanNetIncome: true,
        lowerLongTermDebtRatio: true,
        higherCurrentRatio: true,
        noShareDilution: true,
        higherGrossMargin: true,
        higherAssetTurnover: true,
      },
      v1EvMultipleScore: 15,
      v2FcfEvScore: 12,
      v3DivAndPeScore: 8,
      m1PriceMomScore: 10,
      m2FundMomScore: 10,
      m3TrendFilterScore: 5,
    });
    expect(card.sQ + card.sV + card.sM).toBe(100);
  });
});

describe('Fin-QVM v1.0 銀行與金控特化評分模組測試', () => {
  it('10. Justified P/B 防發散測試：極端高 ROE 導致未截斷 g >= ke 時必須截斷，絕無 NaN/Infinity/負值', async () => {
    const { computeJustifiedPB } = await import('../financialScoring');

    // ROE=32%, payout=0%, ke=8% -> 未截斷 g=32% >= ke=8%，必須截斷至 <= 5% (且 <= ke - 2.5%)
    const res = computeJustifiedPB({
      avgRoePct: 32,
      payoutRatioPct: 0,
      kePct: 8.0,
    });
    expect(res.sustainableGrowthGPct).not.toBeNull();
    expect(res.sustainableGrowthGPct!).toBeLessThanOrEqual(5.0);
    expect(res.justifiedPB).not.toBeNull();
    expect(Number.isFinite(res.justifiedPB!)).toBe(true);
    expect(res.justifiedPB!).toBeGreaterThan(0);

    // ROE <= 0 -> null
    const negRes = computeJustifiedPB({ avgRoePct: -3, payoutRatioPct: 50, kePct: 8 });
    expect(negRes.justifiedPB).toBeNull();
  });

  it('11. 金融階段零紅線測試：DLR=126% / 覆蓋率=95% / D-SIBs CET1=9.0% 必判 F+P0；欄位為 null 不誤判 F 但標記未驗證', async () => {
    const { evaluateFinancialRating, evaluateFinancialStageZero } = await import(
      '../financialScoring'
    );
    const bankStock = MOCK_TW_STOCKS.find((s) => s.symbol === '2886')!;
    const baseFin = bankStock.financialMetrics!;

    // (a) DLR = 126% -> F 級 + P0
    const dlrFail = evaluateFinancialRating({
      profile: 'financial_bank',
      regime: 'NORMAL',
      commonStageZeroInput: bankStock.stageZeroInput,
      metrics: { ...baseFin, doubleLeverageRatioPct: 126 },
      price: bankStock.price,
      ma200: bankStock.ma200,
    });
    expect(dlrFail.finalGrade).toBe('F');

    const dlrExit = adviseHoldingExit({
      holding: {
        id: 'H-FIN-DLR',
        symbol: '2886',
        name: '銀行',
        sector: '金融保險業',
        valuationProfile: 'financial_bank',
        shares: 2000,
        costPrice: 40,
        currentPrice: 40.5,
        highestPriceSinceEntry: 41,
        atr20: 0.6,
        ma60: 39.8,
        ma120: 39,
        ma200: 38.2,
        daysBelow200Ma: 0,
        moatPermanentlyBroken: false,
        stopDrawdownThresholdPct: 15,
        currentRating: evaluateRating({
          breakdown: { sQ: 35, sV: 35, sM: 18 },
          regime: 'NORMAL',
          stageZero: dlrFail.stageZero,
        }),
        currentBreakdown: { sQ: 35, sV: 35, sM: 18 },
        financialMetrics: { ...baseFin, doubleLeverageRatioPct: 126 },
        financialRating: dlrFail,
      },
      totalActivePortfolioValue: 1_000_000,
    });
    expect(dlrExit.primaryPriority).toBe('P0');

    // (b) 覆蓋率 = 95% (< 100%) -> F 級
    const covFail = evaluateFinancialStageZero({
      profile: 'financial_bank',
      commonInput: bankStock.stageZeroInput,
      finMetrics: { ...baseFin, nplCoverageRatioPct: 95 },
    });
    expect(covFail.passed).toBe(false);
    expect(covFail.gradeOverride).toBe('F');

    // (c) D-SIBs CET1 = 9.0% (< 9.5%) -> F 級
    const cet1Fail = evaluateFinancialStageZero({
      profile: 'financial_bank',
      commonInput: bankStock.stageZeroInput,
      finMetrics: { ...baseFin, isDsib: true, bankCet1Pct: 9.0 },
    });
    expect(cet1Fail.passed).toBe(false);
    expect(cet1Fail.gradeOverride).toBe('F');

    // (d) 監理欄位為 null -> 不誤判 F 級，但 hasUnverifiedRegulatoryFields === true 且禁止買進
    const nullRating = evaluateFinancialRating({
      profile: 'financial_bank',
      regime: 'NORMAL',
      commonStageZeroInput: bankStock.stageZeroInput,
      metrics: { ...baseFin, fhcCarPct: null, bankCet1Pct: null, nplRatioPct: null },
      price: bankStock.price,
      ma200: bankStock.ma200,
    });
    expect(nullRating.finalGrade).not.toBe('F');
    expect(nullRating.hasUnverifiedRegulatoryFields).toBe(true);
    const nullEntry = adviseEntry(nullRating);
    expect(nullEntry.allowEntry).toBe(false);
    expect(nullEntry.actionTitle).toContain('未完成完整防雷驗證');
  });

  it('12. 金融高息陷阱熔斷器與 P1-F 測試：範例 10 鎖死 C 級，尚未破 200MA 仍優先輸出 P1-F', async () => {
    const { evaluateFinancialRating } = await import('../financialScoring');
    const trapFin = MOCK_TW_STOCKS.find((s) => s.symbol === '2888')!;
    const trapRating = evaluateFinancialRating({
      profile: 'financial_life_fhc',
      regime: 'NORMAL',
      commonStageZeroInput: trapFin.stageZeroInput,
      metrics: trapFin.financialMetrics!,
      price: trapFin.price,
      ma200: trapFin.ma200,
    });
    expect(trapRating.isFinancialTrapCircuitBreakerTriggered).toBe(true);
    expect(['C', 'D']).toContain(trapRating.finalGrade);

    // 驗證若原始評分達 B/A 級但觸發 OCI+現增稀釋熔斷器時，必強制鎖死為 C 級
    const goodBank = MOCK_TW_STOCKS.find((s) => s.symbol === '2886')!;
    const bankTrap = evaluateFinancialRating({
      profile: 'financial_bank',
      regime: 'NORMAL',
      commonStageZeroInput: goodBank.stageZeroInput,
      metrics: {
        ...goodBank.financialMetrics!,
        ociRestrictsDividend: true,
        recentDilutiveOfferingPct: 12.5,
      },
      price: goodBank.price,
      ma200: goodBank.ma200,
    });
    expect(bankTrap.baseGrade === 'A' || bankTrap.baseGrade === 'B').toBe(true);
    expect(bankTrap.isFinancialTrapCircuitBreakerTriggered).toBe(true);
    expect(bankTrap.finalGrade).toBe('C');

    // 範例 10 持倉尚未跌破 200MA (daysBelow200Ma === 0)，仍必優先輸出 P1-F
    const trapHolding = MOCK_TW_HOLDINGS.find((h) => h.symbol === '2888')!;
    expect(trapHolding.daysBelow200Ma).toBe(0);
    expect(trapHolding.currentPrice).toBeGreaterThan(trapHolding.ma200);
    const exit = adviseHoldingExit({
      holding: trapHolding,
      totalActivePortfolioValue: 2_000_000,
    });
    expect(exit.primaryPriority).toBe('P1-F');

    // 驗證範例 9 優質銀行獲 A 級
    const goodRating = evaluateFinancialRating({
      profile: 'financial_bank',
      regime: 'NORMAL',
      commonStageZeroInput: goodBank.stageZeroInput,
      metrics: goodBank.financialMetrics!,
      price: goodBank.price,
      ma200: goodBank.ma200,
    });
    expect(goodRating.finalGrade).toBe('A');
  });

  it('13. 金融防禦模式 (45/45/10) 權重歸一化測試：滿分嚴格等於 100', async () => {
    const { computeFinancialFinalScore } = await import('../financialScoring');
    expect(computeFinancialFinalScore({ sFQ: 40, sFV: 40, sFM: 20 }, 'DEFENSIVE')).toBe(100);
    expect(computeFinancialFinalScore({ sFQ: 40, sFV: 40, sFM: 20 }, 'NORMAL')).toBe(100);
  });
});

