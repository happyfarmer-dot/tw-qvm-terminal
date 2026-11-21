import type {
  Grade,
  HealthDimension,
  HealthDimensionMetric,
  HealthReport,
  HealthSafetyItem,
  MarketRegime,
  TwStockCandidate,
  ValuationProfile,
} from './types';

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function fmtNum(val: number | null | undefined, decimals = 1, suffix = ''): string {
  if (!isFiniteNum(val)) return '待確認';
  return `${val.toFixed(decimals)}${suffix}`;
}

function fmtMoneyYi(valTwd: number | null | undefined): string {
  if (!isFiniteNum(valTwd)) return '待確認';
  const yi = valTwd / 1e8;
  return `${yi.toFixed(2)} 億元`;
}

export function getProfileDisplayLabel(profile: ValuationProfile): string {
  if (profile === 'cyclical_heavy_asset') return '強景氣循環（重資產／航運面板記憶體）';
  if (profile === 'cyclical_inventory_order') return '強景氣循環（存貨與訂單領先型）';
  if (profile === 'financial_bank') return '銀行與官股金控穩健收息型';
  if (profile === 'financial_life_fhc') return '壽險雙引擎金控型';
  return '標準高品質成長型';
}

function gradeTextFromPct(pct: number): string {
  if (pct >= 78) return '表現優異';
  if (pct >= 60) return '表現穩健';
  if (pct >= 42) return '表現普通';
  return '偏弱警戒';
}

/**
 * 若 candidate 已由 Python 管線預先產出 healthReport，則直接回傳（並依當前市場體制微調首倉比例）；
 * 若為 CSV 匯入或舊版快取缺少 healthReport，則即時自動生成結構一致的白話《個股深度健檢報告書》。
 */
