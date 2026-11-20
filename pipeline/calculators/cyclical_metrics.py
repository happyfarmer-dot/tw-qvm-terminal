from __future__ import annotations

import math
from typing import Any, Literal, Optional

import numpy as np
import pandas as pd

from pipeline.calculators.financial_ratios import extract_annual_snapshots, safe_div


ValuationProfile = Literal[
    "standard",
    "cyclical_heavy_asset",
    "cyclical_inventory_order",
    "financial_bank",
    "financial_life_fhc",
]

HEAVY_ASSET_KEYWORDS = (
    "航運",
    "光電",
    "面板",
    "鋼鐵",
    "塑膠",
    "塑化",
    "造紙",
    "水泥",
    "玻璃",
    "記憶體",
)

INVENTORY_ORDER_KEYWORDS = (
    "半導體設備",
    "廠務",
    "設備",
    "IC設計",
    "IC 設計",
    "積體電路設計",
)

# 壽險主導／雙引擎金控 (富邦金、國泰金、凱基金/開發金、新光金等)
LIFE_FHC_SYMBOLS = {"2881", "2882", "2883", "2888", "2823", "2867"}
# 獨立銀行與銀行主導型金控 (兆豐金、第一金、合庫金、華南金、玉山金、永豐金、中信金、京城銀、台中銀等)
BANK_FHC_SYMBOLS = {
    "2886", "2892", "5880", "2880", "2884", "2890", "2891",
    "2809", "2812", "2834", "2836", "2838", "2845", "2849", "2887",
}

# 常見台股記憶體製造與半導體設備/IC設計代表代號輔助辨識
MEMORY_SYMBOLS = {"2337", "2344", "2408", "8299", "3006"}
SEMI_EQUIP_IC_DESIGN_SYMBOLS = {
    "2454", "3034", "3443", "3661", "6415", "5269", "6130",
    "3131", "3583", "6187", "6640", "2404", "6196",
}


def recommend_valuation_profile(
    sector: str, symbol: str = "", name: str = ""
) -> ValuationProfile:
    sec = (sector or "").strip()
    nm = (name or "").strip()
    sym = (symbol or "").strip().upper()
    combined = f"{sec} {nm}"

    if sym in LIFE_FHC_SYMBOLS or ("人壽" in combined or "壽險" in combined):
        return "financial_life_fhc"
    if sym in BANK_FHC_SYMBOLS or "金融" in sec or "銀行" in combined or "金控" in combined:
        return "financial_bank"
    if sym in MEMORY_SYMBOLS or any(kw in combined for kw in HEAVY_ASSET_KEYWORDS):
        return "cyclical_heavy_asset"
    if sym in SEMI_EQUIP_IC_DESIGN_SYMBOLS or any(kw in combined for kw in INVENTORY_ORDER_KEYWORDS):
        return "cyclical_inventory_order"
    return "standard"


