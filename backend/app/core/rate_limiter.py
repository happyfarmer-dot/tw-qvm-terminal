from __future__ import annotations

import asyncio
import time
from collections import deque


class SlidingWindowRateLimiter:
    """FinMind API 滑動視窗節流保護器"""

    def __init__(self, max_requests_per_hour: int = 500) -> None:
        self.max_requests_per_hour = max(1, max_requests_per_hour)
        self._timestamps: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            cutoff = now - 3600.0
            while self._timestamps and self._timestamps[0] < cutoff:
                self._timestamps.popleft()

            if len(self._timestamps) >= self.max_requests_per_hour:
                wait_for = self._timestamps[0] + 3600.0 - now
                if wait_for > 0:
                    await asyncio.sleep(min(wait_for, 5.0))
            self._timestamps.append(time.monotonic())

    @property
    def current_hour_count(self) -> int:
        now = time.monotonic()
        cutoff = now - 3600.0
        while self._timestamps and self._timestamps[0] < cutoff:
            self._timestamps.popleft()
        return len(self._timestamps)
