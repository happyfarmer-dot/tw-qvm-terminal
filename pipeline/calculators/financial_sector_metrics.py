from __future__ import annotations

import math
from typing import Any, Literal, Optional

import numpy as np
import pandas as pd

from pipeline.calculators.cyclical_metrics import compute_pb_river_5to7y
from pipeline.calculators.financial_ratios import (
    extract_annual_snapshots,
    pivot_finmind_statements,
    safe_div,
)
from pipeline.schemas import RegulatoryOverrideRecord


FinancialProfile = Literal["financial_bank", "financial_life_fhc"]

IFRS17_TW_ICS_WARNING = (
    "壽險型金控面臨 2026 年起接軌 IFRS 17 與 TW-ICS 之制度轉換，"
    "歷史 5–7 年舊制 P/B 區間與淨值可能存在結構性斷層，請留意法說會 CSM 與最新監理過渡規範。"
)

MOPS_REGULATORY_HINT = (
    "請至公開資訊觀測站（MOPS）資本適足性專區、金管會銀行局統計或最近一期法說會簡報填寫"
)


def compute_justified_pb(
    *,
    avg_roe_5y_pct: Optional[float],
    avg_payout_ratio_pct: Optional[float],
    ke: float,
) -> tuple[Optional[float], Optional[float]]:
    """
    Justified P/B 基準推算（含嚴格防發散截斷保護）：
    - avgPayoutRatio5Y 截斷於 [0, 1.0]
    - sustainableGrowthG = min(max(avgRoe5Y * (1 - payout), 0.0), ke - 0.025, 0.05)
    - justifiedPB = (avgRoe5Y - g) / (ke - g)
    若 avgRoe5Y <= 0 或 ke <= 0.03 回傳 (None, None)。
    回傳 (sustainableGrowthG_pct, justifiedPB)
    """
    if avg_roe_5y_pct is None or not math.isfinite(avg_roe_5y_pct) or avg_roe_5y_pct <= 0:
        return None, None
    if not math.isfinite(ke) or ke <= 0.03:
        return None, None

    roe_dec = avg_roe_5y_pct / 100.0
    payout_dec = (
        max(0.0, min(1.0, avg_payout_ratio_pct / 100.0))
        if avg_payout_ratio_pct is not None and math.isfinite(avg_payout_ratio_pct)
        else 0.5
    )

    raw_g = roe_dec * (1.0 - payout_dec)
    max_safe_g = max(0.0, min(ke - 0.025, 0.05))
    g_dec = min(max(raw_g, 0.0), max_safe_g)

    denom = ke - g_dec
    if denom <= 0.005:
        return round(g_dec * 100.0, 2), None

    jpb = (roe_dec - g_dec) / denom
    if not math.isfinite(jpb) or jpb <= 0:
        return round(g_dec * 100.0, 2), None

    return round(g_dec * 100.0, 2), round(jpb, 3)


