from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import httpx
import pytest
import respx

from pipeline.cache_manager import PipelineCacheManager, is_in_financial_window
from pipeline.calculators.adj_price import compute_free_adjusted_prices
from pipeline.fetch_tw_data import TAIPEI_TZ, run_pipeline
from pipeline.providers.finmind_client import FINMIND_USER_INFO_URL, FINMIND_V4_URL, FinMindClient
from pipeline.providers.twse_tpex_client import (
    TPEX_COMPANY_INFO_URL,
    TPEX_DAILY_QUOTES_URL,
    TPEX_MONTHLY_REV_URL,
    TWSE_COMPANY_INFO_URL,
    TWSE_DIRECTOR_PLEDGE_URL,
    TWSE_MONTHLY_REV_URL,
    TWSE_PUNISH_URL,
    TWSE_STOCK_DAY_ALL_URL,
    TWSE_VALUATION_URL,
    TwseTpexClient,
    roc_to_iso,
)
from pipeline.schemas import ManifestModel, StocksBundleModel


def test_roc_to_iso_and_twse_tpex_normalization() -> None:
    assert roc_to_iso("1150730") == "2026-07-30"
    assert roc_to_iso("115/01/05") == "2026-01-05"
    assert roc_to_iso("invalid") is None

    day_all = TwseTpexClient.normalize_twse_stock_day_all(
        [
            {
                "Code": "2330",
                "Date": "1150730",
                "OpeningPrice": "1000",
                "HighestPrice": "1020",
                "LowestPrice": "995",
                "ClosingPrice": "1015",
                "TradeVolume": "25000000",
                "TradeValue": "25375000000",
            },
            {
                "Code": "9999",
                "ClosingPrice": "0",
                "TradeVolume": "1000",
            },
        ]
    )
    assert "2330" in day_all
    assert day_all["2330"]["close"] == 1015.0
    assert day_all["2330"]["date"] == "2026-07-30"
    assert "9999" not in day_all

    rev = TwseTpexClient.normalize_monthly_revenue_rows(
        [
            {
                "公司代號": "3131",
                "營業收入-當月營收": "450000",
                "營業收入-去年同月增減(%)": "32.5",
                "累計營業收入-前期比較增減(%)": "28.1",
            }
        ]
    )
    assert rev["3131"]["monthlyYoY"] == 32.5
    assert rev["3131"]["cumYoY"] == 28.1


def test_adj_price_filters_zero_close() -> None:
    prices = [
        {"date": "2025-01-02", "open": 100, "max": 102, "min": 99, "close": 101, "Trading_Volume": 1000000, "Trading_money": 101000000},
        {"date": "2025-01-03", "open": 0, "max": 0, "min": 0, "close": 0, "Trading_Volume": 5000, "Trading_money": 0},
        {"date": "2025-01-04", "open": 101, "max": 105, "min": 100, "close": 104, "Trading_Volume": 1200000, "Trading_money": 124800000},
    ]
    df, warnings = compute_free_adjusted_prices(prices, [])
    assert len(df) == 2
    assert (df["adj_close"] > 0).all()
    assert any("close <= 0" in w for w in warnings)


def test_financial_window_detection() -> None:
    assert is_in_financial_window(dt.date(2026, 4, 5)) is True
    assert is_in_financial_window(dt.date(2026, 5, 20)) is True
    assert is_in_financial_window(dt.date(2026, 8, 18)) is True
    assert is_in_financial_window(dt.date(2026, 11, 20)) is True
    assert is_in_financial_window(dt.date(2026, 6, 15)) is False


def _sample_finmind_price_rows(days: int = 80, base: float = 100.0) -> list[dict]:
    start = dt.date(2026, 1, 1)
    rows = []
    for i in range(days):
        d = (start + dt.timedelta(days=i)).isoformat()
        p = base + i * 0.2
        rows.append(
            {
                "date": d,
                "stock_id": "2330",
                "open": p,
                "max": p + 1,
                "min": p - 1,
                "close": p,
                "Trading_Volume": 20_000_000,
                "Trading_money": 20_000_000 * p,
            }
        )
    return rows


