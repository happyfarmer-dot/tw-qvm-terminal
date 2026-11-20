from __future__ import annotations

import datetime as dt
import gzip
import json
from pathlib import Path
from typing import Any, Optional


def is_in_financial_window(d: dt.date) -> bool:
    """
    判斷是否位於台股法定財報公告窗格：
    - 年報：4/1 – 4/10
    - Q1：5/16 – 5/25
    - Q2：8/15 – 8/25
    - Q3：11/15 – 11/25
    """
    m, day = d.month, d.day
    if m == 4 and 1 <= day <= 10:
        return True
    if m == 5 and 16 <= day <= 25:
        return True
    if m == 8 and 15 <= day <= 25:
        return True
    if m == 11 and 15 <= day <= 25:
        return True
    return False


def is_in_monthly_revenue_window(d: dt.date) -> bool:
    """台股月營收公告截止日為每月 10 日前，於每月 1–12 日增量更新月營收。"""
    return 1 <= d.day <= 12


class PipelineCacheManager:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _symbol_path(self, symbol: str) -> Path:
        clean = symbol.strip().upper()
        return self.cache_dir / f"{clean}.json.gz"

    def load_symbol_cache(self, symbol: str) -> Optional[dict[str, Any]]:
        path = self._symbol_path(symbol)
        if not path.exists():
            return None
        try:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def save_symbol_cache(self, symbol: str, payload: dict[str, Any]) -> None:
        path = self._symbol_path(symbol)
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def needs_price_backfill(
        cached: Optional[dict[str, Any]], force_refresh: bool = False
    ) -> bool:
        if force_refresh or cached is None:
            return True
        price_rows = cached.get("price_rows")
        if not isinstance(price_rows, list) or len(price_rows) < 60:
            return True
        return False

    @staticmethod
    def needs_financial_refresh(
        cached: Optional[dict[str, Any]],
        taipei_today: dt.date,
        force_refresh: bool = False,
    ) -> bool:
        if force_refresh or cached is None:
            return True
        if not cached.get("income_rows") or not cached.get("balance_rows"):
            return True

        last_sync_str = cached.get("last_financial_sync")
        if not last_sync_str:
            return True
        try:
            last_sync = dt.date.fromisoformat(str(last_sync_str)[:10])
        except ValueError:
            return True

        days_since = (taipei_today - last_sync).days
        if days_since > 90:
            return True

        # 若處於財報公告窗格內且超過 3 天未同步，則補抓最新財報
        if is_in_financial_window(taipei_today) and days_since >= 3:
            return True

        return False

    @staticmethod
    def needs_revenue_refresh(
        cached: Optional[dict[str, Any]],
        taipei_today: dt.date,
        force_refresh: bool = False,
    ) -> bool:
        if force_refresh or cached is None:
            return True
        if not cached.get("revenue_rows"):
            return True
        last_rev_str = cached.get("last_revenue_sync")
        if not last_rev_str:
            return True
        try:
            last_rev = dt.date.fromisoformat(str(last_rev_str)[:10])
        except ValueError:
            return True
        days_since = (taipei_today - last_rev).days
        if days_since > 35:
            return True
        if is_in_monthly_revenue_window(taipei_today) and days_since >= 3:
            return True
        return False

    @staticmethod
    def append_daily_quote(
        price_rows: list[dict[str, Any]],
        daily_quote: Optional[dict[str, Any]],
        symbol: str,
    ) -> list[dict[str, Any]]:
        """
        將 TWSE STOCK_DAY_ALL / TPEx daily_quotes 的最新收盤資料追加至歷史日線序列，
        避免每日向 FinMind 重複查詢歷史股價。
        """
        if not daily_quote:
            return price_rows
        close = daily_quote.get("close")
        date_str = daily_quote.get("date")
        if close is None or float(close) <= 0 or not date_str:
            return price_rows

        new_row = {
            "date": str(date_str),
            "stock_id": symbol,
            "Trading_Volume": float(daily_quote.get("volume") or 0.0),
            "Trading_money": float(daily_quote.get("trading_money") or 0.0),
            "open": float(daily_quote.get("open") or close),
            "max": float(daily_quote.get("high") or close),
            "min": float(daily_quote.get("low") or close),
            "close": float(close),
        }

        filtered = [r for r in price_rows if str(r.get("date")) != str(date_str)]
        filtered.append(new_row)
        filtered.sort(key=lambda r: str(r.get("date", "")))
        # 保留約 7.5 年（~1900 個交易日）避免快取無限膨脹
        if len(filtered) > 1900:
            filtered = filtered[-1900:]
        return filtered
