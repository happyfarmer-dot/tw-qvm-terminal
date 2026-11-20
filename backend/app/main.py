from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings
from app.core.cache import SqliteTTLCache
from app.core.rate_limiter import SlidingWindowRateLimiter
from app.core.regulatory_store import RegulatoryOverrideStore
from app.providers.finmind_client import FinMindClient
from app.providers.twse_tpex_client import TwseTpexClient
from app.services.tw_aggregator import TwStockAggregator


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        cache = SqliteTTLCache(settings.cache_db_path)
        await cache.init()
        reg_store = RegulatoryOverrideStore(settings.cache_db_path)
        await reg_store.init()
        limiter = SlidingWindowRateLimiter(settings.finmind_rate_limit_per_hour)
        finmind = FinMindClient(
            token=settings.finmind_api_token,
            cache=cache,
            rate_limiter=limiter,
        )
        twse_tpex = TwseTpexClient(
            cache=cache,
            snapshot_ttl_seconds=settings.cache_ttl_market_snapshot_seconds,
        )
        app.state.aggregator = TwStockAggregator(
            settings=settings,
            cache=cache,
            finmind=finmind,
            twse_tpex=twse_tpex,
            regulatory_store=reg_store,
        )
        yield

    app = FastAPI(
        title="TW-QVM Quant Terminal API",
        version="1.0.0",
        description="台股品質＋價值＋動能選股評分與資料聚合後端",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)
    return app


app = create_app()
