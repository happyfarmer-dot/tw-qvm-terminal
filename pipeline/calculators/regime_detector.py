from __future__ import annotations

import math
from typing import Any, Optional

import pandas as pd


def detect_taiex_regime(
    price_rows: list[dict[str, Any]],
    us_macro: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    台美雙重市場體制判定器：
    滿足以下任一條件即進入 DEFENSIVE（防禦模式，首倉由 50% 縮減為 30%）：
    1. 台股加權指數轉弱：(收盤 < 200MA) 且 (近 20 日最大回撤 > 10% 或 20 日年化波動率 > 25%)
    2. 美股總經風險升溫：(S&P 500 < 200MA) 且 (VIX ≥ 25)
    """
    reasons: list[str] = []

    us_defensive = False
    if us_macro:
        sp = us_macro.get("sp500") or {}
        sp_close = sp.get("close")
        sp_ma200 = sp.get("ma200")
        vix = us_macro.get("vixClose")
        sp_below = sp_close is not None and sp_ma200 is not None and float(sp_close) < float(sp_ma200)
        vix_high = vix is not None and float(vix) >= 25.0
        if sp_below:
            reasons.append(f"美股 S&P 500 ({float(sp_close):,.0f}) 低於 200MA ({float(sp_ma200):,.0f})")
        if vix_high:
            reasons.append(f"美股恐慌指數 VIX 達 {float(vix):.1f}（≥ 25 警戒線）")
        us_defensive = sp_below and vix_high

    if not price_rows:
        tw_reasons = ["大盤指數資料缺失"]
        return {
            "regime": "DEFENSIVE" if us_defensive else "NORMAL",
            "indexSymbol": "TAIEX",
            "indexClose": None,
            "ma200": None,
            "drawdown20dPct": None,
            "annualizedVol20dPct": None,
            "reasons": (reasons + tw_reasons) if us_defensive else ["大盤指數資料缺失，預設維持常態模式"],
            "usMacro": us_macro,
        }

    df = pd.DataFrame(price_rows).copy()
    if "close" not in df.columns:
        return {
            "regime": "DEFENSIVE" if us_defensive else "NORMAL",
            "indexSymbol": "TAIEX",
            "indexClose": None,
            "ma200": None,
            "drawdown20dPct": None,
            "annualizedVol20dPct": None,
            "reasons": (reasons + ["大盤指數欄位缺失"]) if us_defensive else ["大盤指數欄位缺失，預設維持常態模式"],
            "usMacro": us_macro,
        }

    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df = df[df["close"].notna() & (df["close"] > 0)].copy()
    if "date" in df.columns:
        df = df.sort_values("date").drop_duplicates(subset=["date"], keep="last")

    close = df["close"].astype(float).reset_index(drop=True)
    if len(close) < 20:
        return {
            "regime": "DEFENSIVE" if us_defensive else "NORMAL",
            "indexSymbol": "TAIEX",
            "indexClose": round(float(close.iloc[-1]), 2) if len(close) else None,
            "ma200": None,
            "drawdown20dPct": None,
            "annualizedVol20dPct": None,
            "reasons": reasons if us_defensive else ["大盤歷史交易日不足 20 天"],
            "usMacro": us_macro,
        }

    latest_close = round(float(close.iloc[-1]), 2)
    ma200 = round(float(close.tail(200).mean()), 2) if len(close) >= 200 else None

    # 近 20 個交易日最大回撤 (%)
    win20 = close.tail(20)
    rolling_peak = win20.cummax()
    drawdowns = (rolling_peak - win20) / rolling_peak * 100.0
    max_dd_20d = round(float(drawdowns.max()), 2)

    # 近 20 日年化波動率 (%)
    rets20 = close.tail(21).pct_change().dropna()
    vol_20d = (
        round(float(rets20.std(ddof=1)) * math.sqrt(252) * 100.0, 2)
        if len(rets20) >= 10
        else None
    )

    below_ma200 = ma200 is not None and latest_close < ma200
    deep_dd = max_dd_20d > 10.0
    high_vol = vol_20d is not None and vol_20d > 25.0

    if below_ma200 and ma200 is not None:
        reasons.append(f"加權指數 ({latest_close:,.0f}) 低於 200MA ({ma200:,.0f})")
    if deep_dd:
        reasons.append(f"近 20 日最大回撤 {max_dd_20d:.2f}% (> 10%)")
    if high_vol and vol_20d is not None:
        reasons.append(f"近 20 日年化波動率 {vol_20d:.2f}% (> 25%)")

    tw_defensive = below_ma200 and (deep_dd or high_vol)
    regime = "DEFENSIVE" if (tw_defensive or us_defensive) else "NORMAL"
    if regime == "NORMAL" and not reasons:
        if us_macro:
            reasons.append("台美大盤皆位於安全區間，建議維持常態模式 (40/35/25)")
        else:
            reasons.append("大盤位於安全區間，建議維持常態模式 (40/35/25)")

    return {
        "regime": regime,
        "indexSymbol": "TAIEX",
        "indexClose": latest_close,
        "ma200": ma200,
        "drawdown20dPct": max_dd_20d,
        "annualizedVol20dPct": vol_20d,
        "reasons": reasons,
        "usMacro": us_macro,
    }
