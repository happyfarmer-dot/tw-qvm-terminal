from __future__ import annotations

import json
import os
import time
from typing import Any, Optional

import aiosqlite


class SqliteTTLCache:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._initialized = False

    async def init(self) -> None:
        if self._initialized:
            return
        parent = os.path.dirname(self.db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS kv_cache (
                    cache_key TEXT PRIMARY KEY,
                    symbol TEXT,
                    category TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    created_at REAL NOT NULL
                )
                """
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_kv_cache_symbol ON kv_cache(symbol)"
            )
            await db.commit()
        self._initialized = True

    async def get(self, key: str) -> Optional[Any]:
        await self.init()
        now = time.time()
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT payload, expires_at FROM kv_cache WHERE cache_key = ?", (key,)
            ) as cursor:
                row = await cursor.fetchone()
                if not row:
                    return None
                payload_str, expires_at = row
                if float(expires_at) <= now:
                    await db.execute("DELETE FROM kv_cache WHERE cache_key = ?", (key,))
                    await db.commit()
                    return None
                return json.loads(payload_str)

    async def set(
        self,
        key: str,
        payload: Any,
        ttl_seconds: int,
        *,
        symbol: Optional[str] = None,
        category: str = "general",
    ) -> None:
        await self.init()
        now = time.time()
        expires_at = now + max(1, ttl_seconds)
        serialized = json.dumps(payload, ensure_ascii=False)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO kv_cache (cache_key, symbol, category, payload, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    symbol = excluded.symbol,
                    category = excluded.category,
                    payload = excluded.payload,
                    expires_at = excluded.expires_at,
                    created_at = excluded.created_at
                """,
                (key, symbol, category, serialized, expires_at, now),
            )
            await db.commit()

    async def clear(self, symbol: Optional[str] = None) -> int:
        await self.init()
        async with aiosqlite.connect(self.db_path) as db:
            if symbol:
                cursor = await db.execute(
                    "DELETE FROM kv_cache WHERE symbol = ?", (symbol.strip().upper(),)
                )
            else:
                cursor = await db.execute("DELETE FROM kv_cache")
            await db.commit()
            return cursor.rowcount if cursor.rowcount is not None else 0

    async def stats(self) -> dict[str, Any]:
        await self.init()
        now = time.time()
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT COUNT(*) FROM kv_cache") as c1:
                total = (await c1.fetchone() or (0,))[0]
            async with db.execute(
                "SELECT COUNT(*) FROM kv_cache WHERE expires_at > ?", (now,)
            ) as c2:
                valid = (await c2.fetchone() or (0,))[0]
        return {
            "totalEntries": int(total),
            "validEntries": int(valid),
            "dbPath": self.db_path,
        }
