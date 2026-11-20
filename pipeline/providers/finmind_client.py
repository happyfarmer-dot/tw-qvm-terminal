from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential


FINMIND_V4_URL = "https://api.finmindtrade.com/api/v4/data"
FINMIND_USER_INFO_URL = "https://api.web.finmindtrade.com/v2/user_info"


class FinMindQuotaExceededError(RuntimeError):
    """Raised when FinMind API returns HTTP 402 or remaining quota is exhausted."""


class FinMindClient:
    def __init__(
        self,
        *,
        token: str = "",
        min_interval_seconds: float = 1.2,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.token = token.strip()
        self.min_interval_seconds = max(0.0, min_interval_seconds)
        self._external_client = http_client
        self._last_request_ts: float = 0.0
        self._lock = asyncio.Lock()
        self.request_count: int = 0

    async def _throttle(self) -> None:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_request_ts
            if self._last_request_ts > 0 and elapsed < self.min_interval_seconds:
                await asyncio.sleep(self.min_interval_seconds - elapsed)
            self._last_request_ts = time.monotonic()

    async def check_user_info(self) -> dict[str, Optional[int]]:
        """
        執行前檢查 FinMind 帳號剩餘額度。
        呼叫 https://api.web.finmindtrade.com/v2/user_info?token=...
        回傳 {"used": ..., "limit": ..., "remaining": ...}，失敗時回傳 None 值。
        """
        if not self.token:
            return {"used": None, "limit": None, "remaining": None}

        params = {"token": self.token}
        try:
            if self._external_client is not None:
                resp = await self._external_client.get(
                    FINMIND_USER_INFO_URL, params=params, timeout=15.0
                )
                resp.raise_for_status()
                payload = resp.json()
            else:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.get(FINMIND_USER_INFO_URL, params=params)
                    resp.raise_for_status()
                    payload = resp.json()

            if isinstance(payload, dict):
                used = payload.get("user_count")
                limit = payload.get("api_request_limit")
                if isinstance(used, (int, float)) and isinstance(limit, (int, float)):
                    used_i = int(used)
                    limit_i = int(limit)
                    return {
                        "used": used_i,
                        "limit": limit_i,
                        "remaining": max(0, limit_i - used_i),
                    }
        except Exception:
            pass
        return {"used": None, "limit": None, "remaining": None}

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.8, min=0.8, max=5),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.TransportError)),
        reraise=True,
    )
    async def fetch_dataset(
        self,
        dataset: str,
        *,
        data_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        await self._throttle()
        params: dict[str, str] = {"dataset": dataset}
        if self.token:
            params["token"] = self.token
        if data_id:
            params["data_id"] = data_id
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date

        self.request_count += 1
        if self._external_client is not None:
            resp = await self._external_client.get(FINMIND_V4_URL, params=params, timeout=20.0)
        else:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(FINMIND_V4_URL, params=params)

        if resp.status_code == 402:
            raise FinMindQuotaExceededError(f"FinMind API HTTP 402 額度已達上限 ({dataset}/{data_id})")
        resp.raise_for_status()
        payload = resp.json()

        if isinstance(payload, dict):
            status = payload.get("status")
            msg = str(payload.get("msg", ""))
            if status == 402 or "limit" in msg.lower() and status != 200:
                raise FinMindQuotaExceededError(f"FinMind API 額度不足: {msg}")
            if status != 200:
                return []
            data = payload.get("data", [])
            return data if isinstance(data, list) else []
        return []

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
