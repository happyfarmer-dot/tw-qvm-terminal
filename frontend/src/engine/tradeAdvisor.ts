import type {
  CyclicalRatingResult,
  EntryPlan,
  ExitDecision,
  ExitPriority,
  FinancialRatingResult,
  HoldingPosition,
  RatingResult,
  TwFrictionConfig,
} from './types';

export interface TwFrictionCostResult {
  buyFee: number;
  sellFee: number;
  securitiesTax: number;
  slippageCost: number;
  totalRoundTripCost: number;
  sellSideCost: number;
  roundTripRatePct: number;
  sellSideRatePct: number;
}

export function calculateTwFrictionCost(
  tradeValue: number,
  config: Partial<TwFrictionConfig> = {}
): TwFrictionCostResult {
  const safeVal = Number.isFinite(tradeValue) && tradeValue > 0 ? tradeValue : 0;
  const discount =
    typeof config.feeDiscount === 'number' && Number.isFinite(config.feeDiscount)
      ? Math.max(0, Math.min(1, config.feeDiscount))
      : 0.6;
  const applyMin20 = config.applyMinFee20 ?? false;
  const slippagePct =
    typeof config.slippageRoundTripPct === 'number' && Number.isFinite(config.slippageRoundTripPct)
      ? Math.max(0, config.slippageRoundTripPct)
      : 0.15;

  const rawFee = Math.round(safeVal * 0.001425 * discount);
  const buyFee = safeVal > 0 ? (applyMin20 ? Math.max(20, rawFee) : rawFee) : 0;
  const sellFee = safeVal > 0 ? (applyMin20 ? Math.max(20, rawFee) : rawFee) : 0;
  const securitiesTax = Math.round(safeVal * 0.003);
  const slippageCost = Math.round(safeVal * (slippagePct / 100));
  const halfSlip = Math.round(slippageCost / 2);

  const totalRoundTripCost = buyFee + sellFee + securitiesTax + slippageCost;
  const sellSideCost = sellFee + securitiesTax + halfSlip;

  return {
    buyFee,
    sellFee,
    securitiesTax,
    slippageCost,
    totalRoundTripCost,
    sellSideCost,
    roundTripRatePct: safeVal > 0 ? Number(((totalRoundTripCost / safeVal) * 100).toFixed(4)) : 0,
    sellSideRatePct: safeVal > 0 ? Number(((sellSideCost / safeVal) * 100).toFixed(4)) : 0,
  };
}

function isCyclicalRating(
  r: RatingResult | CyclicalRatingResult | FinancialRatingResult
): r is CyclicalRatingResult {
  return 'profile' in r && (r.profile === 'cyclical_heavy_asset' || r.profile === 'cyclical_inventory_order');
}

function isFinancialRating(
  r: RatingResult | CyclicalRatingResult | FinancialRatingResult
): r is FinancialRatingResult {
  return 'profile' in r && (r.profile === 'financial_bank' || r.profile === 'financial_life_fhc');
}

/**
 * 空手買進 SOP 決策（相容標準 QVM、循環 Cyclical-QVM 與金融 Fin-QVM）
 */
