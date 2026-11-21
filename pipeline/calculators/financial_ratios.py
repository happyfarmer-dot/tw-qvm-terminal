from __future__ import annotations

import math
from typing import Any, Optional

import pandas as pd


def safe_div(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    if numerator is None or denominator is None:
        return None
    if not (math.isfinite(numerator) and math.isfinite(denominator)):
        return None
    if denominator == 0:
        return None
    val = numerator / denominator
    return val if math.isfinite(val) else None


def pivot_finmind_statements(rows: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    """將 FinMind 長表格 (date, type, value) 轉換為 {date: {metric_name: float}}"""
    pivoted: dict[str, dict[str, float]] = {}
    for r in rows:
        d = str(r.get("date", "")).strip()
        t = str(r.get("type", "")).strip()
        v = r.get("value")
        if not d or not t or v is None:
            continue
        try:
            num = float(v)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(num):
            continue
        pivoted.setdefault(d, {})[t] = num
    return pivoted


def _pick(row: dict[str, float], keys: list[str]) -> Optional[float]:
    for k in keys:
        if k in row and math.isfinite(row[k]):
            return row[k]
    return None


def _pick_abs(row: dict[str, float], keys: list[str]) -> Optional[float]:
    val = _pick(row, keys)
    return abs(val) if val is not None else None


def _resolve_annual_flow(
    src: dict[str, dict[str, float]],
    dlist: list[str],
    keys: list[str],
    is_ytd_statement: bool = False,
) -> Optional[float]:
    """
    計算年度損益或現金流流量科目（嚴防 FinMind 累計 YTD 報表被重複加總 4 次）：
    - 現金流量表 (`TaiwanStockCashFlowsStatement`) 在 FinMind 為累計 YTD 數據：
      若該年度有 `-12-31` 年報列，必須只取 `-12-31` 該列數值（即全年累計數）；
    - 綜合損益表 (`TaiwanStockFinancialStatements`) 在 FinMind 通常為單季數，
      但若測試資料或特殊報表僅提供 `-12-31` 單一列年報、或數值呈現單調遞增 YTD 特徵，則自動判斷：
      若為 YTD 則取 `-12-31` 列；若為 4 季單季數則加總該年度 4 季。
    """
    if not dlist:
        return None
    dec31 = [d for d in dlist if d.endswith("-12-31")]
    vals_by_d = [(d, _pick(src[d], keys)) for d in sorted(dlist)]
    valid = [(d, v) for d, v in vals_by_d if v is not None]
    if not valid:
        return None

    # 1. 若明確為 YTD 累計報表（如現金流量表），優先取 -12-31 年報列
    if is_ytd_statement:
        if dec31:
            v_dec = _pick(src[dec31[-1]], keys)
            if v_dec is not None:
                return v_dec
        return valid[-1][1]

    # 2. 若該年僅有 -12-31 一筆年報列，直接取該列
    if len(valid) == 1 and valid[0][0].endswith("-12-31"):
        return valid[0][1]

    # 3. 檢查損益表是否實際上被填入 YTD 累計數（例如 Q4 >= Q1+Q2+Q3 * 0.85 且正數單調大幅遞增）
    if len(valid) >= 3 and valid[-1][0].endswith("-12-31"):
        v_list = [v for _, v in valid]
        if all(v > 0 for v in v_list) and v_list[0] < v_list[1] < v_list[-1]:
            if v_list[-1] >= sum(v_list[:-1]) * 0.82 and (v_list[-1] / v_list[0]) >= 2.6:
                return v_list[-1]

    return sum(v for _, v in valid)


def extract_annual_snapshots(
    income_rows: list[dict[str, Any]],
    balance_rows: list[dict[str, Any]],
    cashflow_rows: list[dict[str, Any]],
) -> list[dict[str, Optional[float]]]:
    """
    從近 5–7 年財報抽取完整會計年度快照（優先篩選具備 `-12-31` 年報列之完整會計年度），
    嚴格避免將累計季報（YTD）重複加總。回傳依年份升冪排序之列表。
    """
    inc = pivot_finmind_statements(income_rows)
    bal = pivot_finmind_statements(balance_rows)
    cf = pivot_finmind_statements(cashflow_rows)

    all_dates = sorted(set(inc.keys()) | set(bal.keys()) | set(cf.keys()))
    if not all_dates:
        return []

    by_year: dict[str, list[str]] = {}
    for d in all_dates:
        year = d[:4]
        by_year.setdefault(year, []).append(d)

    snapshots: list[dict[str, Optional[float]]] = []
    for year in sorted(by_year.keys()):
        dates = sorted(by_year[year])
        dec31_dates = [d for d in dates if d.endswith("-12-31")]
        has_annual_close = len(dec31_dates) > 0
        last_d = dec31_dates[-1] if has_annual_close else dates[-1]
        b_row = bal.get(last_d, {})

        inc_dates = [d for d in dates if d in inc]
        cf_dates = [d for d in dates if d in cf]

        revenue = _resolve_annual_flow(inc, inc_dates, ["Revenue", "OperatingRevenue"], is_ytd_statement=False)
        gross_profit = _resolve_annual_flow(inc, inc_dates, ["GrossProfit"], is_ytd_statement=False)
        cogs = _resolve_annual_flow(inc, inc_dates, ["CostOfGoodsSold", "OperatingCosts"], is_ytd_statement=False)
        if gross_profit is None and revenue is not None and cogs is not None:
            gross_profit = revenue - cogs

        op_income = _resolve_annual_flow(inc, inc_dates, ["OperatingIncome", "OperatingProfit"], is_ytd_statement=False)
        sga = _resolve_annual_flow(inc, inc_dates, ["OperatingExpenses", "SellingAndAdministrativeExpenses"], is_ytd_statement=False)
        if sga is None and gross_profit is not None and op_income is not None:
            sga = gross_profit - op_income

        net_income = _resolve_annual_flow(
            inc,
            inc_dates,
            ["IncomeAfterTaxes", "NetIncome", "IncomeFromContinuingOperations"],
            is_ytd_statement=False,
        )
        eps = _resolve_annual_flow(inc, inc_dates, ["EPS"], is_ytd_statement=False)
        interest_exp = _resolve_annual_flow(inc, inc_dates, ["InterestExpense", "FinanceCosts"], is_ytd_statement=False)

        # 現金流量表在 FinMind 皆為 YTD 累計至該季，必須只取 -12-31 年報列！
        depreciation = _resolve_annual_flow(
            cf,
            cf_dates,
            ["Depreciation", "DepreciationAndAmortization"],
            is_ytd_statement=True,
        )
        ocf = _resolve_annual_flow(
            cf,
            cf_dates,
            ["CashFlowsFromOperatingActivities", "OperatingCashFlow"],
            is_ytd_statement=True,
        )
        capex = _resolve_annual_flow(
            cf,
            cf_dates,
            [
                "AcquisitionOfPropertyPlantAndEquipment",
                "CapitalExpenditure",
                "PropertyAndPlantAndEquipment",
            ],
            is_ytd_statement=True,
        )
        capex_abs = abs(capex) if capex is not None else None
        div_paid = _resolve_annual_flow(cf, cf_dates, ["CashDividendsPaid", "DividendsPaid"], is_ytd_statement=True)

        total_assets = _pick(b_row, ["TotalAssets"])
        current_assets = _pick(b_row, ["CurrentAssets"])
        current_liab = _pick(b_row, ["CurrentLiabilities"])
        ar = _pick(b_row, ["AccountsReceivable", "AccountsReceivableNet", "NotesAndAccountsReceivable"])
        inv = _pick(b_row, ["Inventory", "Inventories"])
        ppe = _pick(b_row, ["PropertyPlantAndEquipment"])
        cash = _pick(b_row, ["CashAndCashEquivalents"])
        lt_debt = _pick(
            b_row,
            [
                "LongtermBorrowings",
                "LongTermLiabilities",
                "LongTermDebt",
                "BondsPayable",
                "NoncurrentLiabilities",
                "NonCurrentLiabilities",
            ],
        )
        total_liab = _pick(b_row, ["TotalLiabilities", "Liabilities"])
        equity = _pick(b_row, ["Equity", "TotalEquity", "StockholdersEquity", "EquityAttributableToOwnersOfParent"])
        retained_earnings = _pick(b_row, ["RetainedEarnings"])
        shares = _pick(b_row, ["OrdinaryShare", "CapitalStock", "CommonStock"])

        q_count = 4.0 if has_annual_close else float(len(inc_dates))

        snapshots.append(
            {
                "year": float(year),
                "hasAnnualClose": 1.0 if has_annual_close else 0.0,
                "quarterCount": q_count,
                "revenue": revenue,
                "grossProfit": gross_profit,
                "operatingIncome": op_income,
                "sga": sga,
                "netIncome": net_income,
                "eps": eps,
                "interestExpense": abs(interest_exp) if interest_exp is not None else None,
                "depreciation": abs(depreciation) if depreciation is not None else None,
                "ocf": ocf,
                "capex": capex_abs,
                "dividendsPaid": abs(div_paid) if div_paid is not None else None,
                "totalAssets": total_assets,
                "currentAssets": current_assets,
                "currentLiabilities": current_liab,
                "ar": ar,
                "inventory": inv,
                "ppe": ppe,
                "cash": cash,
                "longTermDebt": lt_debt,
                "totalLiabilities": total_liab,
                "equity": equity,
                "retainedEarnings": retained_earnings,
                "shares": shares,
            }
        )

    return snapshots


def compute_ttm_metrics(
    income_rows: list[dict[str, Any]],
    cashflow_rows: list[dict[str, Any]],
) -> dict[str, Optional[float]]:
    """
    計算近四季（TTM）指標：
    - 對 YTD 累計制報表（如現金流量表 OCF / CapEx / 折舊）：
      若最新一期為 `-12-31` Q4 年報，直接取該年報列；
      若最新一期為非 Q4（如 `2026-09-30`），則精確使用：
      `TTM = 最新累計季報 (2026-09-30) + 前一年度年報 (2025-12-31) - 前一年同季累計季報 (2025-09-30)`。
    - 對單季制報表（如綜合損益表 EPS / 營收 / 營業利益 / 淨利）：
      若該科目為 YTD 則同樣套用 `最新累計 + 前一年報 - 前一年同季累計`，若為單季則取最近 4 個季度相加。
    """
    inc = pivot_finmind_statements(income_rows)
    cf = pivot_finmind_statements(cashflow_rows)

    def calc_ytd_ttm(src: dict[str, dict[str, float]], keys: list[str]) -> Optional[float]:
        dates = sorted(d for d in src.keys() if _pick(src[d], keys) is not None)
        if not dates:
            return None
        latest_d = dates[-1]
        v_latest = _pick(src[latest_d], keys)
        if v_latest is None:
            return None
        if latest_d.endswith("-12-31"):
            return v_latest
        yr = int(latest_d[:4])
        suffix = latest_d[4:]  # e.g. "-09-30"
        prev_annual_d = f"{yr - 1}-12-31"
        prev_same_q_d = f"{yr - 1}{suffix}"
        v_prev_ann = _pick(src.get(prev_annual_d, {}), keys)
        v_prev_q = _pick(src.get(prev_same_q_d, {}), keys)
        if v_prev_ann is not None and v_prev_q is not None:
            return v_latest + v_prev_ann - v_prev_q
        if v_prev_ann is not None:
            return v_prev_ann
        return v_latest

    def calc_inc_ttm(keys: list[str]) -> Optional[float]:
        dates = sorted(d for d in inc.keys() if _pick(inc[d], keys) is not None)
        if not dates:
            return None
        latest_d = dates[-1]
        yr = latest_d[:4]
        same_yr_dates = [d for d in dates if d.startswith(yr)]
        # 判斷是否為 YTD 報表
        prev_yr = str(int(yr) - 1)
        prev_yr_dates = [d for d in dates if d.startswith(prev_yr)]
        is_ytd = False
        if len(prev_yr_dates) >= 3 and prev_yr_dates[-1].endswith("-12-31"):
            v_p = [_pick(inc[d], keys) or 0.0 for d in prev_yr_dates]
            if all(v > 0 for v in v_p) and v_p[0] < v_p[1] < v_p[-1] and v_p[-1] >= sum(v_p[:-1]) * 0.82:
                is_ytd = True
        elif len(same_yr_dates) == 1 and latest_d.endswith("-12-31"):
            is_ytd = True

        if is_ytd:
            return calc_ytd_ttm(inc, keys)

        if len(dates) >= 4:
            vals4 = [_pick(inc[d], keys) for d in dates[-4:]]
            if all(v is not None for v in vals4):
                return sum(v for v in vals4 if v is not None)
        return _pick(inc[latest_d], keys)

    ttm_ocf = calc_ytd_ttm(cf, ["CashFlowsFromOperatingActivities", "OperatingCashFlow"])
    ttm_capex_raw = calc_ytd_ttm(
        cf,
        [
            "AcquisitionOfPropertyPlantAndEquipment",
            "CapitalExpenditure",
            "PropertyAndPlantAndEquipment",
        ],
    )
    ttm_capex = abs(ttm_capex_raw) if ttm_capex_raw is not None else None
    ttm_dep_raw = calc_ytd_ttm(cf, ["Depreciation", "DepreciationAndAmortization"])
    ttm_dep = abs(ttm_dep_raw) if ttm_dep_raw is not None else None

    ttm_rev = calc_inc_ttm(["Revenue", "OperatingRevenue"])
    ttm_op_inc = calc_inc_ttm(["OperatingIncome", "OperatingProfit"])
    ttm_ni = calc_inc_ttm(["IncomeAfterTaxes", "NetIncome", "IncomeFromContinuingOperations"])
    ttm_eps = calc_inc_ttm(["EPS"])

    return {
        "ttmRevenue": ttm_rev,
        "ttmOperatingIncome": ttm_op_inc,
        "ttmNetIncome": ttm_ni,
        "ttmEps": round(ttm_eps, 2) if ttm_eps is not None else None,
        "ttmOcf": ttm_ocf,
        "ttmCapex": ttm_capex,
        "ttmDepreciation": ttm_dep,
    }


def compute_beneish_m_score(
    curr: dict[str, Optional[float]],
    prev: dict[str, Optional[float]],
) -> Optional[float]:
    """
    Beneish 8 因子 M-Score 模型：
    M = -4.84 + 0.920*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI
        + 0.115*DEPI - 0.172*SGAI + 4.679*TATA - 0.327*LVGI
    任意關鍵欄位缺失或分母為 0 時回傳 None（嚴禁靜默補 0）。
    """
    dsri = safe_div(
        safe_div(curr.get("ar"), curr.get("revenue")),
        safe_div(prev.get("ar"), prev.get("revenue")),
    )
    gm_curr = safe_div(curr.get("grossProfit"), curr.get("revenue"))
    gm_prev = safe_div(prev.get("grossProfit"), prev.get("revenue"))
    gmi = safe_div(gm_prev, gm_curr)

    ca_ppe_curr = (
        (curr["currentAssets"] + curr["ppe"])
        if curr.get("currentAssets") is not None and curr.get("ppe") is not None
        else None
    )
    ca_ppe_prev = (
        (prev["currentAssets"] + prev["ppe"])
        if prev.get("currentAssets") is not None and prev.get("ppe") is not None
        else None
    )
    aq_curr = (
        1.0 - safe_div(ca_ppe_curr, curr.get("totalAssets"))
        if safe_div(ca_ppe_curr, curr.get("totalAssets")) is not None
        else None
    )
    aq_prev = (
        1.0 - safe_div(ca_ppe_prev, prev.get("totalAssets"))
        if safe_div(ca_ppe_prev, prev.get("totalAssets")) is not None
        else None
    )
    aqi = safe_div(aq_curr, aq_prev) if aq_prev not in (None, 0) else (1.0 if aq_curr == 0 else None)

    sgi = safe_div(curr.get("revenue"), prev.get("revenue"))

    dep_curr_den = (
        curr["depreciation"] + curr["ppe"]
        if curr.get("depreciation") is not None and curr.get("ppe") is not None
        else None
    )
    dep_prev_den = (
        prev["depreciation"] + prev["ppe"]
        if prev.get("depreciation") is not None and prev.get("ppe") is not None
        else None
    )
    depi = safe_div(
        safe_div(prev.get("depreciation"), dep_prev_den),
        safe_div(curr.get("depreciation"), dep_curr_den),
    )

    sgai = safe_div(
        safe_div(curr.get("sga"), curr.get("revenue")),
        safe_div(prev.get("sga"), prev.get("revenue")),
    )
    lvgi = safe_div(
        safe_div(curr.get("totalLiabilities"), curr.get("totalAssets")),
        safe_div(prev.get("totalLiabilities"), prev.get("totalAssets")),
    )
    tata = (
        safe_div(curr["netIncome"] - curr["ocf"], curr.get("totalAssets"))
        if curr.get("netIncome") is not None and curr.get("ocf") is not None
        else None
    )

    factors = [dsri, gmi, aqi, sgi, depi, sgai, lvgi, tata]
    if any(f is None for f in factors):
        return None

    m = (
        -4.84
        + 0.920 * dsri  # type: ignore[operator]
        + 0.528 * gmi  # type: ignore[operator]
        + 0.404 * aqi  # type: ignore[operator]
        + 0.892 * sgi  # type: ignore[operator]
        + 0.115 * depi  # type: ignore[operator]
        - 0.172 * sgai  # type: ignore[operator]
        + 4.679 * tata  # type: ignore[operator]
        - 0.327 * lvgi  # type: ignore[operator]
    )
    return round(m, 3) if math.isfinite(m) else None


def compute_altman_scores(
    curr: dict[str, Optional[float]],
    market_cap_twd: Optional[float],
) -> tuple[Optional[float], Optional[float]]:
    """
    計算製造業 Altman Z-Score 與非製造業 Altman Z''-Score。
    缺失欄位時回傳 None。
    """
    ta = curr.get("totalAssets")
    ca = curr.get("currentAssets")
    cl = curr.get("currentLiabilities")
    re = curr.get("retainedEarnings")
    ebit = curr.get("operatingIncome")
    tl = curr.get("totalLiabilities")
    eq = curr.get("equity")
    rev = curr.get("revenue")

    if ta is None or ta <= 0 or ca is None or cl is None or re is None or ebit is None or tl is None or tl <= 0:
        return None, None

    x1 = (ca - cl) / ta
    x2 = re / ta
    x3 = ebit / ta

    z_mfg: Optional[float] = None
    if market_cap_twd is not None and rev is not None:
        x4 = market_cap_twd / tl
        x5 = rev / ta
        z_mfg = round(1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5, 3)

    z_non_mfg: Optional[float] = None
    if eq is not None:
        x4_book = eq / tl
        z_non_mfg = round(6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4_book, 3)

    return z_mfg, z_non_mfg


def compute_piotroski_checks(
    curr: dict[str, Optional[float]],
    prev: dict[str, Optional[float]],
) -> tuple[dict[str, Optional[bool]], Optional[int]]:
    """
    計算 Piotroski F-Score 9 項布林明細。
    若某項目計算基礎欄位缺失，該項回傳 None；全 9 項皆具備時回傳 rawScore (0-9)，否則 rawScore 為 None。
    """
    roa_curr = safe_div(curr.get("netIncome"), curr.get("totalAssets"))
    roa_prev = safe_div(prev.get("netIncome"), prev.get("totalAssets"))
    ocf = curr.get("ocf")
    ni = curr.get("netIncome")

    ta_curr = curr.get("totalAssets")
    ta_prev = prev.get("totalAssets")
    ltd_val_curr = curr.get("longTermDebt") if curr.get("longTermDebt") is not None else (0.0 if ta_curr is not None else None)
    ltd_val_prev = prev.get("longTermDebt") if prev.get("longTermDebt") is not None else (0.0 if ta_prev is not None else None)
    ltd_curr = safe_div(ltd_val_curr, ta_curr)
    ltd_prev = safe_div(ltd_val_prev, ta_prev)

    cr_curr = safe_div(curr.get("currentAssets"), curr.get("currentLiabilities"))
    cr_prev = safe_div(prev.get("currentAssets"), prev.get("currentLiabilities"))

    gm_curr = safe_div(curr.get("grossProfit"), curr.get("revenue"))
    gm_prev = safe_div(prev.get("grossProfit"), prev.get("revenue"))

    at_curr = safe_div(curr.get("revenue"), curr.get("totalAssets"))
    at_prev = safe_div(prev.get("revenue"), prev.get("totalAssets"))

    sh_curr = curr.get("shares")
    sh_prev = prev.get("shares")

    checks: dict[str, Optional[bool]] = {
        "positiveRoa": (roa_curr > 0) if roa_curr is not None else None,
        "roaImproving": (roa_curr > roa_prev) if (roa_curr is not None and roa_prev is not None) else None,
        "positiveOcf": (ocf > 0) if ocf is not None else None,
        "ocfGreaterThanNetIncome": (ocf > ni) if (ocf is not None and ni is not None) else None,
        "lowerLongTermDebtRatio": (ltd_curr <= ltd_prev) if (ltd_curr is not None and ltd_prev is not None) else None,
        "higherCurrentRatio": (cr_curr > cr_prev) if (cr_curr is not None and cr_prev is not None) else None,
        "noShareDilution": (sh_curr <= sh_prev * 1.01) if (sh_curr is not None and sh_prev is not None) else None,
        "higherGrossMargin": (gm_curr > gm_prev) if (gm_curr is not None and gm_prev is not None) else None,
        "higherAssetTurnover": (at_curr > at_prev) if (at_curr is not None and at_prev is not None) else None,
    }

    if all(v is not None for v in checks.values()):
        raw = sum(1 for v in checks.values() if v is True)
    else:
        raw = None

    return checks, raw


def compute_monthly_revenue_momentum(
    rev_rows: list[dict[str, Any]],
) -> tuple[Optional[float], Optional[float], Optional[bool]]:
    """
    計算台股月營收動能：
    - 近 3 個月累計營收 YoY (%)
    - 近 12 個月累計營收 YoY (%)
    - 同時檢查最新兩季應收/存貨是否異常膨脹 (此處預設從財報函式補充)
    """
    if not rev_rows:
        return None, None, None

    df = pd.DataFrame(rev_rows).copy()
    if not {"revenue_year", "revenue_month", "revenue"}.issubset(df.columns):
        return None, None, None

    df["revenue_year"] = pd.to_numeric(df["revenue_year"], errors="coerce")
    df["revenue_month"] = pd.to_numeric(df["revenue_month"], errors="coerce")
    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    df = df.dropna(subset=["revenue_year", "revenue_month", "revenue"]).copy()
    df["ym"] = df["revenue_year"].astype(int) * 100 + df["revenue_month"].astype(int)
    df = df.sort_values("ym").drop_duplicates(subset=["ym"], keep="last").reset_index(drop=True)

    if len(df) < 15:
        return None, None, None

    rev_3m_curr = float(df["revenue"].tail(3).sum())
    rev_3m_prev = float(df["revenue"].iloc[-15:-12].sum())
    yoy_3m = safe_div(rev_3m_curr - rev_3m_prev, rev_3m_prev)
    yoy_3m_pct = round(yoy_3m * 100.0, 2) if yoy_3m is not None else None

    yoy_12m_pct: Optional[float] = None
    if len(df) >= 24:
        rev_12m_curr = float(df["revenue"].tail(12).sum())
        rev_12m_prev = float(df["revenue"].iloc[-24:-12].sum())
        yoy_12m = safe_div(rev_12m_curr - rev_12m_prev, rev_12m_prev)
        yoy_12m_pct = round(yoy_12m * 100.0, 2) if yoy_12m is not None else None

    return yoy_3m_pct, yoy_12m_pct, None


def compute_consecutive_2q_ar_inv_bloat(
    income_rows: list[dict[str, Any]],
    balance_rows: list[dict[str, Any]],
) -> Optional[bool]:
    """
    檢核是否連續 2 季出現 (應收帳款 YoY - 營收 YoY >= 20%) 或 (存貨 YoY - 營收 YoY >= 20%)
    """
    inc = pivot_finmind_statements(income_rows)
    bal = pivot_finmind_statements(balance_rows)
    common_dates = sorted(set(inc.keys()) & set(bal.keys()))
    if len(common_dates) < 6:
        return None

    # 檢核最近兩季 q[-1], q[-2] 與一年前同季對比
    bloat_flags: list[bool] = []
    for idx in (-1, -2):
        d_curr = common_dates[idx]
        target_prev_prefix = f"{int(d_curr[:4]) - 1}{d_curr[4:]}"
        if target_prev_prefix not in inc or target_prev_prefix not in bal:
            return None

        rev_c = _pick(inc[d_curr], ["Revenue", "OperatingRevenue"])
        rev_p = _pick(inc[target_prev_prefix], ["Revenue", "OperatingRevenue"])
        ar_c = _pick(bal[d_curr], ["AccountsReceivable", "AccountsReceivableNet", "NotesAndAccountsReceivable"])
        ar_p = _pick(bal[target_prev_prefix], ["AccountsReceivable", "AccountsReceivableNet", "NotesAndAccountsReceivable"])
        inv_c = _pick(bal[d_curr], ["Inventory", "Inventories"])
        inv_p = _pick(bal[target_prev_prefix], ["Inventory", "Inventories"])

        rev_yoy = safe_div((rev_c - rev_p) if rev_c is not None and rev_p is not None else None, rev_p)
        if rev_yoy is None:
            return None

        ar_yoy = safe_div((ar_c - ar_p) if ar_c is not None and ar_p is not None else None, ar_p)
        inv_yoy = safe_div((inv_c - inv_p) if inv_c is not None and inv_p is not None else None, inv_p)

        ar_bloat = ar_yoy is not None and (ar_yoy - rev_yoy) * 100.0 >= 20.0
        inv_bloat = inv_yoy is not None and (inv_yoy - rev_yoy) * 100.0 >= 20.0
        bloat_flags.append(ar_bloat or inv_bloat)

    return all(bloat_flags)


def compute_all_financial_ratios(
    *,
    income_rows: list[dict[str, Any]],
    balance_rows: list[dict[str, Any]],
    cashflow_rows: list[dict[str, Any]],
    revenue_rows: list[dict[str, Any]],
    dividend_rows: list[dict[str, Any]],
    latest_price: Optional[float],
    shares_override: Optional[float] = None,
) -> dict[str, Any]:
    """彙總計算所有階段零與階段一所需財務比率；缺值一律回傳 None"""
    snapshots = extract_annual_snapshots(income_rows, balance_rows, cashflow_rows)
    # 計算「年度指標」（如近 3 年累計營業現金流、近 3 年平均 ROIC、近 3 年累計 OCF/NI、F-Score）時，
    # 必須只篩選完整會計年度（具備 -12-31 年報列）
    full_years = [s for s in snapshots if (s.get("hasAnnualClose") or 0) >= 1.0]
    if len(full_years) < 2:
        full_years = [s for s in snapshots if (s.get("quarterCount") or 0) >= 4]
    if len(full_years) < 1:
        full_years = snapshots

    curr = full_years[-1] if len(full_years) >= 1 else {}
    prev = full_years[-2] if len(full_years) >= 2 else {}
    ttm = compute_ttm_metrics(income_rows, cashflow_rows)

    # 股本股數與市值計算（單位：FinMind 財報為元、股本通常為元，每股面額 10 元 -> 股數 = 股本 / 10）
    latest_snap = snapshots[-1] if snapshots else curr
    capital_stock = latest_snap.get("shares") or curr.get("shares")
    est_shares = shares_override or (
        capital_stock / 10.0 if capital_stock is not None and capital_stock > 0 else None
    )
    market_cap_twd = (
        latest_price * est_shares
        if latest_price is not None and latest_price > 0 and est_shares is not None and est_shares > 0
        else None
    )

    beneish_m = compute_beneish_m_score(curr, prev) if curr and prev else None
    altman_z, altman_zpp = compute_altman_scores(curr, market_cap_twd) if curr else (None, None)

    # 近 3 個完整會計年度 (-12-31) 累計 OCF 與 OCF/NI
    last3 = full_years[-3:] if len(full_years) >= 3 else []
    cumulative_3y_ocf: Optional[float] = None
    ocf_to_ni_3y_pct: Optional[float] = None
    if len(last3) == 3 and all(y.get("ocf") is not None for y in last3):
        cumulative_3y_ocf = round(sum(y["ocf"] for y in last3 if y["ocf"] is not None), 2)
        if all(y.get("netIncome") is not None for y in last3):
            ni_3y = sum(y["netIncome"] for y in last3 if y["netIncome"] is not None)
            ratio = safe_div(cumulative_3y_ocf, ni_3y)
            if ratio is not None and ni_3y > 0:
                ocf_to_ni_3y_pct = round(ratio * 100.0, 2)

    # 近 3 年平均 ROIC（簡化有效稅率約 20%: NOPAT ≈ OperatingIncome * 0.8 / InvestedCapital）
    roics: list[float] = []
    for y in last3:
        op_inc = y.get("operatingIncome")
        eq = y.get("equity")
        ltd = y.get("longTermDebt") or 0.0
        cash = y.get("cash") or 0.0
        if op_inc is not None and eq is not None:
            invested_cap = max(eq * 0.5, eq + ltd - cash)
            r = safe_div(op_inc * 0.8, invested_cap)
            if r is not None and invested_cap > 0:
                roics.append(r * 100.0)
    roic_3y_avg_pct = round(sum(roics) / len(roics), 2) if len(roics) == 3 else None

    is_roic_declining: Optional[bool] = None
    if len(roics) >= 2:
        is_roic_declining = roics[-1] < roics[0]

    # GP/A
    gpa = safe_div(curr.get("grossProfit"), curr.get("totalAssets")) if curr else None
    gpa_pct = round(gpa * 100.0, 2) if gpa is not None else None

    # EV/EBITDA, EV/EBIT, FCF/EV（優先使用正確 TTM 數據，若無則退回最新完整年報 curr）
    ev: Optional[float] = None
    ref_bal = latest_snap if latest_snap.get("equity") is not None else curr
    if market_cap_twd is not None and ref_bal.get("equity") is not None:
        total_debt = ref_bal.get("longTermDebt") or 0.0
        cash = ref_bal.get("cash") or 0.0
        ev = max(market_cap_twd * 0.3, market_cap_twd + total_debt - cash)

    ebit = ttm.get("ttmOperatingIncome") if ttm.get("ttmOperatingIncome") is not None else (curr.get("operatingIncome") if curr else None)
    dep = ttm.get("ttmDepreciation") if ttm.get("ttmDepreciation") is not None else (curr.get("depreciation") if curr else None)
    ebitda = (ebit + dep) if (ebit is not None and dep is not None) else None

    ev_to_ebit = round(ev / ebit, 2) if (ev is not None and ebit is not None and ebit > 0) else None
    ev_to_ebitda = (
        round(ev / ebitda, 2) if (ev is not None and ebitda is not None and ebitda > 0) else None
    )

    fcf_yield_pct: Optional[float] = None
    ocf_for_fcf = ttm.get("ttmOcf") if ttm.get("ttmOcf") is not None else (curr.get("ocf") if curr else None)
    capex_for_fcf = ttm.get("ttmCapex") if ttm.get("ttmCapex") is not None else (curr.get("capex") if curr else None)
    if ev is not None and ev > 0 and ocf_for_fcf is not None and capex_for_fcf is not None:
        fcf = ocf_for_fcf - capex_for_fcf
        fcf_yield_pct = round((fcf / ev) * 100.0, 2)

    # Piotroski 9 項
    piotroski_checks, piotroski_raw = (
        compute_piotroski_checks(curr, prev)
        if curr and prev
        else (
            {
                "positiveRoa": None,
                "roaImproving": None,
                "positiveOcf": None,
                "ocfGreaterThanNetIncome": None,
                "lowerLongTermDebtRatio": None,
                "higherCurrentRatio": None,
                "noShareDilution": None,
                "higherGrossMargin": None,
                "higherAssetTurnover": None,
            },
            None,
        )
    )

    # 3 年股本稀釋率
    share_dilution_3y_pct: Optional[float] = None
    if len(full_years) >= 4:
        sh_now = full_years[-1].get("shares")
        sh_3y_ago = full_years[-4].get("shares")
        dil = safe_div((sh_now - sh_3y_ago) if sh_now is not None and sh_3y_ago is not None else None, sh_3y_ago)
        if dil is not None:
            share_dilution_3y_pct = round(dil * 100.0, 2)

    # 連續 5 年穩健配息
    consecutive_5y_div: Optional[bool] = None
    non_debt_funded_div: Optional[bool] = None
    if dividend_rows:
        div_df = pd.DataFrame(dividend_rows).copy()
        has_div_col = (
            "CashEarningsDistribution" in div_df.columns
            or "CashStatutorySurplusDistribution" in div_df.columns
        )
        if has_div_col and ("year" in div_df.columns or "date" in div_df.columns):
            if "year" not in div_df.columns:
                div_df["year"] = div_df["date"].astype(str).str[:4]
            c_earn = (
                pd.to_numeric(div_df["CashEarningsDistribution"], errors="coerce").fillna(0.0)
                if "CashEarningsDistribution" in div_df.columns
                else pd.Series(0.0, index=div_df.index)
            )
            c_stat = (
                pd.to_numeric(div_df["CashStatutorySurplusDistribution"], errors="coerce").fillna(0.0)
                if "CashStatutorySurplusDistribution" in div_df.columns
                else pd.Series(0.0, index=div_df.index)
            )
            div_df["cash_div"] = c_earn + c_stat
            yearly_div = div_df.groupby("year")["cash_div"].sum()
            recent_years = sorted(yearly_div.index)[-5:]
            if len(recent_years) >= 5:
                consecutive_5y_div = all(float(yearly_div[y]) > 0 for y in recent_years)

    if curr.get("ocf") is not None and curr.get("capex") is not None and curr.get("dividendsPaid") is not None:
        fcf_curr = curr["ocf"] - curr["capex"]  # type: ignore[operator]
        non_debt_funded_div = fcf_curr >= (curr["dividendsPaid"] or 0.0)

    # 近 5 年累計 OCF、最新流動比率、最新淨負債權益比
    last5 = full_years[-5:] if len(full_years) >= 5 else []
    cumulative_5y_ocf: Optional[float] = None
    if len(last5) == 5 and all(y.get("ocf") is not None for y in last5):
        cumulative_5y_ocf = round(sum(y["ocf"] for y in last5 if y["ocf"] is not None), 2)

    latest_cr = safe_div(curr.get("currentAssets"), curr.get("currentLiabilities")) if curr else None
    latest_cr_val = round(latest_cr, 2) if latest_cr is not None else None

    latest_nd_eq: Optional[float] = None
    if curr and curr.get("equity") is not None and (curr.get("equity") or 0) > 0:
        ltd = curr.get("longTermDebt") or 0.0
        cash = curr.get("cash") or 0.0
        nd_ratio = safe_div(ltd - cash, curr.get("equity"))
        if nd_ratio is not None:
            latest_nd_eq = round(nd_ratio * 100.0, 2)

    rev_3m_yoy, rev_12m_yoy, _ = compute_monthly_revenue_momentum(revenue_rows)
    ar_inv_bloat = compute_consecutive_2q_ar_inv_bloat(income_rows, balance_rows)

    return {
        "beneishMScore": beneish_m,
        "altmanZScore": altman_z,
        "altmanZDoublePrime": altman_zpp,
        "cumulative3yOCF": cumulative_3y_ocf,
        "cumulative5yOCF": cumulative_5y_ocf,
        "latestCurrentRatio": latest_cr_val,
        "latestNetDebtToEquityPct": latest_nd_eq,
        "shareDilution3yPct": share_dilution_3y_pct,
        "isRoicDeclining": is_roic_declining,
        "consecutive2qArOrInvBloat": ar_inv_bloat,
        "roic3yAvgPct": roic_3y_avg_pct,
        "gpaPct": gpa_pct,
        "ocfToNi3yPct": ocf_to_ni_3y_pct,
        "piotroskiRaw": piotroski_raw,
        "piotroskiChecks": piotroski_checks,
        "evToEbitda": ev_to_ebitda,
        "evToEbit": ev_to_ebit,
        "fcfYieldPct": fcf_yield_pct,
        "consecutive5yDividend": consecutive_5y_div,
        "nonDebtFundedDividend": non_debt_funded_div,
        "rev3mCumYoYPct": rev_3m_yoy,
        "rev12mCumYoYPct": rev_12m_yoy,
    }
