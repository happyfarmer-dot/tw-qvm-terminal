from __future__ import annotations

import math
from typing import Any, Literal, Optional

from pipeline.calculators.cyclical_metrics import (
    _find_metric_value,
    _pivot_by_date_with_origin,
    _quarter_label,
)
from pipeline.schemas import (
    CyclicalMetricsModel,
    FinancialRatiosModel,
    FinancialSectorMetricsModel,
    HealthActionPlanModel,
    HealthBuyStrategyModel,
    HealthChartSeriesModel,
    HealthDimensionMetricModel,
    HealthDimensionModel,
    HealthExecutiveSummaryModel,
    HealthQuarterlyChartPointModel,
    HealthReportModel,
    HealthSafetyItemModel,
    HealthSellDefenseStrategyModel,
    HealthValuationBandSummaryModel,
    StageZeroMetricsModel,
    ValuationProfile,
)


MetricStatus = Literal["優秀", "穩健", "偏貴", "警訊", "待確認"]
SafetyStatus = Literal["pass", "warn", "fail", "unknown"]
GradeLiteral = Literal["A", "B", "C", "D", "F"]


def _is_num(val: Any) -> bool:
    return isinstance(val, (int, float)) and math.isfinite(float(val))


def _fmt_num(val: Optional[float], decimals: int = 1, suffix: str = "") -> str:
    if not _is_num(val):
        return "待確認"
    return f"{float(val):.{decimals}f}{suffix}"


def _fmt_money_yi(val_twd: Optional[float]) -> str:
    if not _is_num(val_twd):
        return "待確認"
    yi = float(val_twd) / 1e8
    return f"{yi:,.2f} 億元"


def _profile_display_label(profile: ValuationProfile) -> str:
    if profile == "cyclical_heavy_asset":
        return "強景氣循環（重資產／航運面板記憶體）"
    if profile == "cyclical_inventory_order":
        return "強景氣循環（存貨與訂單領先型）"
    if profile == "financial_bank":
        return "銀行與官股金控穩健收息型"
    if profile == "financial_life_fhc":
        return "壽險雙引擎金控型"
    return "標準高品質成長型"


def _grade_text_from_pct(pct: float) -> str:
    if pct >= 78:
        return "表現優異"
    if pct >= 60:
        return "表現穩健"
    if pct >= 42:
        return "表現普通"
    return "偏弱警戒"


def _extract_recent_8q_trend(
    income_rows: list[dict[str, Any]],
    cyc: CyclicalMetricsModel,
) -> list[HealthQuarterlyChartPointModel]:
    inc_q = _pivot_by_date_with_origin(income_rows)
    rev_by_q: dict[str, Optional[float]] = {}
    for d in sorted(inc_q.keys()):
        q_lbl = _quarter_label(d)
        rev = _find_metric_value(inc_q[d], exact_types=("Revenue", "OperatingRevenue"))
        if _is_num(rev):
            rev_by_q[q_lbl] = round(float(rev) / 1e8, 2)

    gm_map = {pt.quarter: pt.grossMarginPct for pt in cyc.grossMarginQuarterlySeries}
    dio_map = {pt.quarter: pt.dio for pt in cyc.dioQuarterlySeries}

    quarters = [pt.quarter for pt in cyc.grossMarginQuarterlySeries]
    if not quarters:
        quarters = sorted(rev_by_q.keys())[-8:]

    series: list[HealthQuarterlyChartPointModel] = []
    for q in quarters[-8:]:
        series.append(
            HealthQuarterlyChartPointModel(
                quarter=q,
                revenueYi=rev_by_q.get(q),
                grossMarginPct=gm_map.get(q),
                dio=dio_map.get(q),
            )
        )
    return series


