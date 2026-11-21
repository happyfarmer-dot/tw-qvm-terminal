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


@pytest.mark.asyncio
@respx.mock
async def test_pipeline_anonymous_fallback_mode(tmp_path: Path) -> None:
    # 驗證無 Token 時自動採用匿名模式（每小時 220 次上限，優先處理核心龍頭股）
    pipeline_dir = tmp_path / "pipeline"
    pipeline_dir.mkdir(parents=True)
    (pipeline_dir / "watchlist.json").write_text(
        json.dumps({"symbols": ["9999", "2330", "2317"]}), encoding="utf-8"
    )

    # Mock TWSE / TPEx OpenAPI
    respx.get(TWSE_COMPANY_INFO_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TPEX_COMPANY_INFO_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TWSE_STOCK_DAY_ALL_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TWSE_VALUATION_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TPEX_DAILY_QUOTES_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TWSE_DIRECTOR_PLEDGE_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TWSE_PUNISH_URL).mock(return_value=httpx.Response(200, json={"data": []}))
    respx.get(TWSE_MONTHLY_REV_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(TPEX_MONTHLY_REV_URL).mock(return_value=httpx.Response(200, json=[]))
    respx.get(FINMIND_V4_URL).mock(return_value=httpx.Response(200, json={"status": 200, "data": []}))

    async with httpx.AsyncClient(trust_env=False) as client:
        fm = FinMindClient(token="", min_interval_seconds=0.0, http_client=client)
        tw = TwseTpexClient(http_client=client)

        manifest, bundle = await run_pipeline(
            root_dir=tmp_path,
            finmind_token="",
            max_finmind_stocks=65,  # 應自動限縮為 25 檔核心股
            finmind_client=fm,
            twse_client=tw,
        )

    assert manifest.stats.totalWatchlist == 3
    # 2330, 2317 為核心龍頭股，應排在 9999 之前優先處理
    symbols_processed = [s.symbol for s in bundle.stocks]
    assert symbols_processed[:2] == ["2330", "2317"]
    assert bundle.stocks[0].healthReport is not None
    assert len(bundle.stocks[0].healthReport.safetyCheckup) == 4
    assert len(bundle.stocks[0].healthReport.dimensions) == 3


def test_health_report_generation_for_all_profiles() -> None:
    from pipeline.calculators.health_report_builder import build_stock_health_report
    from pipeline.schemas import (
        CyclicalMetricsModel,
        FinancialRatiosModel,
        FinancialSectorMetricsModel,
        GmQuarterPoint,
        StageZeroMetricsModel,
    )

    sz = StageZeroMetricsModel(
        isManufacturing=True,
        avgDailyTurnover20dTWD=1_500_000_000,
        isDispositionStock=False,
        directorPledgeRatio=5.2,
        cumulative3yOCF=50_000_000_000,
        cumulative5yOCF=80_000_000_000,
        consecutive2qArOrInvBloat=False,
        beneishMScore=-2.45,
        altmanZScore=4.2,
    )
    ratios = FinancialRatiosModel(
        roic3yAvgPct=22.5,
        gpaPct=34.0,
        ocfToNi3yPct=125.0,
        piotroskiRaw=8,
        evToEbitda=11.5,
        fcfYieldPct=5.8,
        trailingPe=15.2,
        pbRatio=3.2,
        dividendYieldPct=3.8,
        consecutive5yDividend=True,
        mom12m1mSharpe=1.15,
        rev3mCumYoYPct=18.5,
        rev12mCumYoYPct=12.0,
        trendVsMa200Pct=8.5,
    )
    cyc = CyclicalMetricsModel(
        currentPB=1.4,
        pbPercentile5to7Y=28.0,
        avgRoic5to7Y=13.5,
        normalizedEvToEbit=9.8,
        roeZScoreVs5to7Y=0.3,
        assetGrowthYoY=8.2,
        latestDio=65.0,
        dioQoqChange=-5.5,
        grossMarginLatest=42.0,
        grossMarginQoQ=1.8,
        grossMarginQuarterlySeries=[
            GmQuarterPoint(quarter="2025Q3", grossMarginPct=40.2),
            GmQuarterPoint(quarter="2025Q4", grossMarginPct=42.0),
        ],
    )
    fin_sec = FinancialSectorMetricsModel(
        avgRoe5Y=11.2,
        roeStdDev5Y=1.4,
        minAnnualRoe5Y=9.1,
        currentPB=1.15,
        justifiedPB=1.35,
        pbValuationRatio=0.85,
        pbPercentile5to7Y=32.0,
        cashDividendYieldPct=4.8,
        consecutiveCashDivYears=8,
        latestPayoutRatioPct=62.0,
        usesCapitalReserveForDividend=False,
    )

    for prof in ("standard", "cyclical_heavy_asset", "financial_bank"):
        report = build_stock_health_report(
            sym="2330",
            name="測試標的",
            sector="半導體業",
            profile=prof,  # type: ignore[arg-type]
            report_date="2026-11-20",
            price=1000.0,
            high_20d=1040.0,
            atr20=20.0,
            ma120=950.0,
            ma200=910.0,
            sz=sz,
            ratios=ratios,
            cyc=cyc,
            fin_sec=fin_sec if prof == "financial_bank" else None,
            income_rows=[
                {"date": "2025-09-30", "type": "Revenue", "value": 750_000_000_000},
                {"date": "2025-12-31", "type": "Revenue", "value": 820_000_000_000},
            ],
            regime="NORMAL",
        )
        assert report.executiveSummary.grade in ("A", "B")
        assert len(report.safetyCheckup) == 4
        assert len(report.dimensions) == 3
        assert report.actionPlan.buyStrategy.canBuyNow is True
        assert report.actionPlan.buyStrategy.firstTranchePct == 50
        assert report.actionPlan.sellAndDefenseStrategy.stopLossPrice == 950.0
        assert report.actionPlan.sellAndDefenseStrategy.ma200Price == 910.0
        expected_trail = 1000.0 if prof == "cyclical_heavy_asset" else 980.0
        assert report.actionPlan.sellAndDefenseStrategy.trailingStopPrice == expected_trail


def test_ytd_cashflow_no_double_counting_and_ttm_formula() -> None:
    """
    驗證 FinMind 累計至該季 (YTD) 現金流量表不會被重複加總 4 次，
    且 TTM 公式嚴格遵循：最新累計季報 + 前一年度年報 - 前一年同季累計季報。
    """
    from pipeline.calculators.financial_ratios import (
        compute_all_financial_ratios,
        compute_ttm_metrics,
        extract_annual_snapshots,
    )

    # 模擬 2023-2025 每年 4 季 YTD 累計營業現金流（Q1=100, H1=200, 9M=300, FY=400）
    cashflow_rows = []
    income_rows = []
    balance_rows = []
    for yr in (2023, 2024, 2025):
        for q_date, ytd_ocf in (
            (f"{yr}-03-31", 100.0),
            (f"{yr}-06-30", 200.0),
            (f"{yr}-09-30", 300.0),
            (f"{yr}-12-31", 400.0),
        ):
            cashflow_rows.append(
                {"date": q_date, "type": "CashFlowsFromOperatingActivities", "value": ytd_ocf}
            )
            cashflow_rows.append(
                {"date": q_date, "type": "PropertyAndPlantAndEquipment", "value": -ytd_ocf * 0.25}
            )
            income_rows.append({"date": q_date, "type": "Revenue", "value": 250.0})
            income_rows.append({"date": q_date, "type": "GrossProfit", "value": 80.0})
            income_rows.append({"date": q_date, "type": "OperatingIncome", "value": 50.0})
            income_rows.append({"date": q_date, "type": "IncomeAfterTaxes", "value": 40.0})
            income_rows.append({"date": q_date, "type": "EPS", "value": 1.0})

        balance_rows.extend(
            [
                {"date": f"{yr}-12-31", "type": "TotalAssets", "value": 2000.0},
                {"date": f"{yr}-12-31", "type": "CurrentAssets", "value": 800.0},
                {"date": f"{yr}-12-31", "type": "CurrentLiabilities", "value": 400.0},
                {"date": f"{yr}-12-31", "type": "LongtermBorrowings", "value": 300.0},
                {"date": f"{yr}-12-31", "type": "Equity", "value": 1000.0},
                {"date": f"{yr}-12-31", "type": "OrdinaryShare", "value": 400.0},
            ]
        )

    # 加入 2026 前三季 (2026-09-30 YTD OCF = 360.0)
    cashflow_rows.append(
        {"date": "2026-09-30", "type": "CashFlowsFromOperatingActivities", "value": 360.0}
    )
    income_rows.append({"date": "2026-09-30", "type": "EPS", "value": 1.5})

    snaps = extract_annual_snapshots(income_rows, balance_rows, cashflow_rows)
    yr_2025 = next(s for s in snaps if s["year"] == 2025.0)
    # 2025 全年 OCF 必須等於 -12-31 年報列的 400.0，絕不可為 100+200+300+400 = 1000.0
    assert yr_2025["ocf"] == 400.0

    # TTM OCF = 2026Q3累計(360) + 2025年報(400) - 2025Q3累計(300) = 460.0
    ttm = compute_ttm_metrics(income_rows, cashflow_rows)
    assert ttm["ttmOcf"] == 460.0

    ratios = compute_all_financial_ratios(
        income_rows=income_rows,
        balance_rows=balance_rows,
        cashflow_rows=cashflow_rows,
        revenue_rows=[],
        dividend_rows=[],
        latest_price=50.0,
    )
    # 近 3 個完整會計年度 (2023, 2024, 2025) 累計 OCF = 400 * 3 = 1200.0
    assert ratios["cumulative3yOCF"] == 1200.0
    assert ratios["piotroskiRaw"] is not None


def test_shipping_and_sector_code_cyclical_classification() -> None:
    """
    驗證證交所/櫃買產業代碼 '15'（航運業，如 2618 長榮航）、'10'（鋼鐵）、'03'/'13'（塑膠）、'26'（光電）
    自動套用強景氣循環模型。
    """
    from pipeline.calculators.cyclical_metrics import (
        normalize_tw_sector_name,
        recommend_valuation_profile,
    )

    assert normalize_tw_sector_name("15") == "航運業"
    assert recommend_valuation_profile("15", "2618", "長榮航") == "cyclical_heavy_asset"
    assert recommend_valuation_profile("15", "2603", "長榮") == "cyclical_heavy_asset"
    assert recommend_valuation_profile("10", "2002", "中鋼") == "cyclical_heavy_asset"
    assert recommend_valuation_profile("03", "1301", "台塑") == "cyclical_heavy_asset"
    assert recommend_valuation_profile("24", "3131", "弘塑") == "cyclical_inventory_order"
    assert recommend_valuation_profile("17", "2881", "富邦金") == "financial_life_fhc"
    assert recommend_valuation_profile("17", "2886", "兆豐金") == "financial_bank"


def test_5y_pe_river_and_short_term_overheat_pullback_filter() -> None:
    """
    驗證：
    1. 近 5 年本益比河流三價位（便宜價 / 合理中樞價 / 昂貴警戒價）計算
    2. 短線過熱防追高濾網（A 級且近 20 日漲幅 ≥ 12% 或 14 日 RSI ≥ 70 時，切換為月線 ±1.5% 低接區間）
    3. 防禦模式下首筆 30% + 第二批 70% = 100%，且報告無任何未渲染的 $ LaTeX 語法
    """
    import pandas as pd
    from pipeline.calculators.cyclical_metrics import compute_pe_river_5y
    from pipeline.calculators.health_report_builder import build_stock_health_report
    from pipeline.schemas import (
        CyclicalMetricsModel,
        FinancialRatiosModel,
        StageZeroMetricsModel,
    )

    price_rows = [
        {"date": f"2024-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}", "close": 100.0 + i * 0.5, "adj_close": 100.0 + i * 0.5}
        for i in range(120)
    ]
    price_df = pd.DataFrame(price_rows)
    income_rows = [
        {"date": "2023-12-31", "type": "EPS", "value": 8.0},
        {"date": "2024-12-31", "type": "EPS", "value": 10.0},
        {"date": "2025-12-31", "type": "EPS", "value": 12.0},
    ]
    pe_river = compute_pe_river_5y(
        price_df=price_df,
        income_rows=income_rows,
        balance_rows=[],
        cashflow_rows=[],
        latest_price=180.0,
        trailing_pe_override=15.0,
    )
    assert pe_river["ttmEps"] == 12.0
    assert pe_river["cheapPrice"] is not None
    assert pe_river["fairPrice"] is not None
    assert pe_river["expensivePrice"] is not None
    assert pe_river["cheapPrice"] < pe_river["fairPrice"] < pe_river["expensivePrice"]

    sz = StageZeroMetricsModel(
        isManufacturing=True,
        avgDailyTurnover20dTWD=2_000_000_000,
        isDispositionStock=False,
        directorPledgeRatio=3.0,
        cumulative3yOCF=90_000_000_000,
        consecutive2qArOrInvBloat=False,
        beneishMScore=-2.5,
        altmanZScore=5.0,
    )
    ratios = FinancialRatiosModel(
        roic3yAvgPct=25.0,
        gpaPct=35.0,
        ocfToNi3yPct=120.0,
        piotroskiRaw=8,
        evToEbitda=11.0,
        fcfYieldPct=6.0,
        trailingPe=15.0,
        dividendYieldPct=4.0,
        consecutive5yDividend=True,
        mom12m1mSharpe=1.2,
        rev3mCumYoYPct=22.0,
        rev12mCumYoYPct=15.0,
        trendVsMa200Pct=14.0,
    )

    report = build_stock_health_report(
        sym="2330",
        name="台積電",
        sector="半導體業",
        profile="standard",
        report_date="2026-11-20",
        price=1050.0,
        high_20d=1060.0,
        atr20=25.0,
        ma20=980.0,
        ma120=920.0,
        ma200=880.0,
        ret20d_pct=15.4,  # >= 12% 觸發短線過熱
        rsi14=74.2,       # >= 70 觸發短線過熱
        pe_river_data=pe_river,
        sz=sz,
        ratios=ratios,
        cyc=CyclicalMetricsModel(),
        fin_sec=None,
        income_rows=income_rows,
        regime="DEFENSIVE",
    )

    assert report.executiveSummary.verdictBadge == "A 級｜體質優秀，短線過熱等拉回"
    # 檢查買進區間是否切換為 20 日月線 (980 ± 1.5% -> 965.3 ~ 994.7)
    assert "965.3 ~ 994.7" in report.actionPlan.buyStrategy.entryZoneText
    assert "月線" in report.actionPlan.buyStrategy.entryZoneText
    # 防禦模式首筆 30%，第二批必須是 70%（30% + 70% = 100%）
    assert report.actionPlan.buyStrategy.firstTranchePct == 30
    assert "再投入剩餘 70% 資金完成建倉" in report.actionPlan.buyStrategy.secondTrancheCondition
    # 確認無任何未渲染的 $>=$ 或 $<=$
    dump_str = report.model_dump_json()
    assert ">=" not in dump_str
    assert "<=" not in dump_str



