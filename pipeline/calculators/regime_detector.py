from __future__ import annotations

import math
from typing import Any

import pandas as pd


def detect_taiex_regime(price_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """
    台股大盤體制判定器：
    同時滿足 (a) 收盤低於 200 日均線 且 (b) 近 20 日最大回撤 > 10% 或 20 日年化波動率 > 25%
    -> 判定為 DEFENSIVE（防禦模式），否則為 NORMAL（常態模式）。
    """
    if not price_rows:
        return {
            "regime": "NORMAL",
            "indexSymbol": "TAIEX",
            "indexClose": None,
            "ma200": None,
            "drawdown20dPct": None,
            "annualizedVol20dPct": None,
            "reasons": ["大盤指數資料缺失，預設維持常態模式"],
        }

    df = pd.DataFrame(price_rows).copy()
    if "close" not in df.columns:
        return {
            "regime": "NORMAL",
            "indexSymbol": "TAIEX",
            "indexClose": None,
            "ma200": None,
            "drawdown20dPct": None,
            "annualizedVol20dPct": None,
            "reasons": ["大盤指數欄位缺失，預設維持常態模式"],
        }

    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df = df[df["close"].notna() & (df["close"] > 0)].copy()
    if "date" in df.columns:
        df = df.sort_values("date").drop_duplicates(subset=["date"], keep="last")

    close = df["close"].astype(float).reset_index(drop=True)
    if len(close) < 20:
        return {
            "regime": "NORMAL",
            "indexSymbol": "TAIEX",
            "indexClose": round(float(close.iloc[-1]), 2) if len(close) else None,
            "ma200": None,
            "drawdown20dPct": None,
            "annualizedVol20dPct": None,
            "reasons": ["大盤歷史交易日不足 20 天"],
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

    reasons: list[str] = []
    if below_ma200 and ma200 is not None:
        reasons.append(f"加權指數 ({latest_close:,.0f}) 低於 200MA ({ma200:,.0f})")
    if deep_dd:
        reasons.append(f"近 20 日最大回撤 {max_dd_20d:.2f}% (> 10%)")
    if high_vol and vol_20d is not None:
        reasons.append(f"近 20 日年化波動率 {vol_20d:.2f}% (> 25%)")

    regime = "DEFENSIVE" if (below_ma200 and (deep_dd or high_vol)) else "NORMAL"
    if regime == "NORMAL" and not reasons:
        reasons.append("大盤位於安全區間，建議維持常態模式 (40/35/25)")

    return {
        "regime": regime,
        "indexSymbol": "TAIEX",
        "indexClose": latest_close,
        "ma200": ma200,
        "drawdown20dPct": max_dd_20d,
        "annualizedVol20dPct": vol_20d,
        "reasons": reasons,
    }