def _build_safety_checkup(
    *,
    profile: ValuationProfile,
    sz: StageZeroMetricsModel,
    ratios: FinancialRatiosModel,
    cyc: CyclicalMetricsModel,
    fin_sec: Optional[FinancialSectorMetricsModel],
) -> tuple[list[HealthSafetyItemModel], bool, list[str]]:
    """
    回傳 (safety_items, has_fatal_red_flag, fatal_reasons)
    """
    items: list[HealthSafetyItemModel] = []
    fatal_reasons: list[str] = []
    is_fin = profile in ("financial_bank", "financial_life_fhc")
    is_cyc = profile in ("cyclical_heavy_asset", "cyclical_inventory_order")

    if is_fin:
        # 1. 市場流動性與設質安全
        to_val = sz.avgDailyTurnover20dTWD
        disp = sz.isDispositionStock
        pledge = sz.directorPledgeRatio
        to_yi = (float(to_val) / 1e8) if _is_num(to_val) else None

        if disp is True or (to_yi is not None and to_yi < 0.3) or (_is_num(pledge) and float(pledge) >= 70):
            st1: SafetyStatus = "fail"
            exp1 = "成交量過低、列為處置股或大股東質押過高（>=70%），具流動性與籌碼斷頭風險。"
            fatal_reasons.append("流動性不足或董監設質比例過高")
        elif _is_num(pledge) and float(pledge) >= 30:
            st1 = "warn"
            exp1 = f"日均成交約 {_fmt_money_yi(to_val)} 具備充足流動性，但大股東設質比 {pledge:.1f}% 偏高需留意。"
        elif to_yi is not None and to_yi >= 0.3:
            st1 = "pass"
            pledge_txt = f"，大股東設質 {pledge:.1f}% 低檔安全" if _is_num(pledge) else ""
            exp1 = f"近 20 日均成交額 {_fmt_money_yi(to_val)} 且非處置股{pledge_txt}，進出變現無虞。"
        else:
            st1 = "unknown"
            exp1 = "成交額或設質資料待更新，目前無處置警示。"

        disp_val1 = f"日均成交 {_fmt_money_yi(to_val)}" + (
            f"｜設質 {pledge:.1f}%" if _is_num(pledge) else ""
        )
        items.append(
            HealthSafetyItemModel(
                itemName="市場流動性與設質安全",
                displayValue=disp_val1,
                status=st1,
                plainExplanation=exp1,
            )
        )

        # 2. 長期獲利穩定度（5 年平均 ROE 與無虧損紀錄）
        roe5 = fin_sec.avgRoe5Y if fin_sec else None
        min_roe = fin_sec.minAnnualRoe5Y if fin_sec else None
        if _is_num(roe5):
            if float(roe5) >= 8.5 and (min_roe is None or float(min_roe) > 0):
                st2: SafetyStatus = "pass"
                exp2 = f"近 5 年平均股東權益報酬率（ROE）達 {roe5:.1f}% 且連年獲利無虧損，底氣穩固。"
            elif float(roe5) >= 6.0 and (min_roe is None or float(min_roe) >= 0):
                st2 = "warn"
                exp2 = f"近 5 年平均 ROE 為 {roe5:.1f}%，獲利能力尚可但成長爆發力較溫和。"
            else:
                st2 = "fail"
                exp2 = f"近 5 年平均 ROE 僅 {roe5:.1f}% 或曾出現年度虧損，長期獲利體質偏弱。"
            val2 = f"5年均 ROE {roe5:.1f}%"
        else:
            st2 = "unknown"
            val2 = "財報序列建置中"
            exp2 = "完整 5 年 ROE 序列待補齊。"

        items.append(
            HealthSafetyItemModel(
                itemName="長期獲利穩定度（5 年平均 ROE）",
                displayValue=val2,
                status=st2,
                plainExplanation=exp2,
            )
        )

        # 3. 股利發放真實力（近 5 年穩健配息紀錄）
        div_years = fin_sec.consecutiveCashDivYears if fin_sec else None
        uses_cap = fin_sec.usesCapitalReserveForDividend if fin_sec else None
        div_yield = (fin_sec.cashDividendYieldPct if fin_sec else None) or ratios.dividendYieldPct
        if _is_num(div_years) and int(div_years) >= 5:
            if uses_cap is True:
                st3: SafetyStatus = "warn"
                exp3 = f"連續 {int(div_years)} 年配發股息，但最近一期曾動用資本公積配息，須留意是否為高息假象。"
            else:
                st3 = "pass"
                exp3 = f"連續 {int(div_years)} 年穩定配發現金股利，且全數來自真實獲利盈餘，配息續航力強。"
            val3 = f"連續 {int(div_years)} 年配息" + (f"｜殖利率 {div_yield:.1f}%" if _is_num(div_yield) else "")
        elif ratios.consecutive5yDividend is True:
            st3 = "pass"
            val3 = "連續 5 年以上配息" + (f"｜殖利率 {div_yield:.1f}%" if _is_num(div_yield) else "")
            exp3 = "過去 5 年每年皆穩定配發現金股息，現金回報紀錄良好。"
        elif _is_num(div_years) and int(div_years) > 0:
            st3 = "warn"
            val3 = f"連續 {int(div_years)} 年配息"
            exp3 = "近 5 年曾有中斷配息或紀錄未滿 5 年，存股領息穩定度需持續追蹤。"
        else:
            st3 = "unknown"
            val3 = f"殖利率 {_fmt_num(div_yield, 1, '%')}"
            exp3 = "歷年配息明細確認中，建議參考最新年度盈餘分配公告。"

        items.append(
            HealthSafetyItemModel(
                itemName="股利發放真實力（近 5 年配息紀錄）",
                displayValue=val3,
                status=st3,
                plainExplanation=exp3,
            )
        )

        # 4. 資本適足與逾放比提醒
        items.append(
            HealthSafetyItemModel(
                itemName="資本適足與逾放比提醒",
                displayValue="公開觀測站季報核對",
                status="unknown",
                plainExplanation="建議每季至公開資訊觀測站確認金控資本適足率（CAR >= 105%）與銀行逾放比（NPL <= 1%）。",
            )
        )
        return items, len(fatal_reasons) > 0, fatal_reasons

    # === 一般品質股 / 強景氣循環股 4 項檢核 ===
    # 1. 市場流動性安全
    to_val = sz.avgDailyTurnover20dTWD
    disp = sz.isDispositionStock
    to_yi = (float(to_val) / 1e8) if _is_num(to_val) else None
    if disp is True:
        st_liq: SafetyStatus = "fail"
        exp_liq = "目前列為交易所處置股（分盤交易），短線波動與流動性風險極高，觸發防雷紅線。"
        fatal_reasons.append("目前列為處置股")
    elif to_yi is not None and to_yi < 0.3:
        st_liq = "fail"
        exp_liq = f"近 20 日均成交額僅 {_fmt_money_yi(to_val)}（低於 0.3 億元安全底線），容易發生買賣滑價或出脫困難。"
        fatal_reasons.append("日均成交額低於 3,000 萬元安全底線")
    elif to_yi is not None and to_yi >= 0.3:
        st_liq = "pass"
        exp_liq = f"近 20 日均成交額達 {_fmt_money_yi(to_val)} 且非處置股，市場交投活絡、資金進出安全。"
    else:
        st_liq = "unknown"
        exp_liq = "成交額資料待同步，目前無處置分盤警示。"

    items.append(
        HealthSafetyItemModel(
            itemName="市場流動性安全",
            displayValue=f"{_fmt_money_yi(to_val)}｜{'處置股' if disp is True else '正常交易'}",
            status=st_liq,
            plainExplanation=exp_liq,
        )
    )

    # 2. 大股東籌碼安定度（董監設質比例）
    pledge = sz.directorPledgeRatio
    if _is_num(pledge):
        p_val = float(pledge)
        if p_val >= 70:
            st_plg: SafetyStatus = "fail"
            exp_plg = f"董監事持股設質比例高達 {p_val:.1f}%（超過 70% 危險紅線），大盤重挫時易引發斷頭賣壓。"
            fatal_reasons.append("董監事設質比例超過 70% 紅線")
        elif p_val >= 30:
            st_plg = "warn"
            exp_plg = f"董監事設質比例為 {p_val:.1f}%（介於 30%–69% 警戒區），建議留意大股東財務槓桿狀況。"
        else:
            st_plg = "pass"
            exp_plg = f"董監事設質比例僅 {p_val:.1f}%（低於 30% 安全標準），大股東籌碼結構相當安定。"
        val_plg = f"設質比 {p_val:.1f}%"
    else:
        st_plg = "unknown"
        val_plg = "無異常設質通報"
        exp_plg = "公開資訊未檢出高比例設質異常，籌碼結構無明顯警訊。"

    items.append(
        HealthSafetyItemModel(
            itemName="大股東籌碼安定度",
            displayValue=val_plg,
            status=st_plg,
            plainExplanation=exp_plg,
        )
    )

    # 3. 真實現金流造血力
    ocf_target = (sz.cumulative5yOCF or sz.cumulative3yOCF) if is_cyc else sz.cumulative3yOCF
    period_lbl = "近 5 年" if is_cyc and sz.cumulative5yOCF is not None else "近 3 年"
    fcf_y = ratios.fcfYieldPct
    if _is_num(ocf_target):
        if float(ocf_target) < 0:
            st_ocf: SafetyStatus = "fail"
            exp_ocf = f"{period_lbl}累計營業現金流為負值（{_fmt_money_yi(ocf_target)}），本業長期無法帶回真實現金，觸發防雷紅線。"
            fatal_reasons.append(f"{period_lbl}累計營業現金流為負")
        elif _is_num(fcf_y) and float(fcf_y) < 0:
            st_ocf = "warn"
            exp_ocf = f"{period_lbl}累計營業現金流為正（{_fmt_money_yi(ocf_target)}），但因近期資本支出較高，自由現金流暫呈流出。"
        else:
            st_ocf = "pass"
            fcf_txt = f"，自由現金流殖利率 {fcf_y:.1f}%" if _is_num(fcf_y) else ""
            exp_ocf = f"{period_lbl}累計營業現金流達 {_fmt_money_yi(ocf_target)} 為正數{fcf_txt}，本業現金造血能力充沛。"
        val_ocf = f"{period_lbl}累計 {_fmt_money_yi(ocf_target)}"
    else:
        st_ocf = "unknown"
        val_ocf = "現金流資料核對中"
        exp_ocf = "公開財報現金流序列未滿完整週期，尚無明顯失血異常。"

    items.append(
        HealthSafetyItemModel(
            itemName="真實現金流造血力",
            displayValue=val_ocf,
            status=st_ocf,
            plainExplanation=exp_ocf,
        )
    )

    # 4. 帳務與庫存健康度
    bloat = sz.consecutive2qArOrInvBloat
    m_score = sz.beneishMScore
    z_score = sz.altmanZScore if sz.isManufacturing else sz.altmanZDoublePrime
    z_floor = 1.81 if sz.isManufacturing else 1.10

    if (_is_num(m_score) and float(m_score) > -1.78) or (_is_num(z_score) and float(z_score) < z_floor) or bloat is True:
        st_acc: SafetyStatus = "fail"
        reasons_acc: list[str] = []
        if bloat is True:
            reasons_acc.append("連續兩季應收帳款或存貨增幅異常高於營收增幅 20% 以上（疑似塞貨或呆帳）")
        if _is_num(m_score) and float(m_score) > -1.78:
            reasons_acc.append("盈餘品質指標顯示帳面獲利與現金落差偏大")
        if _is_num(z_score) and float(z_score) < z_floor:
            reasons_acc.append("財務償債安全緩衝偏低")
        exp_acc = "；".join(reasons_acc) + "，建議高度警戒。"
        fatal_reasons.append("帳務盈餘品質或存貨膨脹觸發紅線")
        val_acc = "檢出異常膨脹警訊"
    elif bloat is False and (_is_num(m_score) or _is_num(z_score)):
        st_acc = "pass"
        val_acc = "帳務與存貨增速正常"
        exp_acc = "應收帳款與存貨增幅皆與營收成長匹配，且無虛增盈餘或破產財務壓力跡象。"
    else:
        st_acc = "unknown"
        val_acc = "無明顯異常"
        exp_acc = "公開財報未揭露細項，無明顯異常。"

    items.append(
        HealthSafetyItemModel(
            itemName="帳務與庫存健康度",
            displayValue=val_acc,
            status=st_acc,
            plainExplanation=exp_acc,
        )
    )

    return items, len(fatal_reasons) > 0, fatal_reasons