def _pivot_by_date_with_origin(
    rows: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """依日期分組並保留 type / origin_name / value，自動忽略 _per 百分比列"""
    grouped: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        d = str(r.get("date", "")).strip()
        t = str(r.get("type", "")).strip()
        if not d or not t:
            continue
        if t.endswith("_per"):
            continue
        val = r.get("value")
        if val is None:
            continue
        try:
            num = float(val)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(num):
            continue
        grouped.setdefault(d, []).append(
            {
                "type": t,
                "origin_name": str(r.get("origin_name", "")).strip(),
                "value": num,
            }
        )
    return grouped


def _find_metric_value(
    items: list[dict[str, Any]],
    *,
    exact_types: tuple[str, ...] = (),
    type_contains: tuple[str, ...] = (),
    origin_contains: tuple[str, ...] = (),
    sum_matches: bool = False,
) -> Optional[float]:
    matches: list[float] = []
    for item in items:
        t = item["type"]
        orig = item["origin_name"]
        if t in exact_types:
            matches.append(item["value"])
        elif any(sub in t for sub in type_contains):
            matches.append(item["value"])
        elif any(sub in orig for sub in origin_contains):
            matches.append(item["value"])

    if not matches:
        return None
    if sum_matches:
        return sum(matches)
    return matches[0]


def _quarter_label(date_str: str) -> str:
    y = date_str[:4]
    m = int(date_str[5:7]) if len(date_str) >= 7 and date_str[5:7].isdigit() else 12
    q = (m - 1) // 3 + 1
    return f"{y}Q{q}"


def compute_pb_river_5to7y(
    *,
    price_df: pd.DataFrame,
    balance_rows: list[dict[str, Any]],
) -> tuple[Optional[float], Optional[float], dict[str, Optional[float]], bool]:
    """
    計算 5–7 年歷史 P/B 河流位階：
    使用未還原收盤價（或可用現價）對齊 PIT 最新已知每股淨值 (Equity / Shares)，
    取週頻/月頻樣本計算 currentPB, pbPercentile5to7Y 與 pbBand (min, p20, p50, p80, max)。
    同時偵測近 5 年是否出現股本大幅縮減 (> 15%) 疑似現金減資。
    """
    empty_band: dict[str, Optional[float]] = {
        "min": None,
        "p20": None,
        "p50": None,
        "p80": None,
        "max": None,
    }
    if price_df.empty or not balance_rows:
        return None, None, empty_band, False

    bal_grouped = _pivot_by_date_with_origin(balance_rows)
    bvps_points: list[tuple[str, float, float]] = []
    for d in sorted(bal_grouped.keys()):
        items = bal_grouped[d]
        eq = _find_metric_value(items, exact_types=("Equity", "TotalEquity", "StockholdersEquity"))
        cap_stock = _find_metric_value(items, exact_types=("OrdinaryShare", "CapitalStock", "CommonStock"))
        if eq is not None and cap_stock is not None and cap_stock > 0:
            shares = cap_stock / 10.0  # 台股面額 10 元
            if shares > 0:
                bvps = eq / shares
                if bvps > 0 and math.isfinite(bvps):
                    bvps_points.append((d, bvps, shares))

    if not bvps_points:
        return None, None, empty_band, False

    # 偵測近 5 年是否有股本大幅縮減 (> 15%)
    capital_reduction_suspected = False
    if len(bvps_points) >= 4:
        shares_series = [pt[2] for pt in bvps_points[-20:]]
        max_sh = max(shares_series)
        min_sh = min(shares_series)
        if max_sh > 0 and ((max_sh - min_sh) / max_sh) >= 0.15:
            # 確認是縮減而非增資：最高股本出現在最低股本之前
            if shares_series.index(max_sh) < shares_series.index(min_sh):
                capital_reduction_suspected = True

    p_col = "close" if "close" in price_df.columns else "adj_close"
    df = price_df[["date", p_col]].dropna().copy()
    df["date"] = df["date"].astype(str)
    df = df.sort_values("date")

    # 取約每 5 個交易日（週頻）進行 PIT 對齊，兼顧效能與分佈精度
    sampled = df.iloc[::5].copy()
    if not df.empty and (sampled.empty or sampled["date"].iloc[-1] != df["date"].iloc[-1]):
        sampled = pd.concat([sampled, df.iloc[[-1]]], ignore_index=True)

    pb_series: list[float] = []
    bvps_idx = 0
    for _, row in sampled.iterrows():
        p_date = str(row["date"])
        p_val = float(row[p_col])
        if p_val <= 0 or not math.isfinite(p_val):
            continue
        # PIT 對齊：只能使用財報日期 <= p_date 的最新已知 BVPS；若早於最早財報日期則跳過
        while bvps_idx + 1 < len(bvps_points) and bvps_points[bvps_idx + 1][0] <= p_date:
            bvps_idx += 1
        if bvps_points[bvps_idx][0] > p_date:
            continue
        bvps = bvps_points[bvps_idx][1]
        if bvps > 0:
            pb = p_val / bvps
            if math.isfinite(pb) and pb > 0:
                pb_series.append(pb)

    if not pb_series:
        return None, None, empty_band, capital_reduction_suspected

    arr = np.array(pb_series, dtype=float)
    current_pb = round(float(arr[-1]), 2)
    pct = round(float((arr <= arr[-1]).mean() * 100.0), 1)
    band = {
        "min": round(float(np.min(arr)), 2),
        "p20": round(float(np.percentile(arr, 20)), 2),
        "p50": round(float(np.percentile(arr, 50)), 2),
        "p80": round(float(np.percentile(arr, 80)), 2),
        "max": round(float(np.max(arr)), 2),
    }
    return current_pb, pct, band, capital_reduction_suspected


def compute_cyclical_metrics(
    *,
    price_df: pd.DataFrame,
    income_rows: list[dict[str, Any]],
    balance_rows: list[dict[str, Any]],
    cashflow_rows: list[dict[str, Any]],
    latest_price: Optional[float],
    ma200: Optional[float],
    trailing_pb_override: Optional[float] = None,
) -> dict[str, Any]:
    """計算強景氣循環股特化指標（缺值一律回傳 None）"""
    annuals = extract_annual_snapshots(income_rows, balance_rows, cashflow_rows)
    full_years = [s for s in annuals if (s.get("quarterCount") or 0) >= 4]
    if len(full_years) < 3:
        full_years = annuals

    history_years = float(len(full_years))

    # 1. P/B 河流位階
    current_pb, pb_pct, pb_band, cap_red = compute_pb_river_5to7y(
        price_df=price_df, balance_rows=balance_rows
    )
    if current_pb is None and trailing_pb_override is not None:
        current_pb = round(trailing_pb_override, 2)

    # 2. 季度資料整理（近 8 季 DIO、毛利率、合約負債、TTM 營收/獲利/資產）
    inc_q = _pivot_by_date_with_origin(income_rows)
    bal_q = _pivot_by_date_with_origin(balance_rows)
    cf_q = _pivot_by_date_with_origin(cashflow_rows)

    q_dates = sorted(set(inc_q.keys()) & set(bal_q.keys()))
    dio_series: list[dict[str, Any]] = []
    gm_series: list[dict[str, Any]] = []
    contract_liab_by_date: dict[str, Optional[float]] = {}
    rev_by_date: dict[str, Optional[float]] = {}
    assets_by_date: dict[str, Optional[float]] = {}

    prev_inv: Optional[float] = None
    for d in q_dates:
        inc_items = inc_q[d]
        bal_items = bal_q[d]

        rev = _find_metric_value(inc_items, exact_types=("Revenue", "OperatingRevenue"))
        gp = _find_metric_value(inc_items, exact_types=("GrossProfit",))
        cogs = _find_metric_value(inc_items, exact_types=("CostOfGoodsSold", "OperatingCosts"))
        if gp is None and rev is not None and cogs is not None:
            gp = rev - cogs
        if cogs is None and rev is not None and gp is not None:
            cogs = rev - gp

        inv = _find_metric_value(
            bal_items,
            exact_types=("Inventory", "Inventories"),
            origin_contains=("存貨",),
        )
        ta = _find_metric_value(bal_items, exact_types=("TotalAssets",))
        cl_val = _find_metric_value(
            bal_items,
            type_contains=("ContractLiabilities",),
            origin_contains=("合約負債",),
            sum_matches=True,
        )

        rev_by_date[d] = rev
        assets_by_date[d] = ta
        contract_liab_by_date[d] = cl_val

        # 單季毛利率
        gm = safe_div(gp, rev)
        gm_pct = round(gm * 100.0, 2) if gm is not None else None
        gm_series.append({"quarter": _quarter_label(d), "grossMarginPct": gm_pct})

        # 單季 DIO = (當季平均存貨 / 當季營業成本) * 90
        avg_inv = (
            (inv + prev_inv) / 2.0
            if (inv is not None and prev_inv is not None)
            else inv
        )
        dio_val: Optional[float] = None
        if avg_inv is not None and cogs is not None and cogs > 0:
            dio_val = round((avg_inv / cogs) * 90.0, 1)
        dio_series.append({"quarter": _quarter_label(d), "dio": dio_val})
        if inv is not None:
            prev_inv = inv

    dio_recent8 = dio_series[-8:]
    gm_recent8 = gm_series[-8:]

    valid_dios = [pt["dio"] for pt in dio_series if pt["dio"] is not None]
    latest_dio = valid_dios[-1] if valid_dios else None
    dio_qoq_change = (
        round(valid_dios[-1] - valid_dios[-2], 1) if len(valid_dios) >= 2 else None
    )
    consec_dio_rise = 0
    if len(valid_dios) >= 2:
        for i in range(len(valid_dios) - 1, 0, -1):
            if valid_dios[i] > valid_dios[i - 1]:
                consec_dio_rise += 1
            else:
                break

    valid_gms = [pt["grossMarginPct"] for pt in gm_series if pt["grossMarginPct"] is not None]
    gm_latest = valid_gms[-1] if valid_gms else None
    gm_qoq = round(valid_gms[-1] - valid_gms[-2], 2) if len(valid_gms) >= 2 else None
    gm_5y_pct: Optional[float] = None
    if len(valid_gms) >= 4:
        gm_win = np.array(valid_gms[-20:], dtype=float)
        gm_5y_pct = round(float((gm_win <= gm_win[-1]).mean() * 100.0), 1)

    # 合約負債 YoY 與佔營收比
    cl_yoy: Optional[float] = None
    cl_to_rev: Optional[float] = None
    if len(q_dates) >= 5:
        d_last = q_dates[-1]
        d_prev_y = f"{int(d_last[:4]) - 1}{d_last[4:]}"
        cl_now = contract_liab_by_date.get(d_last)
        cl_prev = contract_liab_by_date.get(d_prev_y)
        rev_now = rev_by_date.get(d_last)
        if cl_now is not None:
            r_cl = safe_div(cl_now, rev_now)
            if r_cl is not None:
                cl_to_rev = round(r_cl * 100.0, 2)
            if cl_prev is not None and cl_prev > 0:
                cl_yoy = round(((cl_now - cl_prev) / cl_prev) * 100.0, 2)

    # 總資產年增率 (assetGrowthYoY)
    asset_growth_yoy: Optional[float] = None
    if len(q_dates) >= 5:
        d_last = q_dates[-1]
        d_prev_y = f"{int(d_last[:4]) - 1}{d_last[4:]}"
        ta_now = assets_by_date.get(d_last)
        ta_prev = assets_by_date.get(d_prev_y)
        ag = safe_div((ta_now - ta_prev) if (ta_now is not None and ta_prev is not None) else None, ta_prev)
        if ag is not None:
            asset_growth_yoy = round(ag * 100.0, 2)

    # TTM 營收、TTM 淨利、資本支出/折舊
    ttm_rev: Optional[float] = None
    ttm_ni: Optional[float] = None
    if len(q_dates) >= 4:
        last4 = q_dates[-4:]
        revs4 = [_find_metric_value(inc_q[d], exact_types=("Revenue", "OperatingRevenue")) for d in last4]
        nis4 = [_find_metric_value(inc_q[d], exact_types=("IncomeAfterTaxes", "NetIncome")) for d in last4]
        if all(x is not None for x in revs4):
            ttm_rev = sum(x for x in revs4 if x is not None)
        if all(x is not None for x in nis4):
            ttm_ni = sum(x for x in nis4 if x is not None)

    capex_to_dep: Optional[float] = None
    cf_dates = sorted(cf_q.keys())
    if len(cf_dates) >= 4:
        last4_cf = cf_dates[-4:]
        capex4 = [
            _find_metric_value(
                cf_q[d],
                exact_types=("AcquisitionOfPropertyPlantAndEquipment", "CapitalExpenditure"),
            )
            for d in last4_cf
        ]
        dep4 = [
            _find_metric_value(cf_q[d], exact_types=("Depreciation", "DepreciationAndAmortization"))
            for d in last4_cf
        ]
        if all(x is not None for x in capex4) and all(x is not None for x in dep4):
            tot_capex = sum(abs(x) for x in capex4 if x is not None)
            tot_dep = sum(abs(x) for x in dep4 if x is not None)
            ratio_cd = safe_div(tot_capex, tot_dep)
            if ratio_cd is not None:
                capex_to_dep = round(ratio_cd, 2)

    # 3. 5–7 年 Damodaran 常態化 EV/EBIT 與跨週期體質
    win_years = full_years[-7:]
    op_margins: list[float] = []
    roics: list[float] = []
    roes: list[float] = []
    worst_cr: Optional[float] = None
    worst_nd_eq: Optional[float] = None
    worst_year_str: Optional[str] = None

    for y in win_years:
        rev_y = y.get("revenue")
        op_y = y.get("operatingIncome")
        ni_y = y.get("netIncome")
        eq_y = y.get("equity")
        ltd_y = y.get("longTermDebt") or 0.0
        cash_y = y.get("cash") or 0.0
        ca_y = y.get("currentAssets")
        cl_y = y.get("currentLiabilities")

        om = safe_div(op_y, rev_y)
        if om is not None:
            op_margins.append(om)

        if op_y is not None and eq_y is not None:
            ic = eq_y + ltd_y - cash_y
            r_ic = safe_div(op_y * 0.8, ic)
            if r_ic is not None and ic > 0:
                roics.append(r_ic * 100.0)

        r_oe = safe_div(ni_y, eq_y)
        if r_oe is not None and eq_y is not None and eq_y > 0:
            roes.append(r_oe * 100.0)

        cr_y = safe_div(ca_y, cl_y)
        nd_eq_y = safe_div(ltd_y - cash_y, eq_y)
        if cr_y is not None:
            if worst_cr is None or cr_y < worst_cr:
                worst_cr = round(cr_y, 2)
                worst_year_str = str(int(y["year"])) if y.get("year") else None
                if nd_eq_y is not None:
                    worst_nd_eq = round(nd_eq_y * 100.0, 2)

    avg_op_margin = (sum(op_margins) / len(op_margins)) if op_margins else None
    avg_op_margin_pct = round(avg_op_margin * 100.0, 2) if avg_op_margin is not None else None
    avg_roic_5to7y = round(sum(roics) / len(roics), 2) if roics else None

    normalized_ebit: Optional[float] = None
    normalized_ev_to_ebit: Optional[float] = None
    if avg_op_margin is not None and ttm_rev is not None and ttm_rev > 0:
        norm_ebit_val = avg_op_margin * ttm_rev
        normalized_ebit = round(norm_ebit_val, 2)
        if norm_ebit_val > 0 and latest_price is not None and latest_price > 0:
            last_y = win_years[-1] if win_years else {}
            cap_stock = last_y.get("shares")
            if cap_stock is not None and cap_stock > 0 and last_y.get("equity") is not None:
                mcap = latest_price * (cap_stock / 10.0)
                ev = mcap + (last_y.get("longTermDebt") or 0.0) - (last_y.get("cash") or 0.0)
                normalized_ev_to_ebit = round(ev / norm_ebit_val, 2)

    # 現期 ROE Z-Score vs 5-7Y
    roe_z: Optional[float] = None
    if len(roes) >= 3 and ttm_ni is not None and win_years:
        last_eq = win_years[-1].get("equity")
        ttm_roe = safe_div(ttm_ni, last_eq)
        if ttm_roe is not None and last_eq is not None and last_eq > 0:
            ttm_roe_pct = ttm_roe * 100.0
            mean_roe = float(np.mean(roes))
            std_roe = float(np.std(roes, ddof=1))
            if math.isfinite(std_roe) and std_roe > 0:
                roe_z = round((ttm_roe_pct - mean_roe) / std_roe, 2)

    # 200MA 正乖離 (%)
    bias_ma200_pct: Optional[float] = None
    if latest_price is not None and ma200 is not None and ma200 > 0:
        bias_ma200_pct = round(((latest_price - ma200) / ma200) * 100.0, 2)

    return {
        "currentPB": current_pb,
        "pbPercentile5to7Y": pb_pct,
        "pbBand": pb_band,
        "avgOpMargin5to7Y": avg_op_margin_pct,
        "normalizedEBIT": normalized_ebit,
        "normalizedEvToEbit": normalized_ev_to_ebit,
        "avgRoic5to7Y": avg_roic_5to7y,
        "roeZScoreVs5to7Y": roe_z,
        "assetGrowthYoY": asset_growth_yoy,
        "capexToDepreciation": capex_to_dep,
        "worstYearLiquidity": {
            "year": worst_year_str,
            "currentRatio": worst_cr,
            "netDebtToEquityPct": worst_nd_eq,
        },
        "latestDio": latest_dio,
        "dioQoqChange": dio_qoq_change,
        "consecutiveDioRiseQuarters": consec_dio_rise if len(valid_dios) >= 2 else None,
        "dioQuarterlySeries": dio_recent8,
        "contractLiabilitiesYoY": cl_yoy,
        "contractLiabilitiesToRev": cl_to_rev,
        "grossMarginLatest": gm_latest,
        "grossMarginQoQ": gm_qoq,
        "grossMargin5yPercentile": gm_5y_pct,
        "grossMarginQuarterlySeries": gm_recent8,
        "biasFromMa200Pct": bias_ma200_pct,
        "historyYearsAvailable": history_years,
        "capitalReductionSuspected": cap_red,
    }