export function ensureStockHealthReport(
  stock: TwStockCandidate,
  regime: MarketRegime = 'NORMAL',
  fallbackDate = new Date().toISOString().slice(0, 10)
): HealthReport {
  if (stock.healthReport) {
    const canBuy = stock.healthReport.actionPlan.buyStrategy.canBuyNow;
    const expectedTranche = canBuy ? (regime === 'DEFENSIVE' ? 30 : 50) : 0;
    if (stock.healthReport.actionPlan.buyStrategy.firstTranchePct === expectedTranche) {
      return stock.healthReport;
    }
    return {
      ...stock.healthReport,
      actionPlan: {
        ...stock.healthReport.actionPlan,
        buyStrategy: {
          ...stock.healthReport.actionPlan.buyStrategy,
          firstTranchePct: expectedTranche,
        },
      },
    };
  }

  const profile = stock.recommendedProfile;
  const isFin = profile === 'financial_bank' || profile === 'financial_life_fhc';
  const isCyc = profile === 'cyclical_heavy_asset' || profile === 'cyclical_inventory_order';
  const sz = stock.stageZeroInput;
  const cyc = stock.cyclicalMetrics;
  const fin = stock.financialMetrics;

  const safetyCheckup: HealthSafetyItem[] = [];
  const fatalReasons: string[] = [];

  const toVal = sz.avgDailyTurnover20dTWD;
  const toYi = isFiniteNum(toVal) ? toVal / 1e8 : null;
  if (sz.isDispositionStock === true) {
    fatalReasons.push('目前列為處置股');
    safetyCheckup.push({
      itemName: '市場流動性安全',
      displayValue: `${fmtMoneyYi(toVal)}｜處置股`,
      status: 'fail',
      plainExplanation: '目前列為交易所處置股（分盤交易），短線波動與流動性風險極高。',
    });
  } else if (toYi !== null && toYi < 0.3) {
    fatalReasons.push('日均成交額低於 3,000 萬元底線');
    safetyCheckup.push({
      itemName: '市場流動性安全',
      displayValue: `${fmtMoneyYi(toVal)}｜量能偏低`,
      status: 'fail',
      plainExplanation: `近 20 日均成交額僅 ${fmtMoneyYi(toVal)}（低於 0.3 億元安全底線），易有流動性風險。`,
    });
  } else {
    safetyCheckup.push({
      itemName: '市場流動性安全',
      displayValue: `${fmtMoneyYi(toVal)}｜正常交易`,
      status: toYi !== null ? 'pass' : 'unknown',
      plainExplanation:
        toYi !== null
          ? `近 20 日均成交額達 ${fmtMoneyYi(toVal)} 且非處置股，市場交投活絡、資金進出安全。`
          : '成交額資料待同步，目前無處置分盤警示。',
    });
  }

  const pledge = sz.directorPledgeRatio;
  if (isFiniteNum(pledge) && pledge >= 70) {
    fatalReasons.push('董監事設質比例超過 70%');
    safetyCheckup.push({
      itemName: '大股東籌碼安定度',
      displayValue: `設質比 ${pledge.toFixed(1)}%`,
      status: 'fail',
      plainExplanation: `董監事持股設質比例高達 ${pledge.toFixed(1)}%（超過 70% 危險紅線），具質押斷頭風險。`,
    });
  } else if (isFiniteNum(pledge) && pledge >= 30) {
    safetyCheckup.push({
      itemName: '大股東籌碼安定度',
      displayValue: `設質比 ${pledge.toFixed(1)}%`,
      status: 'warn',
      plainExplanation: `董監事設質比例為 ${pledge.toFixed(1)}%（介於 30%–69% 警戒區），建議留意大股東財務槓桿。`,
    });
  } else {
    safetyCheckup.push({
      itemName: '大股東籌碼安定度',
      displayValue: isFiniteNum(pledge) ? `設質比 ${pledge.toFixed(1)}%` : '無異常設質通報',
      status: isFiniteNum(pledge) ? 'pass' : 'unknown',
      plainExplanation: isFiniteNum(pledge)
        ? `董監事設質比例僅 ${pledge.toFixed(1)}%（低於 30% 安全標準），大股東籌碼結構安定。`
        : '公開資訊未檢出高比例設質異常，籌碼結構無明顯警訊。',
    });
  }

  if (isFin) {
    const roe5 = fin?.avgRoe5Y ?? null;
    safetyCheckup.push({
      itemName: '長期獲利穩定度（5 年平均 ROE）',
      displayValue: isFiniteNum(roe5) ? `5年均 ROE ${roe5.toFixed(1)}%` : '財報序列整理中',
      status: isFiniteNum(roe5) ? (roe5 >= 8.5 ? 'pass' : roe5 >= 6 ? 'warn' : 'fail') : 'unknown',
      plainExplanation: isFiniteNum(roe5)
        ? `近 5 年平均股東權益報酬率為 ${roe5.toFixed(1)}%，反映金控跨週期獲利底氣。`
        : '完整 5 年 ROE 序列待補齊。',
    });
    safetyCheckup.push({
      itemName: '資本適足與逾放比提醒',
      displayValue: '公開觀測站季報核對',
      status: 'unknown',
      plainExplanation: '建議每季至公開資訊觀測站確認金控資本適足率与銀行逾放比。',
    });
  } else {
    const ocf = isCyc ? (sz.cumulative5yOCF ?? sz.cumulative3yOCF) : sz.cumulative3yOCF;
    if (isFiniteNum(ocf) && ocf < 0) {
      fatalReasons.push('累計營業現金流為負');
      safetyCheckup.push({
        itemName: '真實現金流造血力',
        displayValue: fmtMoneyYi(ocf),
        status: 'fail',
        plainExplanation: '累計營業現金流為負值，本業長期無法帶回真實現金，觸發防雷紅線。',
      });
    } else {
      safetyCheckup.push({
        itemName: '真實現金流造血力',
        displayValue: fmtMoneyYi(ocf),
        status: isFiniteNum(ocf) ? 'pass' : 'unknown',
        plainExplanation: isFiniteNum(ocf)
          ? `累計營業現金流達 ${fmtMoneyYi(ocf)} 為正數，本業現金造血能力充沛。`
          : '公開財報現金流序列未滿完整週期，尚無明顯失血異常。',
      });
    }

    const hasBloat = sz.consecutive2qArOrInvBloat === true;
    const badM = isFiniteNum(sz.beneishMScore) && sz.beneishMScore > -1.78;
    if (hasBloat || badM) {
      fatalReasons.push('帳務盈餘品質或存貨膨脹觸發紅線');
      safetyCheckup.push({
        itemName: '帳務與庫存健康度',
        displayValue: '檢出異常膨脹警訊',
        status: 'fail',
        plainExplanation: '應收帳款或存貨增幅異常高於營收增幅，或盈餘品質指標亮起紅燈。',
      });
    } else {
      safetyCheckup.push({
        itemName: '帳務與庫存健康度',
        displayValue: '帳務與存貨增速正常',
        status: sz.consecutive2qArOrInvBloat === false ? 'pass' : 'unknown',
        plainExplanation:
          sz.consecutive2qArOrInvBloat === false
            ? '應收帳款與存貨增幅皆與營收成長匹配，無虛增盈餘跡象。'
            : '公開財報未揭露細項，無明顯異常。',
      });
    }
  }

  const qScore = Math.min(96, Math.max(20, Math.round(stock.roicPct * 2.5 + stock.piotroskiRaw * 5)));
  const vScore = Math.min(
    95,
    Math.max(20, Math.round((stock.evToEbitda > 0 ? Math.max(0, 28 - stock.evToEbitda) * 2.5 : 45) + stock.fcfYieldPct * 5))
  );
  const mScore = Math.min(
    96,
    Math.max(15, Math.round(50 + stock.rev3mCumYoYPct * 1.2 + (stock.price >= stock.ma200 ? 15 : -15)))
  );

  const qMetrics: HealthDimensionMetric[] = [
    {
      label: '近 3 年平均投入資本回報率（ROIC）',
      valueText: fmtNum(stock.roicPct, 1, '%'),
      benchmarkText: '優質門檻 >= 12%',
      status: stock.roicPct >= 15 ? '優秀' : stock.roicPct >= 10 ? '穩健' : '警訊',
      comment: '衡量公司每投入 100 元資本能創造多少本業稅後利潤。',
    },
    {
      label: '資產毛利率（毛利／總資產）',
      valueText: fmtNum(stock.gpaPct, 1, '%'),
      benchmarkText: '優質門檻 >= 20%',
      status: stock.gpaPct >= 28 ? '優秀' : stock.gpaPct >= 18 ? '穩健' : '警訊',
      comment: '結合產品毛利率與資產運用效率，越高代表競爭力越強。',
    },
    {
      label: '近 3 年盈餘現金轉換率（營業現金流／淨利）',
      valueText: fmtNum(stock.ocfToNiPct, 0, '%'),
      benchmarkText: '健康標準 >= 90%',
      status: stock.ocfToNiPct >= 100 ? '優秀' : stock.ocfToNiPct >= 80 ? '穩健' : '警訊',
      comment: '檢驗帳面賺到的淨利有多少比例真正變成現金流入公司。',
    },
    {
      label: '財報財務強度（F-Score 9 項綜合健檢）',
      valueText: `${stock.piotroskiRaw} / 9 分`,
      benchmarkText: '穩健標準 >= 6 分',
      status: stock.piotroskiRaw >= 7 ? '優秀' : stock.piotroskiRaw >= 5 ? '穩健' : '警訊',
      comment: '綜合檢視獲利能力、負債增減、流動性與毛利率是否較去年改善。',
    },
  ];

  const vMetrics: HealthDimensionMetric[] = [
    {
      label: '企業價值倍數（EV/EBITDA）',
      valueText: stock.evToEbitda > 0 ? fmtNum(stock.evToEbitda, 1, ' 倍') : '待確認',
      benchmarkText: '合理區間 <= 16 倍',
      status: stock.evToEbitda > 0 && stock.evToEbitda <= 12 ? '優秀' : stock.evToEbitda <= 20 ? '穩健' : '偏貴',
      comment: '把市值加上負債、扣除現金後對比本業現金獲利，反映收購回本年數。',
    },
    {
      label: '自由現金流殖利率',
      valueText: fmtNum(stock.fcfYieldPct, 1, '%'),
      benchmarkText: '穩健標準 >= 3.5%',
      status: stock.fcfYieldPct >= 5.5 ? '優秀' : stock.fcfYieldPct >= 2.5 ? '穩健' : '偏貴',
      comment: '公司扣除擴廠資本支出後，每年真正可自由支配的現金報酬率。',
    },
    {
      label: '目前本益比（P/E）與現金股利殖利率',
      valueText: `本益比 ${stock.trailingPe > 0 ? fmtNum(stock.trailingPe, 1, ' 倍') : '待確認'}｜殖利率 ${fmtNum(stock.dividendYieldPct, 1, '%')}`,
      benchmarkText: '本益比 12–22 倍且穩定配息',
      status: stock.trailingPe > 0 && stock.trailingPe <= 16 ? '優秀' : stock.trailingPe <= 25 ? '穩健' : '偏貴',
      comment: '評估目前股價相當於幾年獲利，並搭配現金殖利率檢視下檔支撐力。',
    },
  ];

  const bias200 = stock.ma200 > 0 ? ((stock.price - stock.ma200) / stock.ma200) * 100 : 0;
  const mMetrics: HealthDimensionMetric[] = [
    {
      label: '近 3 個月累計營收年增率',
      valueText: fmtNum(stock.rev3mCumYoYPct, 1, '%'),
      benchmarkText: '年增率 > 0% 且較全年增速加快',
      status: stock.rev3mCumYoYPct >= 12 ? '優秀' : stock.rev3mCumYoYPct >= 0 ? '穩健' : '警訊',
      comment: '近 3 個月營收維持正成長代表訂單出貨暢旺。',
    },
    {
      label: '近 12 個月累計營收年增率',
      valueText: fmtNum(stock.rev12mCumYoYPct, 1, '%'),
      benchmarkText: '全年累計營收年增率 >= 0%',
      status: stock.rev12mCumYoYPct >= 10 ? '優秀' : stock.rev12mCumYoYPct >= 0 ? '穩健' : '警訊',
      comment: '對比近 3 月與近 12 月營收年增率，可看出業績是否加速成長。',
    },
    {
      label: '過去一年風險調整後股價動能表現',
      valueText: fmtNum(stock.mom12m1mSharpe, 2, ''),
      benchmarkText: '動能值 >= 0.5 代表強於大盤',
      status: stock.mom12m1mSharpe >= 1.0 ? '優秀' : stock.mom12m1mSharpe >= 0.3 ? '穩健' : '警訊',
      comment: '衡量過去一年扣除劇烈波動後的穩健上漲趨勢強度。',
    },
    {
      label: '收盤價與 200 日長期均線位置（年線乖離）',
      valueText: `年線 ${fmtNum(stock.ma200, 1, ' 元')}（乖離 ${fmtNum(bias200, 1, '%')}）`,
      benchmarkText: '股價站穩年線之上',
      status: bias200 >= 0 && bias200 <= 22 ? '優秀' : bias200 > 32 ? '偏貴' : '警訊',
      comment: '200 日均線（年線）代表長期生命線，站穩年線之上代表長線多頭格局。',
    },
  ];

  const dimensions: HealthDimension[] = [
    {
      key: 'quality',
      title: '基本面賺錢實力（護城河與獲利含金量）',
      scorePct: qScore,
      gradeText: gradeTextFromPct(qScore),
      summaryComment: '從投入資本回報率、資產毛利效率與現金流轉換率，全方位檢驗公司真本事。',
      metrics: qMetrics,
    },
    {
      key: 'value',
      title: '價格與估值合理度（買進安全邊際）',
      scorePct: vScore,
      gradeText: gradeTextFromPct(vScore),
      summaryComment: '綜合企業價值倍數、自由現金流報酬率與本益比，確認目前買進價格是否划算。',
      metrics: vMetrics,
    },
    {
      key: 'momentum',
      title: '營運成長與趨勢動能（月營收增速與年線趨勢）',
      scorePct: mScore,
      gradeText: gradeTextFromPct(mScore),
      summaryComment: '結合台股獨有的月營收成長加速度與年線多空趨勢，避免買在下跌趨勢。',
      metrics: mMetrics,
    },
  ];

  const totalScore = Number((qScore * 0.4 + vScore * 0.35 + mScore * 0.25).toFixed(1));
  const hasFatal = fatalReasons.length > 0;
  let grade: Grade = 'C';
  if (hasFatal) {
    grade = 'F';
  } else if (totalScore >= 76) {
    grade = 'A';
  } else if (totalScore >= 64) {
    grade = 'B';
  } else if (totalScore >= 50) {
    grade = 'C';
  } else {
    grade = 'D';
  }

  const verdictBadge =
    grade === 'A'
      ? 'A 級｜核心買進標的'
      : grade === 'B'
        ? 'B 級｜優質觀察名單'
        : grade === 'C'
          ? 'C 級｜中性觀望等待'
          : grade === 'D'
            ? 'D 級｜體質轉弱避開'
            : 'F 級｜觸發防雷紅線';

  const canBuy = grade === 'A' || grade === 'B';
  const firstTranchePct = canBuy ? (regime === 'DEFENSIVE' ? 30 : 50) : 0;
  const atr = stock.atr20 > 0 ? stock.atr20 : Math.max(0.5, Number((stock.price * 0.025).toFixed(2)));
  const stopLoss = Number(Math.max(0.01, stock.price - 2.5 * atr).toFixed(2));
  const trailMult = isCyc ? 2.0 : 3.0;
  const trailingStop = Number(Math.max(0.01, stock.price - trailMult * atr).toFixed(2));
  const lowEntry = Number(Math.max(0.01, stock.price - 0.8 * atr).toFixed(1));
  const highEntry = Number((stock.price + 0.3 * atr).toFixed(1));

  return {
    executiveSummary: {
      reportDate: fallbackDate,
      totalScore,
      grade,
      profileLabel: getProfileDisplayLabel(profile),
      verdictBadge,
      oneLineDiagnosis: canBuy
        ? `${stock.name}本業獲利與現金流表現穩健，且通過防雷安全檢核，建議依兩階段紀律分批建倉並設好停損防線。`
        : `${stock.name}目前尚未達安全買進標準，建議先行觀望並追蹤後續月營收與季報變化。`,
      suitableFor: canBuy ? '波段價差＋穩健領息' : '目前不建議介入',
    },
    safetyCheckup,
    dimensions,
    actionPlan: {
      stance: grade === 'A' ? 'BUY' : grade === 'B' || grade === 'C' ? 'HOLD_OR_WATCH' : 'AVOID_OR_SELL',
      stanceLabel: grade === 'A' ? '建議分批買進' : grade === 'B' ? '逢低分批布局' : '建議觀望或避開',
      buyStrategy: {
        canBuyNow: canBuy,
        firstTranchePct,
        entryZoneText: canBuy
          ? `NT$ ${lowEntry.toLocaleString()} ~ ${highEntry.toLocaleString()} 之間分批布局，避開開盤前 15 分鐘急拉及漲停鎖死日。`
          : '目前未達安全買進標準，建議空手觀望。',
        secondTrancheCondition: canBuy
          ? `買進滿 1 個月或下次月營收公布後，年增率維持正成長且收盤未跌破 NT$ ${stopLoss.toLocaleString()} 停損線，再投入剩餘 ${100 - firstTranchePct}% 資金。`
          : '待綜合評級重回 B 級以上且股價站回年線後，再重新評估建倉。',
      },
      sellAndDefenseStrategy: {
        stopLossPrice: stopLoss,
        ma200Price: Number(stock.ma200.toFixed(2)),
        trailingStopPrice: trailingStop,
        fundamentalExitRule:
          '每季財報更新後若綜合評分跌破 60 分、或近 3 月累計營收年增率由正轉負且跌破季線時，依紀律分批獲利了結。',
      },
    },
    chartSeries: {
      quarterlyTrend: cyc.grossMarginQuarterlySeries.map((g, idx) => ({
        quarter: g.quarter,
        revenueYi: null,
        grossMarginPct: g.grossMarginPct,
        dio: cyc.dioQuarterlySeries[idx]?.dio ?? null,
      })),
      valuationBand: {
        metricLabel: '近 5–7 年股價淨值比（P/B）歷史區間位置',
        currentValue: cyc.currentPB,
        percentile5to7Y: cyc.pbPercentile5to7Y,
        minVal: cyc.pbBand.min,
        p20Val: cyc.pbBand.p20,
        p50Val: cyc.pbBand.p50,
        p80Val: cyc.pbBand.p80,
        maxVal: cyc.pbBand.max,
        positionComment:
          cyc.pbPercentile5to7Y !== null
            ? `目前股價淨值比處於近 5–7 年歷史 ${cyc.pbPercentile5to7Y.toFixed(0)}% 分位。`
            : '歷史估值區間資料整理中。',
      },
    },
  };
}