def build_stock_health_report(
    *,
    sym: str,
    name: str,
    sector: str,
    profile: ValuationProfile,
    report_date: str,
    price: Optional[float],
    high_20d: Optional[float],
    atr20: Optional[float],
    ma120: Optional[float],
    ma200: Optional[float],
    sz: StageZeroMetricsModel,
    ratios: FinancialRatiosModel,
    cyc: CyclicalMetricsModel,
    fin_sec: Optional[FinancialSectorMetricsModel],
    income_rows: list[dict[str, Any]],
    regime: Literal["NORMAL", "DEFENSIVE"] = "NORMAL",
) -> HealthReportModel:
    """
    依個股自動適配之模型（標準品質／強景氣循環／銀行金控）產出 5 大章節完整白話《個股深度健檢報告書》。
    """
    safety_items, has_fatal, fatal_reasons = _build_safety_checkup(
        profile=profile,
        sz=sz,
        ratios=ratios,
        cyc=cyc,
        fin_sec=fin_sec,
    )

    is_fin = profile in ("financial_bank", "financial_life_fhc")
    is_cyc = profile in ("cyclical_heavy_asset", "cyclical_inventory_order")

    dimensions: list[HealthDimensionModel] = []
    peak_circuit_breaker = False

    if is_fin:
        # ================== 金融與金控模型 ==================
        roe5 = fin_sec.avgRoe5Y if fin_sec else None
        roe_std = fin_sec.roeStdDev5Y if fin_sec else None
        div_years = fin_sec.consecutiveCashDivYears if fin_sec else None
        cur_pb = (fin_sec.currentPB if fin_sec else None) or ratios.pbRatio
        just_pb = fin_sec.justifiedPB if fin_sec else None
        pb_ratio = fin_sec.pbValuationRatio if fin_sec else None
        pb_pct = (fin_sec.pbPercentile5to7Y if fin_sec else None) or cyc.pbPercentile5to7Y
        div_yld = (fin_sec.cashDividendYieldPct if fin_sec else None) or ratios.dividendYieldPct
        payout = (fin_sec.latestPayoutRatioPct or fin_sec.avgPayoutRatio5Y) if fin_sec else None
        rev3 = ratios.rev3mCumYoYPct
        rev12 = ratios.rev12mCumYoYPct
        bias200 = ratios.trendVsMa200Pct
        mom_s = ratios.mom12m1mSharpe

        # 1. Quality
        q_score = 55.0
        if _is_num(roe5):
            if float(roe5) >= 10:
                q_score += 22
            elif float(roe5) >= 8:
                q_score += 12
            elif float(roe5) < 6:
                q_score -= 15
        if _is_num(roe_std) and float(roe_std) <= 2.5:
            q_score += 10
        if (_is_num(div_years) and int(div_years) >= 5) or ratios.consecutive5yDividend:
            q_score += 10
        q_score = round(max(15.0, min(98.0, q_score)), 1)

        q_metrics = [
            HealthDimensionMetricModel(
                label="近 5 年平均股東權益報酬率（ROE）",
                valueText=_fmt_num(roe5, 1, "%"),
                benchmarkText="銀行 >= 9%｜壽險金控 >= 10%",
                status="優秀" if (_is_num(roe5) and float(roe5) >= 9.5) else ("穩健" if (_is_num(roe5) and float(roe5) >= 7.0) else ("警訊" if _is_num(roe5) else "待確認")),
                comment="衡量金融機構運用股東資金創造獲利的長期效率。" if _is_num(roe5) else "財報歷史序列整理中。",
            ),
            HealthDimensionMetricModel(
                label="近 5 年獲利波動穩定度（ROE 標準差）",
                valueText=_fmt_num(roe_std, 2, "%"),
                benchmarkText="波動 <= 2.5% 為極穩健",
                status="優秀" if (_is_num(roe_std) and float(roe_std) <= 2.0) else ("穩健" if (_is_num(roe_std) and float(roe_std) <= 4.0) else ("警訊" if _is_num(roe_std) else "待確認")),
                comment="數值越低代表跨升降息循環的獲利越穩定，不易大起大落。",
            ),
            HealthDimensionMetricModel(
                label="連續穩定配息年數",
                valueText=f"{int(div_years)} 年" if _is_num(div_years) else ("5 年以上" if ratios.consecutive5yDividend else "待確認"),
                benchmarkText="連續配息 >= 5 年且無動用老本",
                status="優秀" if ((_is_num(div_years) and int(div_years) >= 5) or ratios.consecutive5yDividend) else "穩健",
                comment="檢驗金控是否具備穿越景氣週期、持續發放現金股息的實力。",
            ),
        ]
        dimensions.append(
            HealthDimensionModel(
                key="quality",
                title="基本面賺錢實力（金融長期獲利與配息底氣）",
                scorePct=q_score,
                gradeText=_grade_text_from_pct(q_score),
                summaryComment="評估金控與銀行跨利率週期的股東權益報酬率（ROE）與配息真實度。",
                metrics=q_metrics,
            )
        )

        # 2. Value
        v_score = 55.0
        if _is_num(pb_ratio):
            if float(pb_ratio) <= 0.9:
                v_score += 22
            elif float(pb_ratio) <= 1.1:
                v_score += 10
            elif float(pb_ratio) >= 1.25:
                v_score -= 18
        if _is_num(pb_pct):
            if float(pb_pct) <= 35:
                v_score += 12
            elif float(pb_pct) >= 85:
                v_score -= 15
        if _is_num(div_yld) and float(div_yld) >= 4.2:
            v_score += 8
        v_score = round(max(10.0, min(98.0, v_score)), 1)

        pb_vs_just_txt = (
            f"現價 {cur_pb:.2f} 倍（合理約 {just_pb:.2f} 倍）"
            if (_is_num(cur_pb) and _is_num(just_pb))
            else f"現價 {_fmt_num(cur_pb, 2, ' 倍')}"
        )
        v_metrics = [
            HealthDimensionMetricModel(
                label="目前股價淨值比（P/B）對比合理淨值比",
                valueText=pb_vs_just_txt,
                benchmarkText="折溢價比 <= 1.05 倍為合理買點",
                status="優秀" if (_is_num(pb_ratio) and float(pb_ratio) <= 0.95) else ("穩健" if (_is_num(pb_ratio) and float(pb_ratio) <= 1.15) else ("偏貴" if _is_num(pb_ratio) else "待確認")),
                comment="以長期 ROE 與配息率推算合理股價淨值比，判斷目前股價是否委屈或偏貴。",
            ),
            HealthDimensionMetricModel(
                label="近 5–7 年歷史股價淨值比位階",
                valueText=_fmt_num(pb_pct, 0, "% 分位"),
                benchmarkText="歷史 0%–55% 中低位階區",
                status="優秀" if (_is_num(pb_pct) and float(pb_pct) <= 35) else ("穩健" if (_is_num(pb_pct) and float(pb_pct) <= 65) else ("偏貴" if _is_num(pb_pct) else "待確認")),
                comment="衡量目前股價淨值比在過去 5–7 年歷史區間中的高低位置。",
            ),
            HealthDimensionMetricModel(
                label="現金股利殖利率與盈餘配發率",
                valueText=f"殖利率 {_fmt_num(div_yld, 1, '%')}｜配發率 {_fmt_num(payout, 0, '%')}",
                benchmarkText="殖利率 >= 4.0% 且配發率 45%–85%",
                status="優秀" if (_is_num(div_yld) and float(div_yld) >= 4.5) else ("穩健" if (_is_num(div_yld) and float(div_yld) >= 3.2) else ("偏貴" if _is_num(div_yld) else "待確認")),
                comment="殖利率提供下檔保護，健康的配發率則確保公司留有足夠資本緩衝。",
            ),
        ]
        dimensions.append(
            HealthDimensionModel(
                key="value",
                title="價格與估值合理度（淨值比位階與殖利率保護）",
                scorePct=v_score,
                gradeText=_grade_text_from_pct(v_score),
                summaryComment="結合股價淨值比歷史位階、合理淨值比折溢價與現金殖利率評估買進划算度。",
                metrics=v_metrics,
            )
        )

        # 3. Momentum
        m_score = 55.0
        if _is_num(rev3):
            if float(rev3) > 5 and (_is_num(rev12) and float(rev3) >= float(rev12)):
                m_score += 22
            elif float(rev3) > 0:
                m_score += 10
            elif float(rev3) < -10:
                m_score -= 18
        if _is_num(bias200):
            if 0 <= float(bias200) <= 18:
                m_score += 15
            elif float(bias200) > 25 or float(bias200) < 0:
                m_score -= 12
        m_score = round(max(10.0, min(98.0, m_score)), 1)

        m_metrics = [
            HealthDimensionMetricModel(
                label="近 3 個月累計淨收益年增率",
                valueText=_fmt_num(rev3, 1, "%"),
                benchmarkText="年增率 > 0% 且優於全年均值",
                status="優秀" if (_is_num(rev3) and float(rev3) >= 10) else ("穩健" if (_is_num(rev3) and float(rev3) >= 0) else ("警訊" if _is_num(rev3) else "待確認")),
                comment="觀察最近一季營運淨收益是否維持正向成長動能。",
            ),
            HealthDimensionMetricModel(
                label="近 12 個月累計淨收益年增率",
                valueText=_fmt_num(rev12, 1, "%"),
                benchmarkText="全年累計年增率 >= 0%",
                status="優秀" if (_is_num(rev12) and float(rev12) >= 10) else ("穩健" if (_is_num(rev12) and float(rev12) >= 0) else ("警訊" if _is_num(rev12) else "待確認")),
                comment="檢視過去一年完整年度營收底氣是否穩健。",
            ),
            HealthDimensionMetricModel(
                label="收盤價與 200 日長期均線位置（年線乖離）",
                valueText=f"年線 {_fmt_num(ma200, 1, ' 元')}（乖離 {_fmt_num(bias200, 1, '%')}）",
                benchmarkText="站穩年線之上且正乖離 <= 18%",
                status="優秀" if (_is_num(bias200) and 0 <= float(bias200) <= 15) else ("偏貴" if (_is_num(bias200) and float(bias200) > 22) else ("警訊" if _is_num(bias200) else "待確認")),
                comment="金融股不適合在年線正乖離過大時追高，貼近年線布局更具安全邊際。",
            ),
            HealthDimensionMetricModel(
                label="過去一年風險調整後股價動能",
                valueText=_fmt_num(mom_s, 2, ""),
                benchmarkText="動能比值 >= 0.5 為強勢穩步墊高",
                status="優秀" if (_is_num(mom_s) and float(mom_s) >= 0.8) else ("穩健" if (_is_num(mom_s) and float(mom_s) >= 0.2) else ("警訊" if _is_num(mom_s) else "待確認")),
                comment="考量波動度後的過去一年趨勢強度，數值越高代表股價走勢越穩健。",
            ),
        ]
        dimensions.append(
            HealthDimensionModel(
                key="momentum",
                title="營運成長與趨勢動能（收益成長與年線位階）",
                scorePct=m_score,
                gradeText=_grade_text_from_pct(m_score),
                summaryComment="追蹤近月淨收益成長趨勢，並防範除權息前過度追高乖離。",
                metrics=m_metrics,
            )
        )

        total_score = round(q_score * 0.40 + v_score * 0.40 + m_score * 0.20, 1)

    elif is_cyc:
        # ================== 強景氣循環股模型 ==================
        roic_cyc = cyc.avgRoic5to7Y or ratios.roic3yAvgPct
        worst_cr = cyc.worstYearLiquidity.currentRatio or sz.latestCurrentRatio
        worst_nd = cyc.worstYearLiquidity.netDebtToEquityPct or sz.latestNetDebtToEquityPct
        asset_g = cyc.assetGrowthYoY
        pb_pct = cyc.pbPercentile5to7Y
        cur_pb = cyc.currentPB or ratios.pbRatio
        norm_ev_ebit = cyc.normalizedEvToEbit or ratios.evToEbitda
        roe_z = cyc.roeZScoreVs5to7Y
        rev3 = ratios.rev3mCumYoYPct
        rev12 = ratios.rev12mCumYoYPct
        bias200 = cyc.biasFromMa200Pct or ratios.trendVsMa200Pct
        latest_dio = cyc.latestDio
        dio_qoq = cyc.dioQoqChange
        gm_latest = cyc.grossMarginLatest
        gm_qoq = cyc.grossMarginQoQ

        # 過熱熔斷檢查
        if (
            _is_num(pb_pct)
            and float(pb_pct) >= 85
            and (
                (_is_num(asset_g) and float(asset_g) > 30)
                or ((cyc.consecutiveDioRiseQuarters or 0) >= 2 and _is_num(gm_qoq) and float(gm_qoq) < 0)
            )
        ):
            peak_circuit_breaker = True

        # 1. Quality (跨週期體質)
        q_score = 55.0
        if _is_num(roic_cyc):
            if float(roic_cyc) >= 12:
                q_score += 20
            elif float(roic_cyc) >= 8:
                q_score += 10
            elif float(roic_cyc) < 4:
                q_score -= 15
        if _is_num(worst_cr) and float(worst_cr) >= 1.5:
            q_score += 12
        if _is_num(asset_g) and float(asset_g) > 30:
            q_score -= 22
        elif _is_num(asset_g) and float(asset_g) <= 15:
            q_score += 10
        q_score = round(max(10.0, min(98.0, q_score)), 1)

        q_metrics = [
            HealthDimensionMetricModel(
                label="跨週期 5–7 年平均投入資本回報率（ROIC）",
                valueText=_fmt_num(roic_cyc, 1, "%"),
                benchmarkText="跨景氣循環平均 >= 8%（>= 12% 極優）",
                status="優秀" if (_is_num(roic_cyc) and float(roic_cyc) >= 12) else ("穩健" if (_is_num(roic_cyc) and float(roic_cyc) >= 7) else ("警訊" if _is_num(roic_cyc) else "待確認")),
                comment="撫平景氣高峰與谷底後的真實平均本業回報率，驗證公司是否具備長期護城河。",
            ),
            HealthDimensionMetricModel(
                label="景氣谷底流動比率與負債安全度",
                valueText=f"流動比 {_fmt_num(worst_cr, 2, ' 倍')}｜淨負債比 {_fmt_num(worst_nd, 0, '%')}",
                benchmarkText="流動比 >= 1.4 倍且淨負債比 <= 60%",
                status="優秀" if (_is_num(worst_cr) and float(worst_cr) >= 1.8) else ("穩健" if (_is_num(worst_cr) and float(worst_cr) >= 1.3) else ("警訊" if _is_num(worst_cr) else "待確認")),
                comment="檢驗公司在景氣最差年度是否仍有充足現金與低負債度過寒冬。",
            ),
            HealthDimensionMetricModel(
                label="總資產年增率（產能過度擴張警告）",
                valueText=_fmt_num(asset_g, 1, "%"),
                benchmarkText="溫和擴張 <= 18%（> 30% 為高點過度擴產警訊）",
                status="警訊" if (_is_num(asset_g) and float(asset_g) > 30) else ("優秀" if (_is_num(asset_g) and float(asset_g) <= 15) else ("穩健" if _is_num(asset_g) else "待確認")),
                comment="循環股若在景氣最高峰大舉擴廠使資產暴增，往往是供過於求反轉的領先警訊。",
            ),
        ]
        dimensions.append(
            HealthDimensionModel(
                key="quality",
                title="基本面賺錢實力（跨週期體質與谷底生存力）",
                scorePct=q_score,
                gradeText=_grade_text_from_pct(q_score),
                summaryComment="評估公司在完整景氣循環中的平均資本回報、谷底抗壓性與資本支出紀律。",
                metrics=q_metrics,
            )
        )

        # 2. Value (週期估值，避開低本益比陷阱)
        v_score = 55.0
        if _is_num(pb_pct):
            if float(pb_pct) <= 35:
                v_score += 25
            elif float(pb_pct) <= 55:
                v_score += 10
            elif float(pb_pct) >= 80:
                v_score -= 25
        if _is_num(norm_ev_ebit):
            if 0 < float(norm_ev_ebit) <= 12:
                v_score += 15
            elif float(norm_ev_ebit) > 22:
                v_score -= 15
        if _is_num(roe_z) and float(roe_z) > 1.5:
            v_score -= 15
        v_score = round(max(10.0, min(98.0, v_score)), 1)

        v_metrics = [
            HealthDimensionMetricModel(
                label="5–7 年歷史股價淨值比（P/B）河流位置",
                valueText=f"{_fmt_num(cur_pb, 2, ' 倍')}（歷史 {_fmt_num(pb_pct, 0, '% 分位')}）",
                benchmarkText="歷史 0%–50% 中低位階區（>= 80% 過熱警戒）",
                status="優秀" if (_is_num(pb_pct) and float(pb_pct) <= 35) else ("穩健" if (_is_num(pb_pct) and float(pb_pct) <= 60) else ("偏貴" if _is_num(pb_pct) else "待確認")),
                comment="循環股買在低股價淨值比（景氣谷底至復甦初段）、賣在高股價淨值比（景氣過熱期）。",
            ),
            HealthDimensionMetricModel(
                label="跨週期常態化企業價值倍數（EV/EBIT）",
                valueText=_fmt_num(norm_ev_ebit, 1, " 倍"),
                benchmarkText="常態化倍數 <= 14 倍為便宜（<= 10 倍極具吸引力）",
                status="優秀" if (_is_num(norm_ev_ebit) and 0 < float(norm_ev_ebit) <= 12) else ("穩健" if (_is_num(norm_ev_ebit) and float(norm_ev_ebit) <= 18) else ("偏貴" if _is_num(norm_ev_ebit) else "待確認")),
                comment="以 5–7 年平均營業利益率還原常態獲利，彻底避開景氣頂峰「假性低本益比」陷阱。",
            ),
            HealthDimensionMetricModel(
                label="現期獲利（ROE）偏離歷史均值程度",
                valueText=_fmt_num(roe_z, 2, " 倍標準差"),
                benchmarkText="偏離度 <= +1.0 倍標準差（> +1.5 代表獲利處於極端高峰）",
                status="偏貴" if (_is_num(roe_z) and float(roe_z) > 1.5) else ("優秀" if (_is_num(roe_z) and float(roe_z) <= 0.6) else ("穩健" if _is_num(roe_z) else "待確認")),
                comment="當現期 ROE 遠高於過去 5–7 年平均時，代表景氣已處於頂峰，不宜再以高獲利追價。",
            ),
        ]
        dimensions.append(
            HealthDimensionModel(
                key="value",
                title="價格與估值合理度（反景氣頂峰低本益比陷阱）",
                scorePct=v_score,
                gradeText=_grade_text_from_pct(v_score),
                summaryComment="改用 5–7 年歷史股價淨值比位階與常態化獲利倍數，防止在景氣最高點誤判為便宜。",
                metrics=v_metrics,
            )
        )

        # 3. Momentum (拐點動能)
        m_score = 55.0
        if _is_num(dio_qoq) and float(dio_qoq) < 0:
            m_score += 15
        elif (cyc.consecutiveDioRiseQuarters or 0) >= 2:
            m_score -= 18
        if _is_num(gm_qoq) and float(gm_qoq) > 0:
            m_score += 12
        elif _is_num(gm_qoq) and float(gm_qoq) < 0:
            m_score -= 10
        if _is_num(rev3) and float(rev3) > 0 and (_is_num(rev12) and float(rev3) >= float(rev12)):
            m_score += 12
        if _is_num(bias200) and (float(bias200) < 0 or float(bias200) > 40):
            m_score -= 12
        m_score = round(max(10.0, min(98.0, m_score)), 1)

        dio_txt = (
            f"{latest_dio:.0f} 天（較上季 {'+' if (dio_qoq or 0) > 0 else ''}{dio_qoq:.1f} 天）"
            if (_is_num(latest_dio) and _is_num(dio_qoq))
            else _fmt_num(latest_dio, 0, " 天")
        )
        gm_txt = (
            f"{gm_latest:.1f}%（較上季 {'+' if (gm_qoq or 0) > 0 else ''}{gm_qoq:.1f}%）"
            if (_is_num(gm_latest) and _is_num(gm_qoq))
            else _fmt_num(gm_latest, 1, "%")
        )
        m_metrics = [
            HealthDimensionMetricModel(
                label="近 8 季存貨週轉天數（DIO）去化趨勢",
                valueText=dio_txt,
                benchmarkText="存貨天數較上季下降（代表客戶拉貨加速）",
                status="優秀" if (_is_num(dio_qoq) and float(dio_qoq) < 0) else ("警訊" if ((cyc.consecutiveDioRiseQuarters or 0) >= 2) else ("穩健" if _is_num(latest_dio) else "待確認")),
                comment="存貨天數由高檔開始下滑是產業供需反轉向上的領先訊號；連續兩季上升則須提防庫存堆積。",
            ),
            HealthDimensionMetricModel(
                label="單季毛利率環比拐點（較上季變化）",
                valueText=gm_txt,
                benchmarkText="單季毛利率止跌回升（較上季 >= 0%）",
                status="優秀" if (_is_num(gm_qoq) and float(gm_qoq) > 0.5) else ("穩健" if (_is_num(gm_qoq) and float(gm_qoq) >= 0) else ("警訊" if _is_num(gm_qoq) else "待確認")),
                comment="反映產品報價與產能利用率變化，毛利率由谷底翻揚代表報價能力回溫。",
            ),
            HealthDimensionMetricModel(
                label="近 3 個月與近 12 個月累計營收年增率",
                valueText=f"近3月 {_fmt_num(rev3, 1, '%')}｜近12月 {_fmt_num(rev12, 1, '%')}",
                benchmarkText="近 3 月年增率 > 近 12 月年增率（營收加速回溫）",
                status="優秀" if (_is_num(rev3) and float(rev3) > 5 and (_is_num(rev12) and float(rev3) >= float(rev12))) else ("穩健" if (_is_num(rev3) and float(rev3) >= 0) else ("警訊" if _is_num(rev3) else "待確認")),
                comment="短期營收年增率超越長期年增率，確認訂單動能正在加速復甦。",
            ),
            HealthDimensionMetricModel(
                label="收盤價與 200 日長期均線位置（年線乖離）",
                valueText=f"年線 {_fmt_num(ma200, 1, ' 元')}（乖離 {_fmt_num(bias200, 1, '%')}）",
                benchmarkText="站上半年線或年線，且年線正乖離 <= 35%",
                status="優秀" if (_is_num(bias200) and 0 <= float(bias200) <= 25) else ("偏貴" if (_is_num(bias200) and float(bias200) > 40) else ("警訊" if _is_num(bias200) else "待確認")),
                comment="確認股價趨勢轉多，並避免在年線正乖離過大（短線過熱）時追高。",
            ),
        ]
        dimensions.append(
            HealthDimensionModel(
                key="momentum",
                title="營運成長與趨勢動能（庫存去化與毛利率拐點）",
                scorePct=m_score,
                gradeText=_grade_text_from_pct(m_score),
                summaryComment="追蹤存貨週轉天數去化、單季毛利率環比拐點與月營收加速動能。",
                metrics=m_metrics,
            )
        )

        total_score = round(q_score * 0.30 + v_score * 0.40 + m_score * 0.30, 1)

    else:
        # ================== 標準品質成長股模型 (Standard QVM) ==================
        roic = ratios.roic3yAvgPct
        gpa = ratios.gpaPct
        ocf_ni = ratios.ocfToNi3yPct
        f_score = ratios.piotroskiRaw
        ev_ebitda = ratios.evToEbitda
        fcf_y = ratios.fcfYieldPct
        pe = ratios.trailingPe
        div_y = ratios.dividendYieldPct
        rev3 = ratios.rev3mCumYoYPct
        rev12 = ratios.rev12mCumYoYPct
        mom_s = ratios.mom12m1mSharpe
        bias200 = ratios.trendVsMa200Pct

        # 1. Quality
        q_pts = 0.0
        if _is_num(roic):
            q_pts += 30.0 if float(roic) >= 15 else (24.0 if float(roic) >= 10 else (15.0 if float(roic) >= 6 else 6.0))
        else:
            q_pts += 16.0
        if _is_num(gpa):
            q_pts += 25.0 if float(gpa) >= 28 else (18.0 if float(gpa) >= 18 else 9.0)
        else:
            q_pts += 14.0
        if _is_num(ocf_ni):
            q_pts += 25.0 if float(ocf_ni) >= 100 else (18.0 if float(ocf_ni) >= 80 else 8.0)
        else:
            q_pts += 14.0
        if _is_num(f_score):
            q_pts += 20.0 if int(f_score) >= 7 else (14.0 if int(f_score) >= 5 else 6.0)
        else:
            q_pts += 12.0
        q_score = round(max(10.0, min(98.0, q_pts)), 1)

        q_metrics = [
            HealthDimensionMetricModel(
                label="近 3 年平均投入資本回報率（ROIC）",
                valueText=_fmt_num(roic, 1, "%"),
                benchmarkText="優質門檻 >= 12%（>= 15% 頂尖護城河）",
                status="優秀" if (_is_num(roic) and float(roic) >= 15) else ("穩健" if (_is_num(roic) and float(roic) >= 10) else ("警訊" if _is_num(roic) else "待確認")),
                comment="衡量公司每投入 100 元資本能創造多少本業稅後利潤，是巴菲特最看重的護城河指標。",
            ),
            HealthDimensionMetricModel(
                label="資產毛利率（毛利／總資產）",
                valueText=_fmt_num(gpa, 1, "%"),
                benchmarkText="優質門檻 >= 20%（>= 30% 高定價權）",
                status="優秀" if (_is_num(gpa) and float(gpa) >= 28) else ("穩健" if (_is_num(gpa) and float(gpa) >= 18) else ("警訊" if _is_num(gpa) else "待確認")),
                comment="結合產品毛利率與資產運用效率，越高代表產品競爭力與資產週轉越強。",
            ),
            HealthDimensionMetricModel(
                label="近 3 年盈餘現金轉換率（營業現金流／淨利）",
                valueText=_fmt_num(ocf_ni, 0, "%"),
                benchmarkText="健康標準 >= 90%（>= 100% 含金量極高）",
                status="優秀" if (_is_num(ocf_ni) and float(ocf_ni) >= 100) else ("穩健" if (_is_num(ocf_ni) and float(ocf_ni) >= 80) else ("警訊" if _is_num(ocf_ni) else "待確認")),
                comment="檢驗帳面賺到的淨利有多少比例真正變成現金流入公司，大於 100% 代表獲利品質極佳。",
            ),
            HealthDimensionMetricModel(
                label="財報財務強度（F-Score 9 項綜合健檢）",
                valueText=f"{int(f_score)} / 9 分" if _is_num(f_score) else "待確認",
                benchmarkText="穩健標準 >= 6 分（>= 7 分體質極強）",
                status="優秀" if (_is_num(f_score) and int(f_score) >= 7) else ("穩健" if (_is_num(f_score) and int(f_score) >= 5) else ("警訊" if _is_num(f_score) else "待確認")),
                comment="綜合檢視獲利能力、負債增減、流動性與毛利率是否較去年全面改善。",
            ),
        ]
        dimensions.append(
            HealthDimensionModel(
                key="quality",
                title="基本面賺錢實力（護城河與獲利含金量）",
                scorePct=q_score,
                gradeText=_grade_text_from_pct(q_score),
                summaryComment="從投入資本回報率、資產毛利效率與現金流轉換率，全方位檢驗公司真本事。",
                metrics=q_metrics,
            )
        )

        # 2. Value
        v_pts = 0.0
        if _is_num(ev_ebitda) and float(ev_ebitda) > 0:
            v_pts += 40.0 if float(ev_ebitda) <= 12 else (28.0 if float(ev_ebitda) <= 18 else (16.0 if float(ev_ebitda) <= 25 else 8.0))
        else:
            v_pts += 22.0
        if _is_num(fcf_y):
            v_pts += 32.0 if float(fcf_y) >= 5.5 else (22.0 if float(fcf_y) >= 3.0 else (12.0 if float(fcf_y) >= 0 else 4.0))
        else:
            v_pts += 16.0
        if _is_num(pe) and float(pe) > 0:
            v_pts += 28.0 if float(pe) <= 16 else (20.0 if float(pe) <= 24 else 10.0)
        else:
            v_pts += 16.0
        v_score = round(max(10.0, min(98.0, v_pts)), 1)

        v_metrics = [
            HealthDimensionMetricModel(
                label="企業價值倍數（EV/EBITDA）",
                valueText=_fmt_num(ev_ebitda, 1, " 倍"),
                benchmarkText="合理區間 <= 16 倍（<= 12 倍物美價廉）",
                status="優秀" if (_is_num(ev_ebitda) and 0 < float(ev_ebitda) <= 12) else ("穩健" if (_is_num(ev_ebitda) and float(ev_ebitda) <= 20) else ("偏貴" if _is_num(ev_ebitda) else "待確認")),
                comment="把市值加上負債、扣除現金後對比本業現金獲利，比單看本益比更精準反映收購回本年數。",
            ),
            HealthDimensionMetricModel(
                label="自由現金流殖利率",
                valueText=_fmt_num(fcf_y, 1, "%"),
                benchmarkText="穩健標準 >= 3.5%（>= 5.5% 現金回報極佳）",
                status="優秀" if (_is_num(fcf_y) and float(fcf_y) >= 5.5) else ("穩健" if (_is_num(fcf_y) and float(fcf_y) >= 2.5) else ("偏貴" if _is_num(fcf_y) else "待確認")),
                comment="公司扣除擴廠資本支出後，每年真正可自由支配發息或還債的現金報酬率。",
            ),
            HealthDimensionMetricModel(
                label="目前本益比（P/E）与現金股利殖利率",
                valueText=f"本益比 {_fmt_num(pe, 1, ' 倍')}｜殖利率 {_fmt_num(div_y, 1, '%')}",
                benchmarkText="本益比 12–22 倍且連續 5 年穩定配息",
                status="優秀" if (_is_num(pe) and 0 < float(pe) <= 16) else ("穩健" if (_is_num(pe) and float(pe) <= 25) else ("偏貴" if _is_num(pe) else "待確認")),
                comment="評估目前股價相當於幾年獲利，並搭配現金殖利率檢視下檔支撐力。",
            ),
        ]
        dimensions.append(
            HealthDimensionModel(
                key="value",
                title="價格與估值合理度（買進安全邊際）",
                scorePct=v_score,
                gradeText=_grade_text_from_pct(v_score),
                summaryComment="綜合企業價值倍數、自由現金流報酬率與本益比，確認目前買進價格是否划算。",
                metrics=v_metrics,
            )
        )

        # 3. Momentum
        m_pts = 0.0
        rev_acc = _is_num(rev3) and float(rev3) > 0 and (_is_num(rev12) and float(rev3) >= float(rev12))
        if rev_acc:
            m_pts += 42.0
        elif _is_num(rev3) and float(rev3) > 0:
            m_pts += 28.0
        elif _is_num(rev3):
            m_pts += 10.0
        else:
            m_pts += 20.0

        if _is_num(mom_s):
            m_pts += 35.0 if float(mom_s) >= 1.0 else (24.0 if float(mom_s) >= 0.3 else 10.0)
        else:
            m_pts += 18.0

        if _is_num(bias200):
            m_pts += 23.0 if 0 <= float(bias200) <= 25 else (14.0 if float(bias200) > 25 else 5.0)
        else:
            m_pts += 12.0
        m_score = round(max(10.0, min(98.0, m_pts)), 1)

        m_metrics = [
            HealthDimensionMetricModel(
                label="近 3 個月累計營收年增率（短期動能）",
                valueText=_fmt_num(rev3, 1, "%"),
                benchmarkText="年增率 > 0% 且較全年增速加快",
                status="優秀" if (_is_num(rev3) and float(rev3) >= 12) else ("穩健" if (_is_num(rev3) and float(rev3) >= 0) else ("警訊" if _is_num(rev3) else "待確認")),
                comment="台股每月 10 日前公布月營收，近 3 個月營收維持正成長代表訂單出貨暢旺。",
            ),
            HealthDimensionMetricModel(
                label="近 12 個月累計營收年增率（長線底氣）",
                valueText=_fmt_num(rev12, 1, "%"),
                benchmarkText="全年累計營收年增率 >= 0%",
                status="優秀" if (_is_num(rev12) and float(rev12) >= 10) else ("穩健" if (_is_num(rev12) and float(rev12) >= 0) else ("警訊" if _is_num(rev12) else "待確認")),
                comment="對比近 3 月與近 12 月營收年增率，可看出公司業績正在加速成長還是趨緩。",
            ),
            HealthDimensionMetricModel(
                label="過去一年風險調整後股價動能表現",
                valueText=_fmt_num(mom_s, 2, ""),
                benchmarkText="動能值 >= 0.5 代表強於大盤且波動可控",
                status="優秀" if (_is_num(mom_s) and float(mom_s) >= 1.0) else ("穩健" if (_is_num(mom_s) and float(mom_s) >= 0.3) else ("警訊" if _is_num(mom_s) else "待確認")),
                comment="衡量過去一年扣除上沖下洗劇烈波動後的穩健上漲趨勢強度。",
            ),
            HealthDimensionMetricModel(
                label="收盤價與 200 日長期均線位置（年線乖離）",
                valueText=f"年線 {_fmt_num(ma200, 1, ' 元')}（乖離 {_fmt_num(bias200, 1, '%')}）",
                benchmarkText="股價站穩年線之上（乖離 >= 0%）",
                status="優秀" if (_is_num(bias200) and 0 <= float(bias200) <= 22) else ("偏貴" if (_is_num(bias200) and float(bias200) > 32) else ("警訊" if _is_num(bias200) else "待確認")),
                comment="200 日均線（年線）代表長期生命線，站穩年線之上代表長線多頭格局完好。",
            ),
        ]
        dimensions.append(
            HealthDimensionModel(
                key="momentum",
                title="營運成長與趨勢動能（月營收增速與年線趨勢）",
                scorePct=m_score,
                gradeText=_grade_text_from_pct(m_score),
                summaryComment="結合台股獨有的月營收成長加速度與年線多空趨勢，避免買在下跌刀子。",
                metrics=m_metrics,
            )
        )

        total_score = round(q_score * 0.40 + v_score * 0.35 + m_score * 0.25, 1)

    # ================== 綜合評級與防偏科判定 ==================
    q_dim = dimensions[0].scorePct
    v_dim = dimensions[1].scorePct
    m_dim = dimensions[2].scorePct

    if has_fatal:
        grade: GradeLiteral = "F"
    else:
        if total_score >= 76:
            grade = "A"
        elif total_score >= 64:
            grade = "B"
        elif total_score >= 50:
            grade = "C"
        else:
            grade = "D"

        # 防偏科檢查：任一維度 < 40% 不得為 A；品質 < 40% 不得為 B
        if grade == "A" and (q_dim < 40 or v_dim < 40 or m_dim < 40):
            grade = "B"
        if grade == "B" and q_dim < 40:
            grade = "C"
        if peak_circuit_breaker and grade in ("A", "B"):
            grade = "C"

    # ================== 第一章：總體診斷結論 ==================
    if grade == "A":
        verdict_badge = "A 級｜核心買進標的"
        if is_fin:
            suitable_for = "長期防禦存股＋穩健領息"
            one_line = f"{name}長期獲利 ROE 與配息紀錄極為穩健，目前股價淨值比處於合理偏低區間且站穩年線，適合分批布局作為核心收息部位。"
        elif is_cyc:
            suitable_for = "週期反轉波段布局"
            one_line = f"{name}跨週期體質良好，目前歷史股價淨值比位階具安全邊際，且庫存去化與毛利率呈現正向拐點，適合依紀律分批布局。"
        else:
            suitable_for = "波段價差＋穩健領息"
            one_line = f"{name}本業獲利效率極高且現金流充沛，月營收成長動能強勁並站穩年線之上，建議依兩階段紀律分批建倉。"
    elif grade == "B":
        verdict_badge = "B 級｜優質觀察名單"
        if v_dim < 55:
            suitable_for = "拉回分批布局＋波段操作"
            one_line = f"{name}基本面賺錢實力與現金流表現優質，惟目前估值已反映部分樂觀預期，建議等待股價拉回貼近均線支撐時再分批布局。"
        elif m_dim < 55:
            suitable_for = "中長線逢低分批存股"
            one_line = f"{name}財務體質穩健且價格估值具吸引力，但短期營收或股價動能尚在整理，適合有耐心的投資人分批逢低承接。"
        else:
            suitable_for = "波段價差＋穩健領息"
            one_line = f"{name}整體財務品質、估值與營運趨勢皆在穩健水準之上，無重大防雷警訊，可列為重點觀察或小額試單標的。"
    elif grade == "C":
        if peak_circuit_breaker or (is_cyc and v_dim < 45):
            verdict_badge = "C 級｜景氣過熱觀望"
            suitable_for = "目前不建議追高介入"
            one_line = f"{name}目前股價淨值比已處於歷史高檔區，景氣循環接近高峰或擴產速度偏快，切勿被表面低本益比吸引而追高。"
        else:
            verdict_badge = "C 級｜中性觀望等待"
            suitable_for = "既有持倉續抱觀察、空手暫緩"
            one_line = f"{name}基本面安全無立即踩雷風險，但目前獲利動能或估值性價比表現平平，建議空手者暫時觀望，等待營收明顯轉強。"
    elif grade == "D":
        verdict_badge = "D 級｜體質轉弱避開"
        suitable_for = "目前不建議介入"
        one_line = f"{name}近期營運成長動能明顯降溫或股價跌破年線空頭排列，整體風險報酬比不佳，建議避開或趁反彈減碼。"
    else:
        verdict_badge = "F 級｜觸發防雷紅線"
        suitable_for = "目前不建議介入（高風險避開）"
        reason_str = "、".join(fatal_reasons) if fatal_reasons else "財務或籌碼安全指標觸發紅線"
        one_line = f"{name}因「{reason_str}」觸發系統一票否決防雷閘門，為保護本金安全，強烈建議避開。"

    exec_summary = HealthExecutiveSummaryModel(
        reportDate=report_date,
        totalScore=total_score,
        grade=grade,
        profileLabel=_profile_display_label(profile),
        verdictBadge=verdict_badge,
        oneLineDiagnosis=one_line,
        suitableFor=suitable_for,
    )

    # ================== 第四章：專屬買賣操作計畫書 ==================
    p_now = float(price) if _is_num(price) and float(price) > 0 else 0.0
    atr_val = float(atr20) if _is_num(atr20) and float(atr20) > 0 else round(max(0.5, p_now * 0.025), 2)
    h20_val = float(high_20d) if _is_num(high_20d) and float(high_20d) >= p_now else p_now
    ma200_val = round(float(ma200), 2) if _is_num(ma200) and float(ma200) > 0 else (round(p_now * 0.92, 2) if p_now > 0 else None)

    stop_loss = round(max(0.01, p_now - 2.5 * atr_val), 2) if p_now > 0 else None
    trail_mult = 2.0 if is_cyc else 3.0
    trailing_stop = round(max(0.01, h20_val - trail_mult * atr_val), 2) if h20_val > 0 else None

    low_entry = round(max(0.01, p_now - 0.8 * atr_val), 1) if p_now > 0 else 0.0
    high_entry = round(p_now + 0.3 * atr_val, 1) if p_now > 0 else 0.0

    can_buy = grade in ("A", "B") and not has_fatal
    if grade == "A":
        stance: Literal["BUY", "HOLD_OR_WATCH", "AVOID_OR_SELL"] = "BUY"
        stance_label = "建議分批買進"
    elif grade in ("B", "C"):
        stance = "HOLD_OR_WATCH"
        stance_label = "逢低布局／持有觀察" if grade == "B" else "觀望等待轉機"
    else:
        stance = "AVOID_OR_SELL"
        stance_label = "建議避開或逢高減碼"

    first_tranche = (30 if regime == "DEFENSIVE" else 50) if can_buy else 0

    if can_buy and p_now > 0:
        entry_zone_txt = (
            f"NT$ {low_entry:,.1f} ~ {high_entry:,.1f} 之間分批布局，"
            "建議於盤中量縮穩定時掛限價單，避開開盤前 15 分鐘急拉及漲停鎖死日。"
        )
        stop_ref_txt = f"NT$ {stop_loss:,.1f}" if stop_loss is not None else "停損防線"
        second_cond_txt = (
            f"首筆買進滿 1 個月或下次每月 10 日月營收公布後，確認近 3 月營收年增率維持正成長，"
            f"且收盤價穩守 {stop_ref_txt} 停損線與年線之上，再投入剩餘 {100 - first_tranche}% 資金完成建倉。"
        )
    else:
        entry_zone_txt = "目前未達安全買進標準，建議空手觀望，保留現金等待基本面或估值改善。"
        second_cond_txt = "待下季財報或月營收轉強、綜合評級重回 B 級以上且股價站回年線後，再重新啟動分批建倉計畫。"

    if is_cyc:
        fund_exit_rule = (
            "當歷史股價淨值比位階升破 85% 過熱區、或連續兩季存貨天數上升且單季毛利率轉跌、"
            "或收盤跌破移動停利價時，優先分批獲利了結。"
        )
    elif is_fin:
        fund_exit_rule = (
            "當股價淨值比大幅溢價超過合理值 1.25 倍以上、或最新季報逾放比連續上升、"
            "或配息能力受淨值減損限制時，建議分批減碼換股。"
        )
    else:
        fund_exit_rule = (
            "每季財報更新後若綜合評分跌破 60 分（降為 C/D 級）、或近 3 月累計營收年增率由正轉負且跌破季線時，"
            "依紀律分批獲利了結或換股操作。"
        )

    action_plan = HealthActionPlanModel(
        stance=stance,
        stanceLabel=stance_label,
        buyStrategy=HealthBuyStrategyModel(
            canBuyNow=can_buy,
            firstTranchePct=first_tranche,
            entryZoneText=entry_zone_txt,
            secondTrancheCondition=second_cond_txt,
        ),
        sellAndDefenseStrategy=HealthSellDefenseStrategyModel(
            stopLossPrice=stop_loss,
            ma200Price=ma200_val,
            trailingStopPrice=trailing_stop,
            fundamentalExitRule=fund_exit_rule,
        ),
    )

    # ================== 第五章：重要歷史數據序列 ==================
    q_trend = _extract_recent_8q_trend(income_rows, cyc)
    cur_pb_val = cyc.currentPB or ratios.pbRatio or (fin_sec.currentPB if fin_sec else None)
    pb_pct_val = cyc.pbPercentile5to7Y or (fin_sec.pbPercentile5to7Y if fin_sec else None)
    band = cyc.pbBand

    if _is_num(pb_pct_val):
        p_f = float(pb_pct_val)
        if p_f <= 30:
            pos_comment = f"目前股價淨值比處於近 5–7 年歷史低檔區（{p_f:.0f}% 分位），下檔安全邊際高。"
        elif p_f <= 65:
            pos_comment = f"目前股價淨值比處於近 5–7 年歷史中位合理區（{p_f:.0f}% 分位），估值中規中矩。"
        else:
            pos_comment = f"目前股價淨值比處於近 5–7 年歷史偏高區（{p_f:.0f}% 分位），追高須嚴守停利防線。"
    else:
        pos_comment = "歷史估值區間資料累積中，請同步參考企業價值倍數與本益比指標。"

    val_band = HealthValuationBandSummaryModel(
        metricLabel="近 5–7 年股價淨值比（P/B）歷史區間位置",
        currentValue=cur_pb_val,
        percentile5to7Y=pb_pct_val,
        minVal=band.min,
        p20Val=band.p20,
        p50Val=band.p50,
        p80Val=band.p80,
        maxVal=band.max,
        positionComment=pos_comment,
    )

    return HealthReportModel(
        executiveSummary=exec_summary,
        safetyCheckup=safety_items,
        dimensions=dimensions,
        actionPlan=action_plan,
        chartSeries=HealthChartSeriesModel(
            quarterlyTrend=q_trend,
            valuationBand=val_band,
        ),
    )
