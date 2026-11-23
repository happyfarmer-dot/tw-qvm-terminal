from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
from typing import Any, Callable, Optional

import pandas as pd


TAIPEI_TZ = dt.timezone(dt.timedelta(hours=8))

US_MACRO_SYMBOLS = {
    "sp500": "^GSPC",
    "soxx": "SOXX",
    "vix": "^VIX",
    "tnx": "^TNX",
}


def _safe_round(val: Any, digits: int = 2) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return round(f, digits) if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _extract_close_series(df: pd.DataFrame) -> pd.Series:
    if df is None or df.empty:
        return pd.Series(dtype=float)
    if isinstance(df.columns, pd.MultiIndex):
        if "Close" in df.columns.get_level_values(0):
            s = df["Close"]
            if isinstance(s, pd.DataFrame):
                s = s.iloc[:, 0]
        else:
            s = df.iloc[:, 0]
    elif "Close" in df.columns:
        s = df["Close"]
    elif "close" in df.columns:
        s = df["close"]
    else:
        return pd.Series(dtype=float)

    s = pd.to_numeric(s, errors="coerce").dropna()
    return s[s > 0].astype(float)


def _compute_index_stats(df: pd.DataFrame, include_drawdown: bool = True) -> Optional[dict[str, Any]]:
    close = _extract_close_series(df)
    if close.empty:
        return None

    latest_close = _safe_round(close.iloc[-1], 2)
    ma200 = _safe_round(close.tail(200).mean(), 2) if len(close) >= 200 else None
    below_ma200 = (
        bool(latest_close is not None and ma200 is not None and latest_close < ma200)
        if ma200 is not None
        else None
    )

    drawdown_20d: Optional[float] = None
    return_20d: Optional[float] = None
    if len(close) >= 20:
        win20 = close.tail(20)
        if include_drawdown:
            peak = win20.cummax()
            dd = (peak - win20) / peak * 100.0
            drawdown_20d = _safe_round(dd.max(), 2)

    if len(close) >= 21:
        p20 = float(close.iloc[-21])
        p_now = float(close.iloc[-1])
        if p20 > 0:
            return_20d = _safe_round(((p_now / p20) - 1.0) * 100.0, 2)

    date_str: Optional[str] = None
    try:
        idx_last = close.index[-1]
        date_str = str(idx_last)[:10]
    except Exception:
        date_str = None

    return {
        "close": latest_close,
        "ma200": ma200,
        "belowMa200": below_ma200,
        "drawdown20dPct": drawdown_20d,
        "return20dPct": return_20d,
        "date": date_str,
    }


def _default_yf_history(symbol: str, period: str = "1y") -> pd.DataFrame:
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    return ticker.history(period=period, auto_adjust=False)


