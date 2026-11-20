from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.schemas.qvm_models import (
    BatchStockRequest,
    BatchStockResponse,
    CacheClearResponse,
    CacheStats,
    HealthResponse,
    RegimeResponse,
    RegulatoryOverridePayload,
    RegulatoryOverrideRecord,
    TwStockSnapshot,
)
from app.services.tw_aggregator import TwStockAggregator


router = APIRouter(prefix="/api/v1", tags=["tw-qvm"])


def get_aggregator(request: Request) -> TwStockAggregator:
    return request.app.state.aggregator


@router.get("/health", response_model=HealthResponse)
async def health(
    agg: TwStockAggregator = Depends(get_aggregator),
) -> HealthResponse:
    stats = await agg.cache.stats()
    return HealthResponse(
        status="ok",
        finmindTier=agg.settings.finmind_tier,
        finmindTokenConfigured=bool(agg.settings.finmind_api_token.strip()),
        cacheStats=CacheStats(**stats),
    )


@router.get("/regime", response_model=RegimeResponse)
async def get_regime(
    force_refresh: bool = Query(default=False),
    agg: TwStockAggregator = Depends(get_aggregator),
) -> RegimeResponse:
    return await agg.get_regime(force_refresh=force_refresh)


@router.get("/stock/{symbol}", response_model=TwStockSnapshot)
async def get_stock(
    symbol: str,
    force_refresh: bool = Query(default=False),
    agg: TwStockAggregator = Depends(get_aggregator),
) -> TwStockSnapshot:
    clean_sym = symbol.strip().upper()
    if not clean_sym:
        raise HTTPException(status_code=400, detail="股票代號不可為空")
    return await agg.get_stock_snapshot(clean_sym, force_refresh=force_refresh)


@router.get("/stock/{symbol}/regulatory-data", response_model=RegulatoryOverrideRecord)
async def get_regulatory_data(
    symbol: str,
    agg: TwStockAggregator = Depends(get_aggregator),
) -> RegulatoryOverrideRecord:
    clean_sym = symbol.strip().upper()
    if not clean_sym:
        raise HTTPException(status_code=400, detail="股票代號不可為空")
    return await agg.get_regulatory_data(clean_sym)


@router.put("/stock/{symbol}/regulatory-data", response_model=RegulatoryOverrideRecord)
async def put_regulatory_data(
    symbol: str,
    payload: RegulatoryOverridePayload,
    agg: TwStockAggregator = Depends(get_aggregator),
) -> RegulatoryOverrideRecord:
    clean_sym = symbol.strip().upper()
    if not clean_sym:
        raise HTTPException(status_code=400, detail="股票代號不可為空")
    return await agg.save_regulatory_data(clean_sym, payload)


@router.post("/stocks/batch", response_model=BatchStockResponse)
async def get_stocks_batch(
    payload: BatchStockRequest,
    agg: TwStockAggregator = Depends(get_aggregator),
) -> BatchStockResponse:
    return await agg.get_batch_snapshots(
        payload.symbols, force_refresh=payload.force_refresh
    )


@router.delete("/cache", response_model=CacheClearResponse)
async def clear_cache(
    symbol: Optional[str] = Query(default=None),
    agg: TwStockAggregator = Depends(get_aggregator),
) -> CacheClearResponse:
    deleted = await agg.cache.clear(symbol)
    return CacheClearResponse(
        deletedCount=deleted,
        symbol=symbol.strip().upper() if symbol else None,
    )
