from __future__ import annotations

from typing import Any, Optional

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.cache import SqliteTTLCache
from app.core.rate_limiter import SlidingWindowRateLimiter


FINMIND_V4_URL = "https://api.finmindtrade.com/api/v4/data"


class FinMindClient:
    def __init__(
        self,
        *,
        token: str,
        cache: SqliteTTLCache,
        rate_limiter: SlidingWindowRateLimiter,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.token = token.strip()
        self.cache = cache
        self.rate_limiter = rate_limiter
        self._external_client = http_client

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=4),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.TransportError)),
        reraise=True,
    )
    async def _request(self, params: dict[str, str]) -> list[dict[str, Any]]:
        await self.rate_limiter.acquire()
        req_params = dict(params)
        if self.token:
            req_params["token"] = self.token

        if self._external_client is not None:
            resp = await self._external_client.get(FINMIND_V4_URL, params=req_params, timeout=15.0)
            resp.raise_for_status()
            payload = resp.json()
        else:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(FINMIND_V4_URL, params=req_params)
                resp.raise_for_status()
                payload = resp.json()

        if not isinstance(payload, dict) or payload.get("status") != 200:
            return []
        data = payload.get("data", [])
        return data if isinstance(data, list) else []

    async def fetch_dataset(
        self,
        dataset: str,
        *,
        data_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        ttl_seconds: int = 43_200,
        force_refresh: bool = False,
        category: str = "finmind",
    ) -> tuple[list[dict[str, Any]], bool]:
        cache_key = f"finmind:{dataset}:{data_id or 'ALL'}:{start_date or ''}:{end_date or ''}"
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached is not None:
                return cached, True

        params: dict[str, str] = {"dataset": dataset}
        if data_id:
            params["data_id"] = data_id
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date

        rows = await self._request(params)
        await self.cache.set(
            cache_key,
            rows,
            ttl_seconds,
            symbol=data_id.upper() if data_id else None,
            category=category,
        )
        return rows, False

    @staticmethod
    def pick_latest_stock_info(rows: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
        """
        同一 stock_id 若同時存在 emerging 與 twse/tpex，強制取 date 最新一列；
        若同日有多筆則優先取 twse/tpex 而非 emerging。
        """
        if not rows:
            return None

        def sort_key(r: dict[str, Any]) -> tuple[str, int]:
            date_str = str(r.get("date", ""))
            market_rank = 1 if str(r.get("type", "")).lower() in ("twse", "tpex") else 0
            return (date_str, market_rank)

        return max(rows, key=sort_key)