export function adviseEntry(
  rating: RatingResult | CyclicalRatingResult | FinancialRatingResult
): EntryPlan {
  const firstPct = Math.round(rating.firstTranchePct * 100);
  const secondPct = 100 - firstPct;
  const cyclical = isCyclicalRating(rating);
  const financial = isFinancialRating(rating);

  const twSpecificNotes = [
    '台股交易紀律：避開開盤前 15 分鐘（09:00–09:15）流動性劇烈波動時段。',
    '台股禁止追價：漲停鎖死當日不追價，等待隔日或量縮回測支撐再執行。',
    financial
      ? '金融股紀律：買進前請於 MOPS 核對最新季報資本適足率 (CAR/CET1)、NPL 與雙重槓桿比，並留意除權息後填息能力。'
      : cyclical
        ? '循環股紀律：進場前請至 MOPS 財報附註確認存貨細項（原物料／製成品）及預收款項／運價指標。'
        : '每月 10 日月營收公告後檢核 M2 動能是否持續。',
  ];

  if (!rating.stageZero.passed) {
    return {
      allowEntry: false,
      actionTitle: '禁止買進（觸發階段零 F 級紅燈）',
      firstTranchePct: 0,
      secondTranchePct: 0,
      secondTrancheChecklist: [],
      twSpecificNotes,
      blockedReasons: rating.stageZero.redFlags.map((f) => `${f.title}：${f.detail}`),
    };
  }

  if (financial && rating.hasUnverifiedRegulatoryFields) {
    return {
      allowEntry: false,
      actionTitle: '未完成完整防雷驗證，禁止直接執行實盤買進',
      firstTranchePct: 0,
      secondTranchePct: 0,
      secondTrancheChecklist: [],
      twSpecificNotes,
      blockedReasons: [
        '尚有金融監理指標為 null，請先至「MOPS 監理數據抽屜」補齊 CAR、CET1、DLR、NPL 與覆蓋率：',
        ...rating.stageZero.pendingManualChecks,
      ],
    };
  }

  if (cyclical && rating.isPeakCircuitBreakerTriggered) {
    return {
      allowEntry: false,
      actionTitle: '禁止買進（觸發景氣過熱熔斷器 — 強制鎖死 C 級）',
      firstTranchePct: 0,
      secondTranchePct: 0,
      secondTrancheChecklist: [],
      twSpecificNotes,
      blockedReasons: rating.peakCircuitBreakerReasons,
    };
  }

  if (financial && rating.isFinancialTrapCircuitBreakerTriggered) {
    return {
      allowEntry: false,
      actionTitle: '禁止買進（觸發金融高息假象／信用惡化熔斷器 — 鎖死 C 級）',
      firstTranchePct: 0,
      secondTranchePct: 0,
      secondTrancheChecklist: [],
      twSpecificNotes,
      blockedReasons: rating.financialTrapReasons,
    };
  }

  // 優質銀行股左側分批許可檢核
  let defensiveLeftSideEntryAllowed = false;
  let defensiveLeftSideMessage: string | undefined;
  if (
    financial &&
    rating.profile === 'financial_bank' &&
    rating.breakdown.sFQ >= 32 &&
    !rating.isFinancialTrapCircuitBreakerTriggered &&
    rating.recalculatedPbValuationRatio !== null &&
    rating.recalculatedPbValuationRatio <= 0.8
  ) {
    defensiveLeftSideEntryAllowed = true;
    defensiveLeftSideMessage =
      '防禦性左側存股許可：體質極優（FQ >= 32/40）且深度折價（P/B <= 0.80× Justified P/B），允許以第一批 30% 階梯式左側建倉。';
  }

  if (rating.finalGrade !== 'A') {
    if (defensiveLeftSideEntryAllowed) {
      return {
        allowEntry: true,
        actionTitle: `${rating.finalGrade} 級但符合優質銀行深度折價條件（允許左側試建 30%）`,
        firstTranchePct: 30,
        secondTranchePct: 70,
        secondTrancheChecklist: [
          '確認次季 MOPS 資本適足率 (CAR/CET1) 與逾放覆蓋率未下滑。',
          '股價回穩並站上 60MA 或 200MA 轉強後補齊剩餘部位。',
        ],
        twSpecificNotes,
        blockedReasons: [],
        defensiveLeftSideEntryAllowed,
        defensiveLeftSideMessage,
      };
    }

    const reasons = [
      `目前最終評級為 ${rating.finalGrade} 級（總分 ${rating.finalScore.toFixed(1)}），未達 A 級（>= 80 且無偏科）門檻，禁止新開倉。`,
      ...rating.antiBiasReasons,
    ];
    return {
      allowEntry: false,
      actionTitle: `${rating.finalGrade} 級禁止新開倉（列入觀察或淘汰）`,
      firstTranchePct: 0,
      secondTranchePct: 0,
      secondTrancheChecklist: [],
      twSpecificNotes,
      blockedReasons: reasons,
    };
  }

  return {
    allowEntry: true,
    actionTitle: `A 級核准建倉（${rating.regime === 'DEFENSIVE' ? '防禦體制' : '常態體制'}：第一批 ${firstPct}%）`,
    firstTranchePct: firstPct,
    secondTranchePct: secondPct,
    secondTrancheChecklist: [
      '第一批建倉滿 20–40 個交易日，或經下一次月營收（每月 10 日）／季報驗證。',
      financial
        ? '下季 MOPS 監理雙率（NPL、覆蓋率、CET1、DLR）維持安全緩衝且無 OCI 配息限制。'
        : cyclical
          ? 'DIO 存貨週轉天數維持下降趨勢且單季毛利率 QoQ 未轉負。'
          : 'M2 近 3 個月累計營收 YoY 未轉弱。',
      '股價未跌破成本 - 2.5 × ATR20 或結構停損線。',
      '最新綜合評分維持 >= 75 分且未觸發熔斷或階段零紅燈。',
    ],
    twSpecificNotes,
    blockedReasons: [],
    defensiveLeftSideEntryAllowed,
    defensiveLeftSideMessage,
  };
}