def compute_financial_sector_metrics(
    *,
    profile: FinancialProfile,
    price_df: pd.DataFrame,
    income_rows: list[dict[str, Any]],
    balance_rows: list[dict[str, Any]],
    cashflow_rows: list[dict[str, Any]],
    revenue_rows: list[dict[str, Any]],
    dividend_rows: list[dict[str, Any]],
    latest_price: Optional[float],
    ma200: Optional[float],
    tech: dict[str, Any],
    official_snap: dict[str, Any],
    fin_ratios: dict[str, Any],
    reg_override: RegulatoryOverrideRecord,
) -> tuple[dict[str, Any], list[str], list[str]]:
    """
    計算台股銀行與金控業指標，並合併 SQLite MOPS 監理覆寫值。
    回傳 (financialMetrics_dict, manualVerificationRequired_list, warnings_list)
    """
    annuals = extract_annual_snapshots(income_rows, balance_rows, cashflow_rows)
    full_years = [s for s in annuals if (s.get("quarterCount") or 0) >= 4]
    if len(full_years) < 3:
        full_years = annuals
    win5 = full_years[-5:]

    # 1. 跨週期 ROE 與穩定度
    roes: list[float] = []
    for y in win5:
        ni_y = y.get("netIncome")
        eq_y = y.get("equity")
        r = safe_div(ni_y, eq_y)
        if r is not None and eq_y is not None and eq_y > 0:
            roes.append(r * 100.0)

    avg_roe_5y = round(float(np.mean(roes)), 2) if roes else None
    roe_std_5y = round(float(np.std(roes, ddof=1)), 2) if len(roes) >= 2 else None
    min_roe_5y = round(float(min(roes)), 2) if roes else None

    # TTM ROE
    inc_q = pivot_finmind_statements(income_rows)
    bal_q = pivot_finmind_statements(balance_rows)
    q_dates = sorted(set(inc_q.keys()) & set(bal_q.keys()))
    current_ttm_roe: Optional[float] = None
    if len(q_dates) >= 4:
        last4 = q_dates[-4:]
        nis4 = [
            inc_q[d].get("IncomeAfterTaxes") or inc_q[d].get("NetIncome")
            for d in last4
        ]
        eq_last = bal_q[last4[-1]].get("Equity") or bal_q[last4[-1]].get("TotalEquity")
        if all(x is not None for x in nis4) and eq_last is not None and eq_last > 0:
            ttm_ni = sum(x for x in nis4 if x is not None)
            current_ttm_roe = round((ttm_ni / eq_last) * 100.0, 2)

    # 2. 5-7Y P/B 河流位階
    current_pb, pb_pct, pb_band, _ = compute_pb_river_5to7y(
        price_df=price_df, balance_rows=balance_rows
    )
    if current_pb is None and official_snap.get("pbRatio") is not None:
        current_pb = round(float(official_snap["pbRatio"]), 2)

    # 3. 近 5 年配息續航、平均現金盈餘配發率與實質殖利率
    consecutive_cash_years: Optional[int] = None
    avg_payout_5y: Optional[float] = None
    latest_payout_pct: Optional[float] = None
    uses_cap_reserve: Optional[bool] = None

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
            div_df["cap_res_div"] = c_stat
            yearly_div = div_df.groupby("year")["cash_div"].sum()
            consec = 0
            for y_key in sorted(yearly_div.index, reverse=True):
                if float(yearly_div[y_key]) > 0:
                    consec += 1
                else:
                    break
            consecutive_cash_years = consec

            latest_y = sorted(div_df["year"].unique())[-1]
            stat_latest = float(div_df[div_df["year"] == latest_y]["cap_res_div"].sum())
            uses_cap_reserve = stat_latest > 0

    # 配發率：以現金股利總額 / 淨利（近 5 年）
    payouts: list[float] = []
    for y in win5:
        d_paid = y.get("dividendsPaid")
        ni_y = y.get("netIncome")
        if d_paid is not None and ni_y is not None and ni_y > 0:
            p = min(1.5, max(0.0, d_paid / ni_y))
            payouts.append(p * 100.0)
    if payouts:
        avg_payout_5y = round(min(100.0, max(0.0, float(np.mean(payouts)))), 2)
        latest_payout_pct = round(payouts[-1], 2)

    # 4. Justified P/B
    default_ke = 0.08 if profile == "financial_bank" else 0.095
    g_pct, justified_pb = compute_justified_pb(
        avg_roe_5y_pct=avg_roe_5y,
        avg_payout_ratio_pct=avg_payout_5y,
        ke=default_ke,
    )
    pb_val_ratio = (
        round(current_pb / justified_pb, 3)
        if (current_pb is not None and justified_pb is not None and justified_pb > 0)
        else None
    )

    bias_ma200 = (
        round(((latest_price - ma200) / ma200) * 100.0, 2)
        if (latest_price is not None and ma200 is not None and ma200 > 0)
        else None
    )

    # 5. 合併 SQLite 監理指標與反靜默人工核對清單
    manual_verify: list[str] = []
    warnings: list[str] = []
    if profile == "financial_life_fhc":
        warnings.append(IFRS17_TW_ICS_WARNING)

    reg_check_fields = [
        ("fhcCarPct", "金控集團資本適足率 (CAR %)", reg_override.fhcCarPct),
        ("bankBisPct", "銀行總資本適足率 (BIS %)", reg_override.bankBisPct),
        ("bankCet1Pct", "銀行普通股權益第一類資本比率 (CET1 %)", reg_override.bankCet1Pct),
        ("doubleLeverageRatioPct", "金控雙重槓桿比 (DLR %)", reg_override.doubleLeverageRatioPct),
        ("nplRatioPct", "銀行逾放比 (NPL %)", reg_override.nplRatioPct),
        ("nplCoverageRatioPct", "銀行備抵呆帳覆蓋率 (%)", reg_override.nplCoverageRatioPct),
    ]
    if profile == "financial_life_fhc":
        reg_check_fields.append(
            ("lifeSolvencyRatioPct", "壽險子公司清償比率 (RBC / TW-ICS %)", reg_override.lifeSolvencyRatioPct)
        )

    for field_key, label, val in reg_check_fields:
        if val is None:
            manual_verify.append(f"{field_key}（{label} — {MOPS_REGULATORY_HINT}）")

    metrics_dict: dict[str, Any] = {
        "avgRoe5Y": avg_roe_5y,
        "roeStdDev5Y": roe_std_5y,
        "minAnnualRoe5Y": min_roe_5y,
        "currentTtmRoe": current_ttm_roe,
        "currentPB": current_pb,
        "pbPercentile5to7Y": pb_pct,
        "pbBand": pb_band,
        "defaultKe": default_ke,
        "avgPayoutRatio5Y": avg_payout_5y,
        "sustainableGrowthG": g_pct,
        "justifiedPB": justified_pb,
        "pbValuationRatio": pb_val_ratio,
        "cashDividendYieldPct": official_snap.get("dividendYieldPct"),
        "consecutiveCashDivYears": consecutive_cash_years,
        "latestPayoutRatioPct": latest_payout_pct,
        "usesCapitalReserveForDividend": uses_cap_reserve,
        "netRevenue3mYoY": fin_ratios.get("rev3mCumYoYPct"),
        "netRevenue12mYoY": fin_ratios.get("rev12mCumYoYPct"),
        "biasFromMa200Pct": bias_ma200,
        "volAdjustedMomentum12_1M": tech.get("mom12m1mSharpe"),
        "asOfQuarter": reg_override.asOfQuarter,
        "isDsib": reg_override.isDsib,
        "fhcCarPct": reg_override.fhcCarPct,
        "bankBisPct": reg_override.bankBisPct,
        "bankCet1Pct": reg_override.bankCet1Pct,
        "doubleLeverageRatioPct": reg_override.doubleLeverageRatioPct,
        "nplRatioPct": reg_override.nplRatioPct,
        "nplConsecutiveRiseQuarters": reg_override.nplConsecutiveRiseQuarters,
        "nplCoverageRatioPct": reg_override.nplCoverageRatioPct,
        "lifeSolvencyRatioPct": reg_override.lifeSolvencyRatioPct,
        "lifeSolvencyRegime": reg_override.lifeSolvencyRegime,
        "ociRestrictsDividend": reg_override.ociRestrictsDividend,
        "recentDilutiveOfferingPct": reg_override.recentDilutiveOfferingPct,
    }

    return metrics_dict, manual_verify, warnings