@pytest.mark.asyncio
@respx.mock
async def test_pipeline_quota_guard_and_incremental_cache(tmp_path: Path) -> None:
    # 建立臨時專案結構
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir(parents=True)
    (pipeline_dir / "watchlist.json").write_text(
        json.dumps({"symbols": ["2330", "2886"]}), encoding="utf-8"
    )

    # 預先寫入 2330 的快取（模擬已回補 7 年歷史）
    cache_mgr = PipelineCacheManager(pipeline_dir / "cache")
    today_tw = dt.datetime.now(TAIPEI_TZ).date().isoformat()
    cache_mgr.save_symbol_cache(
        "2330",
        {
            "info_rows": [{"stock_id": "2330", "stock_name": "台積電", "industry_category": "半導體業", "type": "twse", "date": "2026-01-01"}],
            "price_rows": _sample_finmind_price_rows(80, 950.0),
            "div_res_rows": [],
            "income_rows": [
                {"date": "2025-12-31", "type": "Revenue", "value": 1_000_000_000},
                {"date": "2025-12-31", "type": "IncomeAfterTaxes", "value": 400_000_000},
            ],
            "balance_rows": [
                {"date": "2025-12-31", "type": "Equity", "value": 3_000_000_000},
                {"date": "2025-12-31", "type": "TotalAssets", "value": 5_000_000_000},
            ],
            "cashflow_rows": [],
            "revenue_rows": [],
            "dividend_rows": [],
            "last_price_sync": today_tw,
            "last_financial_sync": today_tw,
            "last_revenue_sync": today_tw,
        },
    )

    # Mock FinMind user_info 回傳額度僅剩 5 次（低於 10 次安全門檻 -> 應安全跳過 2886 的 FinMind 抓取，但 2330 仍靠快取 + TWSE 快照產出）
    respx.get(FINMIND_USER_INFO_URL).mock(
        return_value=httpx.Response(200, json={"user_count": 595, "api_request_limit": 600})
    )
    respx.get(FINMIND_V4_URL).mock(
        return_value=httpx.Response(200, json={"status": 200, "data": []})
    )

    # Mock TWSE / TPEx OpenAPI
    respx.get(TWSE_COMPANY_INFO_URL).mock(
        return_value=httpx.Response(200, json=[{"公司代號": "2330", "公司簡稱": "台積電", "產業別": "半導體業"}])
    )
    respx.get(TPEX_COMPANY_INFO_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TWSE_STOCK_DAY_ALL_URL).mock(
        return_value=httpx.Response(
            200,
            json=[{"Code": "2330", "Date": "1151120", "ClosingPrice": "1065", "TradeVolume": "30000000", "TradeValue": "31950000000"}],
        )
    )
    respx.get(TWSE_VALUATION_URL).mock(
        return_value=httpx.Response(200, json=[{"Code": "2330", "PEratio": "22.5", "PBratio": "6.8", "DividendYield": "1.6"}])
    )
    respx.get(TPEX_DAILY_QUOTES_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TWSE_DIRECTOR_PLEDGE_URL).mock(
        return_value=httpx.Response(200, json=[{"公司代號": "2330", "目前持股": "1000000", "設質股數": "0"}])
    )
    respx.get(TWSE_PUNISH_URL).mock(return_value=httpx.Response(200, json={"data": []}))
    respx.get(TWSE_MONTHLY_REV_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TPEX_MONTHLY_REV_URL).mock(return_value=httpx.Response(200, json=[]))

    async with httpx.AsyncClient(trust_env=False) as client:
        fm = FinMindClient(token="test_token", min_interval_seconds=0.0, http_client=client)
        tw = TwseTpexClient(http_client=client)

        manifest, bundle = await run_pipeline(
            root_dir=tmp_path,
            finmind_token="test_token",
            max_finmind_stocks=65,
            finmind_client=fm,
            twse_client=tw,
        )

    assert manifest.status == "partial"
    assert manifest.stats.totalWatchlist == 2
    assert manifest.stats.successCount == 1
    assert manifest.stats.cacheHits == 1
    assert manifest.stats.skippedDueToQuota == 1
    assert manifest.stats.finmindFetched == 0
    assert bundle.stocks[0].symbol == "2330"
    assert bundle.stocks[0].price == 1065.0

    # 驗證輸出檔案 Schema 可正確反序列化
    manifest_file = tmp_path / "frontend" / "public" / "data" / "manifest.json"
    bundle_file = tmp_path / "frontend" / "public" / "data" / "stocks_bundle.json"
    assert manifest_file.exists()
    assert bundle_file.exists()
    ManifestModel.model_validate_json(manifest_file.read_text(encoding="utf-8"))
    StocksBundleModel.model_validate_json(bundle_file.read_text(encoding="utf-8"))