const PRIORITY_RANK: Record<ExitPriority, number> = {
  P0: 0,
  'P1-F': 1,
  'P1-C': 2,
  P1: 3,
  P2: 4,
  P3: 5,
  P4: 6,
  HOLD: 7,
};

export interface OpportunityCandidate {
  symbol: string;
  name: string;
  finalScore: number;
}

/**
 * 既有持股出場優先序決策矩陣：
 * P0 > P1-F（金融信用/資本惡化） > P1-C（循環週期見頂） > P1 > P2 > P3 > P4 > HOLD
 */
export function adviseHoldingExit(params: {
  holding: HoldingPosition;
  totalActivePortfolioValue: number;
  isFullInvested?: boolean;
  bestNewACandidate?: OpportunityCandidate | null;
  isLowestScoringHolding?: boolean;
  frictionConfig?: Partial<TwFrictionConfig>;
}): ExitDecision {
  const {
    holding,
    totalActivePortfolioValue,
    isFullInvested = false,
    bestNewACandidate = null,
    isLowestScoringHolding = false,
    frictionConfig = {},
  } = params;

  const safePrice = Number.isFinite(holding.currentPrice) && holding.currentPrice > 0 ? holding.currentPrice : 0;
  const safeCost = Number.isFinite(holding.costPrice) && holding.costPrice > 0 ? holding.costPrice : safePrice;
  const safeShares = Number.isFinite(holding.shares) && holding.shares > 0 ? holding.shares : 0;
  const marketValue = safePrice * safeShares;
  const safePortfolioVal =
    Number.isFinite(totalActivePortfolioValue) && totalActivePortfolioValue > 0
      ? totalActivePortfolioValue
      : Math.max(marketValue, 1);

  const positionWeightPct = Number(((marketValue / safePortfolioVal) * 100).toFixed(2));
  const rawPnl = (safePrice - safeCost) * safeShares;
  const portfolioLossImpactPct =
    rawPnl < 0 ? Number(((Math.abs(rawPnl) / safePortfolioVal) * 100).toFixed(2)) : 0;
  const drawdownFromCostPct =
    safeCost > 0 ? ((safeCost - safePrice) / safeCost) * 100 : 0;

  const isFinancial =
    holding.valuationProfile === 'financial_bank' ||
    holding.valuationProfile === 'financial_life_fhc';
  const isCyclical =
    holding.valuationProfile === 'cyclical_heavy_asset' ||
    holding.valuationProfile === 'cyclical_inventory_order';

  const effectiveScore =
    isFinancial && holding.financialRating
      ? holding.financialRating.finalScore
      : isCyclical && holding.cyclicalRating
        ? holding.cyclicalRating.finalScore
        : holding.currentRating.finalScore;

  const effectiveQualityRatioPct =
    isFinancial && holding.financialRating
      ? holding.financialRating.fqRatioPct
      : isCyclical && holding.cyclicalRating
        ? holding.cyclicalRating.cqRatioPct
        : holding.currentRating.qRatioPct;

  const effectiveStageZero =
    isFinancial && holding.financialRating
      ? holding.financialRating.stageZero
      : isCyclical && holding.cyclicalRating
        ? holding.cyclicalRating.stageZero
        : holding.currentRating.stageZero;

  const triggeredSignals: { priority: ExitPriority; title: string; detail: string }[] = [];

  // 1. P0: 階段零紅燈 OR 護城河永久證偽
  if (!effectiveStageZero.passed || holding.moatPermanentlyBroken) {
    const reasons: string[] = [];
    if (!effectiveStageZero.passed) {
      reasons.push(
        `觸發階段零紅燈：${effectiveStageZero.redFlags.map((r) => r.title).join('、')}`
      );
    }
    if (holding.moatPermanentlyBroken) {
      reasons.push('使用者標記「護城河永久證偽」');
    }
    triggeredSignals.push({
      priority: 'P0',
      title: 'P0 緊急清倉（一票否決／護城河破滅）',
      detail: `${reasons.join('；')} → 必須於 1–3 個交易日內無條件全數清倉（跌停鎖死則次日優先出清）。`,
    });
  }

  // 2. P1-F: 金融信用／資本惡化提前警戒 (P0 > P1-F > P1)
  if (isFinancial && holding.financialMetrics) {
    const fm = holding.financialMetrics;
    const creditBad =
      fm.nplConsecutiveRiseQuarters !== null &&
      fm.nplConsecutiveRiseQuarters >= 2 &&
      fm.nplCoverageRatioPct !== null &&
      fm.nplCoverageRatioPct < 300;
    const capitalDilutiveBad =
      fm.fhcCarPct !== null &&
      fm.fhcCarPct < 110 &&
      fm.recentDilutiveOfferingPct !== null &&
      fm.recentDilutiveOfferingPct > 10;

    if (creditBad || capitalDilutiveBad) {
      triggeredSignals.push({
        priority: 'P1-F',
        title: 'P1-F 金融信用／資本惡化提前警戒',
        detail:
          '金融體質警戒：資產品質或資本緩衝顯著惡化，不等跌破 200MA，立即減碼 50% 至全數撤出。',
      });
    }
  }

  // 3. P1-C: 循環股週期見頂提前減碼
  let cyclicalTrailingStop: number | undefined;
  if (isCyclical && holding.cyclicalMetrics) {
    const cm = holding.cyclicalMetrics;
    const highPbPeak =
      (cm.pbPercentile5to7Y !== null && cm.pbPercentile5to7Y >= 80) ||
      holding.cyclicalRating?.isPeakCircuitBreakerTriggered === true;
    const reversalSign =
      (cm.grossMarginQoQ !== null && cm.grossMarginQoQ < 0) ||
      (cm.consecutiveDioRiseQuarters !== null && cm.consecutiveDioRiseQuarters >= 2) ||
      safePrice < holding.ma60;

    if (highPbPeak && reversalSign) {
      cyclicalTrailingStop = Number(
        Math.max(0, holding.highestPriceSinceEntry - 2.0 * Math.max(0, holding.atr20)).toFixed(2)
      );
      triggeredSignals.push({
        priority: 'P1-C',
        title: 'P1-C 週期見頂提前減碼（高 P/B 位階＋反轉訊號）',
        detail: `週期見頂警戒：立即主動減碼 50% 鎖定利潤，剩餘部位將移動停利收緊為「最高價回撤 2.0 倍 20 日 ATR」（${cyclicalTrailingStop} 元），切勿等待跌破 200MA。`,
      });
    }
  }

  // 4. P1: 結構防禦停損
  const atrStopPrice = safeCost - 2.5 * Math.max(0, holding.atr20);
  const stopDdLimit =
    Number.isFinite(holding.stopDrawdownThresholdPct) && holding.stopDrawdownThresholdPct > 0
      ? holding.stopDrawdownThresholdPct
      : 15;
  const hitPriceStop = safePrice < atrStopPrice || drawdownFromCostPct >= stopDdLimit;
  const hit200MaBreak = holding.daysBelow200Ma >= 5 && safePrice < holding.ma200;

  if (hitPriceStop && hit200MaBreak) {
    triggeredSignals.push({
      priority: 'P1',
      title: 'P1 結構防禦停損（破價＋連 5 日低於 200MA）',
      detail: `現價 (${safePrice.toFixed(2)}) 觸及停損條件（成本-2.5ATR=${atrStopPrice.toFixed(2)} 或回撤 ${drawdownFromCostPct.toFixed(1)}% >= ${stopDdLimit}%），且連續 ${holding.daysBelow200Ma} 日低於 200MA (${holding.ma200.toFixed(2)})。對總資金虧損影響 ${portfolioLossImpactPct.toFixed(2)}%。`,
    });
  }

  // 5. P2: 評分淘汰 (< 65 或 品質得分率 < 40%)
  if (effectiveScore < 65 || effectiveQualityRatioPct < 40) {
    triggeredSignals.push({
      priority: 'P2',
      title: 'P2 評分淘汰（綜合評分 < 65 或品質不足 40%）',
      detail: `目前評分 ${effectiveScore.toFixed(1)} 分、品質得分率 ${effectiveQualityRatioPct.toFixed(1)}%，應於下一個季度 PIT 評檢窗口全數賣出。`,
    });
  }

  // 6. P3: 估值泡沫／權重超限（金融股專用門檻 vs 一般門檻）
  let valBubble = false;
  if (isFinancial && holding.financialMetrics) {
    const pbRatio =
      holding.financialRating?.recalculatedPbValuationRatio ??
      holding.financialMetrics.pbValuationRatio;
    const pbPct = holding.financialMetrics.pbPercentile5to7Y;
    const finOvervalued =
      (pbRatio !== null && pbRatio >= 1.3) || (pbPct !== null && pbPct >= 90);
    valBubble = finOvervalued && safePrice < holding.ma60;
  } else {
    valBubble = holding.currentBreakdown.sV < 8 && safePrice < holding.ma60;
  }

  const overweight = positionWeightPct > 12;
  let standardTrailingStop: number | undefined;

  if (valBubble || overweight) {
    const p3Parts: string[] = [];
    if (valBubble) {
      standardTrailingStop = Number(
        Math.max(0, holding.highestPriceSinceEntry - 3.0 * Math.max(0, holding.atr20)).toFixed(2)
      );
      p3Parts.push(
        isFinancial
          ? `金融估值偏貴（P/B >= 1.30× Justified 或歷史 90% 高檔）且跌破 60MA，分批減碼 50% 並掛 3×ATR 移動停利 ${standardTrailingStop} 元`
          : `價值得分率 ${holding.currentRating.vRatioPct.toFixed(1)}% (< 23%) 且跌破季線 (${holding.ma60.toFixed(2)})，分批減碼 50% 並掛 3×ATR 移動停利 ${standardTrailingStop} 元`
      );
    }
    if (overweight) {
      p3Parts.push(
        `單股權重達 ${positionWeightPct.toFixed(1)}%（> 12% 上限），賣出超額部位壓回 8%–10%（目標 9%）`
      );
    }
    triggeredSignals.push({
      priority: 'P3',
      title: 'P3 估值泡沫／權重超限調節',
      detail: p3Parts.join('；'),
    });
  }

  // 7. P4: 機會成本置換
  const frictionFull = calculateTwFrictionCost(marketValue, frictionConfig);
  if (
    isFullInvested &&
    isLowestScoringHolding &&
    bestNewACandidate &&
    bestNewACandidate.finalScore - effectiveScore >= 20
  ) {
    const spread = bestNewACandidate.finalScore - effectiveScore;
    triggeredSignals.push({
      priority: 'P4',
      title: 'P4 機會成本置換（汰弱留強）',
      detail: `滿倉且新 A 級候選 ${bestNewACandidate.symbol} (${bestNewACandidate.finalScore.toFixed(1)}分) 領先本持股 ${spread.toFixed(1)} 分 (>= 20分)，扣除台股雙邊摩擦成本 ${frictionFull.roundTripRatePct.toFixed(2)}% 後仍具淨優勢。`,
    });
  }

  triggeredSignals.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const primaryPriority: ExitPriority =
    triggeredSignals.length > 0 ? triggeredSignals[0].priority : 'HOLD';

  let recommendedSellPct = 0;
  let actionLabel = '原地續抱（緩衝區保護）';
  let actionDetail = '';
  let bufferProtected = false;
  let trailingStopPrice: number | undefined;

  if (primaryPriority === 'P0') {
    recommendedSellPct = 100;
    actionLabel = 'P0 緊急全數清倉 (1–3日內)';
    actionDetail = triggeredSignals[0].detail;
  } else if (primaryPriority === 'P1-F') {
    recommendedSellPct = 50;
    actionLabel = 'P1-F 金融信用／資本惡化減碼 (50%–100%)';
    actionDetail = triggeredSignals[0].detail;
  } else if (primaryPriority === 'P1-C') {
    recommendedSellPct = 50;
    trailingStopPrice = cyclicalTrailingStop;
    actionLabel = 'P1-C 週期見頂提前減碼 50%';
    actionDetail = triggeredSignals[0].detail;
  } else if (primaryPriority === 'P1') {
    recommendedSellPct = drawdownFromCostPct >= stopDdLimit ? 100 : 50;
    actionLabel = `P1 強制結構停損 (減碼 ${recommendedSellPct}%)`;
    actionDetail = triggeredSignals[0].detail;
  } else if (primaryPriority === 'P2') {
    recommendedSellPct = 100;
    actionLabel = 'P2 季度窗口全數淘汰';
    actionDetail = triggeredSignals[0].detail;
  } else if (primaryPriority === 'P3') {
    trailingStopPrice = standardTrailingStop;
    if (valBubble && overweight) {
      const trimWeight = ((positionWeightPct - 9) / positionWeightPct) * 100;
      recommendedSellPct = Number(Math.min(100, Math.max(50, trimWeight)).toFixed(1));
    } else if (valBubble) {
      recommendedSellPct = 50;
    } else {
      recommendedSellPct = Number((((positionWeightPct - 9) / positionWeightPct) * 100).toFixed(1));
    }
    actionLabel = `P3 減碼調節 (${recommendedSellPct}%)`;
    actionDetail = triggeredSignals[0].detail;
  } else if (primaryPriority === 'P4') {
    recommendedSellPct = 100;
    actionLabel = `P4 換股置換 -> ${bestNewACandidate?.symbol}`;
    actionDetail = triggeredSignals[0].detail;
  } else {
    if (effectiveScore >= 65 && effectiveScore < 80) {
      bufferProtected = true;
      actionLabel = '原地續抱（緩衝區保護）';
      actionDetail = `目前評分 ${effectiveScore.toFixed(1)} 分（介於 65–79 分緩衝區），未觸發 P0/P1-F/P1-C/P1/P3 紅線，強制續抱以避免過度換手耗損台股稅費（雙邊摩擦率約 ${frictionFull.roundTripRatePct.toFixed(2)}%）。`;
    } else {
      actionLabel = '核心續抱（結構良好）';
      actionDetail = `目前評分 ${effectiveScore.toFixed(1)} 分達 A 級標準且無出場警訊，維持倉位並持續追蹤月營收／季報。`;
    }
  }

  const recommendedSellShares =
    recommendedSellPct >= 100
      ? safeShares
      : Math.floor((safeShares * recommendedSellPct) / 100);
  const estimatedProceeds = Math.round(recommendedSellShares * safePrice);
  const sellCostObj = calculateTwFrictionCost(estimatedProceeds, frictionConfig);

  return {
    holdingId: holding.id,
    symbol: holding.symbol,
    name: holding.name,
    primaryPriority,
    actionLabel,
    actionDetail,
    recommendedSellShares,
    recommendedSellPct,
    estimatedProceeds,
    estimatedFrictionCost: sellCostObj.sellSideCost,
    frictionCostRatePct: sellCostObj.sellSideRatePct,
    trailingStopPrice,
    portfolioLossImpactPct,
    positionWeightPct,
    triggeredSignals,
    bufferProtected,
  };
}