/**
 * 產出適合貼到 LINE / Telegram / 記事本的精簡純文字戰報摘要
 */
export function formatHealthReportPlainText(stock: TwStockCandidate, report: HealthReport): string {
  const { executiveSummary: ex, safetyCheckup, dimensions, actionPlan } = report;
  const sell = actionPlan.sellAndDefenseStrategy;
  const buy = actionPlan.buyStrategy;

  const safetyLines = safetyCheckup.map((s) => {
    const icon = s.status === 'pass' ? '🟢 通過' : s.status === 'warn' ? '🟡 留意' : s.status === 'fail' ? '🔴 高危' : '⚪ 待確認';
    return `• ${s.itemName}：【${icon}】${s.displayValue}（${s.plainExplanation}）`;
  });

  const dimLines = dimensions.map(
    (d) => `• ${d.title}：${d.scorePct.toFixed(0)} 分（${d.gradeText}）— ${d.summaryComment}`
  );

  return [
    `📊 《台股個股深度健檢報告書》`,
    `標的：${stock.symbol} ${stock.name}（${stock.sector}）`,
    `現價：NT$ ${stock.price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ｜ 報告基準日：${ex.reportDate}`,
    `適配策略：${ex.profileLabel}`,
    `----------------------------------------`,
    `【總體診斷結論】${ex.verdictBadge}（總分 ${ex.totalScore.toFixed(1)} / 100 分）`,
    `適合屬性：${ex.suitableFor}`,
    `白話總評：${ex.oneLineDiagnosis}`,
    `----------------------------------------`,
    `【一、防雷與體質安全檢查表】`,
    ...safetyLines,
    `----------------------------------------`,
    `【二、三大核心維度評分】`,
    ...dimLines,
    `----------------------------------------`,
    `【三、專屬買賣操作與風控價位】`,
    `• 操作立場：${actionPlan.stanceLabel}（首筆建議投入比例：${buy.firstTranchePct}%）`,
    `• 進場參考區間：${buy.entryZoneText}`,
    `• 第二批加碼條件：${buy.secondTrancheCondition}`,
    `• 看錯停損參考價：${sell.stopLossPrice !== null ? `NT$ ${sell.stopLossPrice.toLocaleString()}` : '待確認'}`,
    `• 200日均線防線：${sell.ma200Price !== null ? `NT$ ${sell.ma200Price.toLocaleString()}` : '待確認'}`,
    `• 移動停利防守價：${sell.trailingStopPrice !== null ? `NT$ ${sell.trailingStopPrice.toLocaleString()}` : '待確認'}`,
    `• 基本面出場紀律：${sell.fundamentalExitRule}`,
  ].join('\n');
}
