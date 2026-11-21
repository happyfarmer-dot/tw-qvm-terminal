from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np
import pandas as pd


def _safe_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def compute_technical_metrics(df: pd.DataFrame) -> dict[str, Any]:
    """
    計算台股技術指標（全數採用還原權息價序列 adj_open / adj_max / adj_min / adj_close）：
    - 20D 均成交金額 (Trading_money)
    - 60D 與 120D 年化波動率 (%)
    - 20D ATR (True Range 均值)
    - 50MA, 120MA, 200MA
    - 連續低於 200MA 天數
    - 12-1 個月波動度調整價格動能
    - 現價相對 200MA / 120MA 趨勢乖離率
    """
    empty: dict[str, Any] = {
        "price": None,
        "reportDate": None,
        "high20d": None,
        "ma20": None,
        "ret20dPct": None,
        "rsi14": None,
        "avgDailyTurnover20dTWD": None,
        "annualizedVol60dPct": None,
        "annualizedVol120dPct": None,
        "atr20": None,
        "ma50": None,
        "ma120": None,
        "ma200": None,
        "daysBelow200Ma": 0,
        "mom12m1mSharpe": None,
        "trendVsMa200Pct": None,
        "trendVsMa120Pct": None,
    }
    if df.empty or "adj_close" not in df.columns:
        return empty

    close = df["adj_close"].astype(float)
    raw_close = df["close"].astype(float) if "close" in df.columns else close
    raw_high = df["max"].astype(float) if "max" in df.columns else raw_close
    high = df["adj_max"].astype(float) if "adj_max" in df.columns else close
    low = df["adj_min"].astype(float) if "adj_min" in df.columns else close

    latest_price = _safe_float(raw_close.iloc[-1])
    report_date = str(df["date"].iloc[-1]) if "date" in df.columns and not df.empty else None
    high_20d = _safe_float(round(float(raw_high.tail(20).max()), 2)) if not raw_high.empty else latest_price

    # 20D 平均成交金額 (Trading_money)
    avg_turnover_20d: Optional[float] = None
    if "Trading_money" in df.columns:
        turnover = pd.to_numeric(df["Trading_money"], errors="coerce").dropna()
        if len(turnover) >= 5:
            avg_turnover_20d = _safe_float(round(float(turnover.tail(20).mean()), 2))

    # 日報酬率計算年化波動率
    returns = close.pct_change().dropna()
    vol_60d: Optional[float] = None
    if len(returns) >= 20:
        w60 = returns.tail(60)
        std60 = float(w60.std(ddof=1))
        if math.isfinite(std60) and std60 > 0:
            vol_60d = round(std60 * math.sqrt(252) * 100.0, 2)

    vol_120d: Optional[float] = None
    if len(returns) >= 40:
        w120 = returns.tail(120)
        std120 = float(w120.std(ddof=1))
        if math.isfinite(std120) and std120 > 0:
            vol_120d = round(std120 * math.sqrt(252) * 100.0, 2)

    # 20D ATR
    atr20: Optional[float] = None
    if len(df) >= 21:
        prev_close = close.shift(1)
        tr1 = high - low
        tr2 = (high - prev_close).abs()
        tr3 = (low - prev_close).abs()
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr20 = _safe_float(round(float(tr.tail(20).mean()), 2))

    # 均線 20 / 50 / 120 / 200MA
    ma20 = _safe_float(round(float(raw_close.tail(20).mean()), 2)) if len(raw_close) >= 20 else latest_price
    ma50 = _safe_float(round(float(close.tail(50).mean()), 2)) if len(close) >= 50 else None
    ma120 = _safe_float(round(float(close.tail(120).mean()), 2)) if len(close) >= 120 else None
    ma200 = _safe_float(round(float(close.tail(200).mean()), 2)) if len(close) >= 200 else None

    # 近 20 日漲幅 (%)
    ret_20d_pct: Optional[float] = None
    if len(close) >= 21:
        p_20d_ago = float(close.iloc[-21])
        p_now_adj = float(close.iloc[-1])
        if p_20d_ago > 0:
            ret_20d_pct = _safe_float(round(((p_now_adj / p_20d_ago) - 1.0) * 100.0, 2))

    # 14 日 RSI
    rsi14: Optional[float] = None
    if len(close) >= 15:
        delta = close.diff().dropna()
        gains = delta.clip(lower=0.0)
        losses = (-delta).clip(lower=0.0)
        avg_gain = float(gains.tail(14).mean())
        avg_loss = float(losses.tail(14).mean())
        if avg_loss == 0:
            rsi14 = 100.0 if avg_gain > 0 else 50.0
        else:
            rs = avg_gain / avg_loss
            rsi14 = _safe_float(round(100.0 - (100.0 / (1.0 + rs)), 1))

    # 連續低於 200MA 天數
    days_below_200 = 0
    if len(close) >= 200:
        rolling_200 = close.rolling(200).mean()
        for c_val, m_val in zip(reversed(close.tolist()), reversed(rolling_200.tolist())):
            if m_val is None or not math.isfinite(m_val):
                break
            if c_val < m_val:
                days_below_200 += 1
            else:
                break

    # 12-1 個月波動度調整價格動能 (t-252 到 t-21)
    mom_12m_1m_sharpe: Optional[float] = None
    if len(close) >= 253:
        p_start = float(close.iloc[-253])
        p_end_excl_1m = float(close.iloc[-22])
        if p_start > 0 and p_end_excl_1m > 0:
            total_ret_11m = (p_end_excl_1m / p_start) - 1.0
            win_rets = close.iloc[-253:-21].pct_change().dropna()
            if len(win_rets) >= 60:
                ann_vol = float(win_rets.std(ddof=1)) * math.sqrt(252)
                if math.isfinite(ann_vol) and ann_vol > 0:
                    mom_12m_1m_sharpe = round(total_ret_11m / ann_vol, 3)

    adj_latest = _safe_float(close.iloc[-1])
    trend_vs_200 = (
        round(((adj_latest / ma200) - 1.0) * 100.0, 2)
        if adj_latest is not None and ma200 is not None and ma200 > 0
        else None
    )
    trend_vs_120 = (
        round(((adj_latest / ma120) - 1.0) * 100.0, 2)
        if adj_latest is not None and ma120 is not None and ma120 > 0
        else None
    )

    return {
        "price": latest_price,
        "reportDate": report_date,
        "high20d": high_20d,
        "ma20": ma20,
        "ret20dPct": ret_20d_pct,
        "rsi14": rsi14,
        "avgDailyTurnover20dTWD": avg_turnover_20d,
        "annualizedVol60dPct": vol_60d,
        "annualizedVol120dPct": vol_120d,
        "atr20": atr20,
        "ma50": ma50,
        "ma120": ma120,
        "ma200": ma200,
        "daysBelow200Ma": days_below_200,
        "mom12m1mSharpe": mom_12m_1m_sharpe,
        "trendVsMa200Pct": trend_vs_200,
        "trendVsMa120Pct": trend_vs_120,
    }