export interface TwPitReminder {
  nextQuarterlyDate: string;
  daysUntilQuarterly: number;
  nextMonthlyRevDate: string;
  daysUntilMonthlyRev: number;
  label: string;
}

export function getNextTwPitReviewDate(refDate = new Date()): TwPitReminder {
  const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const year = today.getFullYear();

  const anchors = [
    [4, 1],
    [5, 16],
    [8, 15],
    [11, 15],
  ];

  const candidateDates: Date[] = [];
  for (const y of [year, year + 1]) {
    for (const [m, d] of anchors) {
      candidateDates.push(new Date(y, m - 1, d));
    }
  }
  candidateDates.sort((a, b) => a.getTime() - b.getTime());

  const nextQ = candidateDates.find((d) => d.getTime() >= today.getTime()) ?? candidateDates[0];
  const daysUntilQuarterly = Math.max(
    0,
    Math.round((nextQ.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  );
  const nextQuarterlyDate = `${nextQ.getFullYear()}-${String(nextQ.getMonth() + 1).padStart(2, '0')}-${String(nextQ.getDate()).padStart(2, '0')}`;

  let revMonth = today.getMonth();
  let revYear = year;
  if (today.getDate() > 10) {
    revMonth += 1;
    if (revMonth > 11) {
      revMonth = 0;
      revYear += 1;
    }
  }
  const nextRev = new Date(revYear, revMonth, 10);
  const daysUntilMonthlyRev = Math.max(
    0,
    Math.round((nextRev.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  );
  const nextMonthlyRevDate = `${nextRev.getFullYear()}-${String(nextRev.getMonth() + 1).padStart(2, '0')}-10`;

  return {
    nextQuarterlyDate,
    daysUntilQuarterly,
    nextMonthlyRevDate,
    daysUntilMonthlyRev,
    label: `下次季報評檢 ${nextQuarterlyDate} (${daysUntilQuarterly} 天)｜月營收防雷 ${nextMonthlyRevDate} (${daysUntilMonthlyRev} 天)`,
  };
}