class UsMacroClient:
    """
    美股四大量化風向球抓取器（純數學指標，不納入任何新聞）：
    - ^GSPC (S&P 500): 最新收盤、200MA、近 20 日最大回撤
    - SOXX (費城半導體 ETF): 最新收盤、200MA、近 20 日漲跌幅
    - ^VIX (恐慌指數): 最新收盤
    - ^TNX (美國 10 年期公債殖利率): 最新無風險利率 (%)
    若 yfinance 連線失敗，自動沿用 pipeline/cache/us_macro.json 上一交易日數據並標註日期。
    """

    def __init__(
        self,
        cache_dir: Path,
        history_fetcher: Optional[Callable[[str, str], pd.DataFrame]] = None,
    ) -> None:
        self.cache_path = cache_dir / "us_macro.json"
        self.history_fetcher = history_fetcher or _default_yf_history

    def load_cached(self) -> Optional[dict[str, Any]]:
        if not self.cache_path.exists():
            return None
        try:
            data = json.loads(self.cache_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def save_cache(self, payload: dict[str, Any]) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def fetch_us_macro(self) -> dict[str, Any]:
        cached = self.load_cached() or {}
        now_tw = dt.datetime.now(TAIPEI_TZ).strftime("%Y-%m-%d %H:%M")

        sp500_stats: Optional[dict[str, Any]] = None
        soxx_stats: Optional[dict[str, Any]] = None
        vix_close: Optional[float] = None
        vix_date: Optional[str] = None
        tnx_yield: Optional[float] = None
        tnx_date: Optional[str] = None
        errors: list[str] = []

        # 1. ^GSPC
        try:
            df_sp = self.history_fetcher(US_MACRO_SYMBOLS["sp500"], "1y")
            sp500_stats = _compute_index_stats(df_sp, include_drawdown=True)
        except Exception as exc:
            errors.append(f"^GSPC: {exc}")

        # 2. SOXX
        try:
            df_soxx = self.history_fetcher(US_MACRO_SYMBOLS["soxx"], "1y")
            soxx_stats = _compute_index_stats(df_soxx, include_drawdown=False)
        except Exception as exc:
            errors.append(f"SOXX: {exc}")

        # 3. ^VIX
        try:
            df_vix = self.history_fetcher(US_MACRO_SYMBOLS["vix"], "1mo")
            vix_s = _extract_close_series(df_vix)
            if not vix_s.empty:
                vix_close = _safe_round(vix_s.iloc[-1], 2)
                vix_date = str(vix_s.index[-1])[:10]
        except Exception as exc:
            errors.append(f"^VIX: {exc}")

        # 4. ^TNX
        try:
            df_tnx = self.history_fetcher(US_MACRO_SYMBOLS["tnx"], "1mo")
            tnx_s = _extract_close_series(df_tnx)
            if not tnx_s.empty:
                raw_y = float(tnx_s.iloc[-1])
                if 0 < raw_y < 30:
                    tnx_yield = _safe_round(raw_y, 2)
                    tnx_date = str(tnx_s.index[-1])[:10]
        except Exception as exc:
            errors.append(f"^TNX: {exc}")

        # 若部分或全部失敗，安全回退至 cache/us_macro.json 上一交易日數據
        used_fallback = False
        if sp500_stats is None and cached.get("sp500"):
            sp500_stats = cached["sp500"]
            used_fallback = True
        if soxx_stats is None and cached.get("soxx"):
            soxx_stats = cached["soxx"]
            used_fallback = True
        if vix_close is None and cached.get("vixClose") is not None:
            vix_close = cached["vixClose"]
            vix_date = cached.get("vixDate")
            used_fallback = True
        if tnx_yield is None and cached.get("tnxYieldPct") is not None:
            tnx_yield = cached["tnxYieldPct"]
            tnx_date = cached.get("tnxDate")
            used_fallback = True

        as_of_date = (
            (sp500_stats or {}).get("date")
            or (soxx_stats or {}).get("date")
            or vix_date
            or tnx_date
            or cached.get("asOfDate")
            or dt.datetime.now(TAIPEI_TZ).strftime("%Y-%m-%d")
        )

        # 若完全沒有任何即時數據且有舊快取，標記為沿用快取
        all_live_failed = (
            len(errors) > 0
            or (
                sp500_stats is None
                and soxx_stats is None
                and vix_close is None
                and tnx_yield is None
            )
        )
        from_cache = bool(used_fallback or (all_live_failed and bool(cached)))

        result = {
            "asOfDate": as_of_date,
            "fetchedAtTaipei": now_tw,
            "fromCache": from_cache,
            "sp500": sp500_stats or {
                "close": None,
                "ma200": None,
                "belowMa200": None,
                "drawdown20dPct": None,
                "return20dPct": None,
                "date": None,
            },
            "soxx": soxx_stats or {
                "close": None,
                "ma200": None,
                "belowMa200": None,
                "drawdown20dPct": None,
                "return20dPct": None,
                "date": None,
            },
            "vixClose": vix_close,
            "vixDate": vix_date,
            "tnxYieldPct": tnx_yield,
            "tnxDate": tnx_date,
            "statusNote": (
                f"沿用上一交易日快取數據（基準日：{as_of_date}）"
                if from_cache
                else f"已同步美股最新收盤數據（基準日：{as_of_date}）"
            ),
        }

        # 只要有成功抓到任一即時欄位就更新快取
        if sp500_stats or soxx_stats or vix_close is not None or tnx_yield is not None:
            self.save_cache(result)

        return result
