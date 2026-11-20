import type {
  StageZeroInput,
  StageZeroRedFlag,
  StageZeroResult,
  ValuationProfile,
} from './types';

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 階段零：台股一票否決防雷閘門
 * 嚴格遵守「反靜默失真原則」：null 欄位絕不視為 0 或安全，會列入 pendingManualChecks 提示人工覆核。
 * 循環模式（cyclical_heavy_asset / cyclical_inventory_order）將 3 年 OCF 放寬為 5 年累計 OCF < 0 或流動比失控檢核。
 */
export function evaluateStageZero(
  input: StageZeroInput,
  valuationProfile: ValuationProfile = 'standard'
): StageZeroResult {
  const redFlags: StageZeroRedFlag[] = [];
  const pendingManualChecks: string[] = [];

  // 1. Beneish M-Score > -1.78
  if (input.beneishMScore === null) {
    pendingManualChecks.push('Beneish M-Score 缺失（請補齊財報欄位計算）');
  } else if (isFiniteNum(input.beneishMScore) && input.beneishMScore > -1.78) {
    redFlags.push({
      code: 'TW_BENEISH',
      title: 'Beneish M-Score 盈餘操縱警報',
      detail: `M-Score = ${input.beneishMScore.toFixed(2)}（超過紅線 -1.78），具高度盈餘操縱嫌疑。`,
    });
  }

  // 2. Altman Z / Z'' 破產困境
  if (input.isManufacturing) {
    if (input.altmanZScore === null) {
      pendingManualChecks.push('Altman Z-Score（製造業）資料缺失');
    } else if (isFiniteNum(input.altmanZScore) && input.altmanZScore < 1.81) {
      redFlags.push({
        code: 'TW_ALTMAN_Z',
        title: 'Altman Z-Score 破產危機（製造業）',
        detail: `Z-Score = ${input.altmanZScore.toFixed(2)}（低於安全線 1.81）。`,
      });
    }
  } else {
    if (input.altmanZDoublePrime === null) {
      pendingManualChecks.push("Altman Z''-Score（非製造業）資料缺失");
    } else if (isFiniteNum(input.altmanZDoublePrime) && input.altmanZDoublePrime < 1.1) {
      redFlags.push({
        code: 'TW_ALTMAN_ZPP',
        title: "Altman Z''-Score 破產危機（非製造業）",
        detail: `Z''-Score = ${input.altmanZDoublePrime.toFixed(2)}（低於安全線 1.10）。`,
      });
    }
  }

  // 3. 現金流枯竭（標準模式看 3Y OCF；循環模式放寬為 5Y 累計 OCF < 0 或最新流動比 < 1.2 且淨負債比失控）
  if (valuationProfile === 'standard') {
    if (input.cumulative3yOCF === null) {
      pendingManualChecks.push('近 3 年累計營業現金流 (3Y OCF) 缺失');
    } else if (isFiniteNum(input.cumulative3yOCF) && input.cumulative3yOCF < 0) {
      redFlags.push({
        code: 'TW_NEG_3Y_OCF',
        title: '近 3 年累計營業現金流為負',
        detail: `近 3 年累計 OCF = NT$ ${Math.round(input.cumulative3yOCF).toLocaleString()}（< 0）。`,
      });
    }
  } else {
    const ocf5y = input.cumulative5yOCF ?? input.cumulative3yOCF;
    if (ocf5y === null) {
      pendingManualChecks.push('近 5 年累計營業現金流 (5Y OCF) 缺失');
    } else if (isFiniteNum(ocf5y) && ocf5y < 0) {
      redFlags.push({
        code: 'TW_CYC_NEG_5Y_OCF',
        title: '循環跨週期 5 年累計營業現金流為負',
        detail: `近 5 年累計 OCF = NT$ ${Math.round(ocf5y).toLocaleString()}（< 0），跨週期仍無現金造血能力。`,
      });
    }

    if (
      isFiniteNum(input.latestCurrentRatio) &&
      input.latestCurrentRatio < 1.2 &&
      isFiniteNum(input.latestNetDebtToEquityPct) &&
      input.latestNetDebtToEquityPct > 100
    ) {
      redFlags.push({
        code: 'TW_CYC_LIQUIDITY_CRISIS',
        title: '循環股谷底流動性失控',
        detail: `最新流動比率 ${input.latestCurrentRatio.toFixed(2)} (< 1.2) 且淨負債權益比 ${input.latestNetDebtToEquityPct.toFixed(1)}% (> 100%)，具斷鏈違約風險。`,
      });
    }
  }

  // 4. 查核與治理異常
  if (input.hasAuditOrGovernanceRedFlag === null) {
    pendingManualChecks.push('會計師查核意見／非換屆無故更換事務所（需至 MOPS 人工覆核）');
  } else if (input.hasAuditOrGovernanceRedFlag === true) {
    redFlags.push({
      code: 'TW_AUDIT_GOV',
      title: '會計師保留意見／異常換所',
      detail: '出現會計師保留／否定／無法表示意見，或非換屆無故更換會計師事務所。',
    });
  }

  // 5. 交易所監理警示
  if (input.isFullCashDeliveryOrSuspended === null) {
    pendingManualChecks.push('是否列為全額交割／停止買賣（需人工核對）');
  } else if (input.isFullCashDeliveryOrSuspended === true) {
    redFlags.push({
      code: 'TW_FULL_CASH',
      title: '交易所全額交割／停止買賣',
      detail: '列為變更交易方法（全額交割）或停止買賣處分。',
    });
  }

  if (input.directorPledgeRatio === null) {
    pendingManualChecks.push('董監設質比率（上櫃或端點缺失時需至 MOPS 核對）');
  } else if (isFiniteNum(input.directorPledgeRatio) && input.directorPledgeRatio >= 70) {
    redFlags.push({
      code: 'TW_DIRECTOR_PLEDGE',
      title: '董監事設質比率過高 (>= 70%)',
      detail: `董監設質比例達 ${input.directorPledgeRatio.toFixed(1)}%（>= 70% 紅線），具質押斷頭風險。`,
    });
  }

  if (input.directorInsufficientHoldingMonths === null) {
    pendingManualChecks.push('董監持股成數連續不足月數（需至 MOPS 核對）');
  } else if (
    isFiniteNum(input.directorInsufficientHoldingMonths) &&
    input.directorInsufficientHoldingMonths >= 3
  ) {
    redFlags.push({
      code: 'TW_INSUFFICIENT_HOLDING',
      title: '董監持股成數連續不足 (>= 3 個月)',
      detail: `已連續 ${input.directorInsufficientHoldingMonths} 個月董監持股不足法定成數。`,
    });
  }

  // 6. 流動性與價格底線
  if (input.avgDailyTurnover20dTWD === null) {
    pendingManualChecks.push('20 日均成交金額缺失');
  } else if (
    isFiniteNum(input.avgDailyTurnover20dTWD) &&
    input.avgDailyTurnover20dTWD < 30_000_000
  ) {
    redFlags.push({
      code: 'TW_LOW_TURNOVER',
      title: '台股流動性不足 (< NT$ 3,000 萬)',
      detail: `20 日均成交額 NT$ ${(input.avgDailyTurnover20dTWD / 1e6).toFixed(2)} 百萬，低於 3,000 萬元底線。`,
    });
  }

  if (input.price === null) {
    pendingManualChecks.push('最新收盤價缺失');
  } else if (isFiniteNum(input.price) && input.price < 10) {
    redFlags.push({
      code: 'TW_BELOW_10',
      title: '股價低於 10 元面額風險底線',
      detail: `目前收盤價 NT$ ${input.price.toFixed(2)}（< 10 元）。`,
    });
  }

  if (input.isDispositionStock === null) {
    pendingManualChecks.push('是否處於處置分盤交易（上櫃需人工核對）');
  } else if (input.isDispositionStock === true) {
    redFlags.push({
      code: 'TW_DISPOSITION',
      title: '列為處置股（分盤交易）',
      detail: '目前為證交所／櫃買中心處置股票，流動性與異常波動風險過高。',
    });
  }

  // 7. 股權稀釋與帳務膨脹
  if (
    isFiniteNum(input.shareDilution3yPct) &&
    input.shareDilution3yPct > 20 &&
    input.isRoicDeclining === true
  ) {
    redFlags.push({
      code: 'TW_DILUTION_ROIC',
      title: '股本大幅稀釋 (> 20%) 且 ROIC 下滑',
      detail: `近 3 年股本膨脹 ${input.shareDilution3yPct.toFixed(1)}% 且資本回報率持續下滑。`,
    });
  }

  if (input.consecutive2qArOrInvBloat === true) {
    redFlags.push({
      code: 'TW_AR_INV_BLOAT',
      title: '連續 2 季應收帳款或存貨異常膨脹',
      detail: '連續兩季 (應收帳款 YoY - 營收 YoY >= 20%) 或 (存貨 YoY - 營收 YoY >= 20%)，警示塞貨或呆帳風險。',
    });
  }

  const passed = redFlags.length === 0;
  return {
    passed,
    gradeOverride: passed ? null : 'F',
    redFlags,
    pendingManualChecks,
  };
}
