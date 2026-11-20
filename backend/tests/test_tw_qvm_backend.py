from __future__ import annotations

from pathlib import Path

import httpx
import pytest
import respx

from app.calculators.adj_price import (
    CASH_REDUCTION_WARNING,
    compute_free_adjusted_prices,
)
from app.calculators.financial_ratios import (
    compute_all_financial_ratios,
    compute_altman_scores,
    compute_beneish_m_score,
    compute_piotroski_checks,
    safe_div,
)
from app.calculators.regime_detector import detect_taiex_regime
from app.config import Settings
from app.core.cache import SqliteTTLCache
from app.core.rate_limiter import SlidingWindowRateLimiter
from app.providers.finmind_client import FINMIND_V4_URL, FinMindClient
from app.providers.twse_tpex_client import (
    TPEX_COMPANY_INFO_URL,
    TPEX_DAILY_QUOTES_URL,
    TWSE_COMPANY_INFO_URL,
    TWSE_DIRECTOR_PLEDGE_URL,
    TWSE_PUNISH_URL,
    TWSE_VALUATION_URL,
    TwseTpexClient,
    roc_to_iso,
)
from app.services.tw_aggregator import TwStockAggregator


def test_adj_price_filtering_and_backward_factor() -> None:
    price_rows = [
        {"date": "2026-06-10", "open": 100, "max": 102, "min": 99, "close": 100, "Trading_Volume": 10000, "Trading_money": 1000000},
        {"date": "2026-06-11", "open": 0, "max": 0, "min": 0, "close": 0, "Trading_Volume": 5000, "Trading_money": 0},  # 有量無價異常日
        {"date": "2026-06-12", "open": 96, "max": 98, "min": 95, "close": 97, "Trading_Volume": 12000, "Trading_money": 1164000},
    ]
    div_rows = [
        {"date": "2026-06-12", "before_price": 100.0, "after_price": 95.0},
    ]

    df, warnings = compute_free_adjusted_prices(price_rows, div_rows)
    assert len(df) == 2
    assert "2026-06-11" not in df["date"].tolist()
    assert any("close <= 0" in w for w in warnings)
    assert CASH_REDUCTION_WARNING in warnings

    # 2026-06-10 在除息日 2026-06-12 之前，應乘以 factor = 95/100 = 0.95
    assert df.loc[df["date"] == "2026-06-10", "adj_close"].iloc[0] == pytest.approx(95.0, rel=1e-4)
    # 2026-06-12 除息日當天與之後 factor = 1.0
    assert df.loc[df["date"] == "2026-06-12", "adj_close"].iloc[0] == pytest.approx(97.0, rel=1e-4)


def test_roc_to_iso_and_twse_tpex_normalization() -> None:
    assert roc_to_iso("1150730") == "2026-07-30"
    assert roc_to_iso("115/07/30") == "2026-07-30"
    assert roc_to_iso("115.01.05") == "2026-01-05"
    assert roc_to_iso("invalid") is None

    pledge_rows = [
        {"公司代號": "2330", "目前持股": "1,000,000", "設質股數": "100,000"},
        {"公司代號": "2330", "目前持股": "1,000,000", "設質股數": "0"},
        {"公司代號": "6599", "目前持股": "1,000,000", "設質股數": "750,000"},
    ]
    norm = TwseTpexClient.normalize_director_pledge(pledge_rows)
    assert norm["2330"]["totalPledgeRatioPct"] == pytest.approx(5.0)
    assert norm["2330"]["maxSingleDirectorPledgePct"] == pytest.approx(10.0)
    assert norm["6599"]["effectivePledgeRatioPct"] == pytest.approx(75.0)

    tpex_info = TwseTpexClient.normalize_company_info_list(
        [{"SecuritiesCompanyCode": "8069", "CompanyName": "元太", "產業別": "光電業"}],
        "tpex",
    )
    assert tpex_info["8069"]["name"] == "元太"
    assert tpex_info["8069"]["marketType"] == "tpex"


def test_financial_ratios_and_no_silent_null_to_zero() -> None:
    assert safe_div(100.0, 0.0) is None
    assert safe_div(None, 10.0) is None

    # 缺欄位時 Beneish / Altman / Piotroski 必須回傳 None，嚴禁補 0
    partial_curr = {"revenue": 1000.0, "totalAssets": 0.0}
    partial_prev = {"revenue": 900.0, "totalAssets": 500.0}
    assert compute_beneish_m_score(partial_curr, partial_prev) is None
    z_mfg, z_non = compute_altman_scores(partial_curr, 1000.0)
    assert z_mfg is None and z_non is None

    checks_partial, raw_partial = compute_piotroski_checks(partial_curr, partial_prev)
    assert checks_partial["positiveRoa"] is None
    assert raw_partial is None

    # 完整數據驗證
    curr = {
        "revenue": 1200.0,
        "grossProfit": 480.0,
        "operatingIncome": 240.0,
        "sga": 180.0,
        "netIncome": 200.0,
        "depreciation": 50.0,
        "ocf": 260.0,
        "totalAssets": 1500.0,
        "currentAssets": 700.0,
        "currentLiabilities": 300.0,
        "ar": 180.0,
        "inventory": 120.0,
        "ppe": 500.0,
        "longTermDebt": 200.0,
        "totalLiabilities": 500.0,
        "equity": 1000.0,
        "retainedEarnings": 600.0,
        "shares": 100.0,
    }
    prev = {
        "revenue": 1000.0,
        "grossProfit": 380.0,
        "operatingIncome": 180.0,
        "sga": 160.0,
        "netIncome": 150.0,
        "depreciation": 45.0,
        "ocf": 180.0,
        "totalAssets": 1400.0,
        "currentAssets": 600.0,
        "currentLiabilities": 320.0,
        "ar": 150.0,
        "inventory": 100.0,
        "ppe": 480.0,
        "longTermDebt": 240.0,
        "totalLiabilities": 560.0,
        "equity": 840.0,
        "retainedEarnings": 480.0,
        "shares": 100.0,
    }

    m_score = compute_beneish_m_score(curr, prev)
    assert m_score is not None and m_score < -1.78

    z_ok, zpp_ok = compute_altman_scores(curr, 2400.0)
    assert z_ok is not None and z_ok > 1.81
    assert zpp_ok is not None and zpp_ok > 1.10

    checks_ok, raw_ok = compute_piotroski_checks(curr, prev)
    assert raw_ok == 9
    assert all(v is True for v in checks_ok.values())


def test_regime_detector() -> None:
    # 建構 210 天先漲後跌超過 15% 之模擬走勢
    rows = []
    for i in range(190):
        rows.append({"date": f"2026-01-{i+1:03d}", "close": 22000.0 + i * 5})
    for i in range(20):
        rows.append({"date": f"2026-09-{i+1:02d}", "close": 22900.0 - i * 200})

    res = detect_taiex_regime(rows)
    assert res["regime"] == "DEFENSIVE"
    assert res["drawdown20dPct"] > 10.0


@pytest.mark.asyncio
async def test_sqlite_cache_hit_prevents_second_http_call(tmp_path: Path) -> None:
    db_file = str(tmp_path / "test_cache.db")
    cache = SqliteTTLCache(db_file)
    await cache.init()

    settings = Settings(
        finmind_api_token="test-token",
        finmind_tier="free",
        cache_db_path=db_file,
    )

    with respx.mock(assert_all_called=False) as mock:
        finmind_route = mock.get(FINMIND_V4_URL).mock(
            return_value=httpx.Response(
                200,
                json={
                    "msg": "success",
                    "status": 200,
                    "data": [
                        {
                            "date": "2026-11-19",
                            "stock_id": "2330",
                            "stock_name": "台積電",
                            "industry_category": "半導體業",
                            "type": "twse",
                            "open": 1050,
                            "max": 1060,
                            "min": 1045,
                            "close": 1055,
                            "Trading_Volume": 25000000,
                            "Trading_money": 26375000000,
                        }
                    ],
                },
            )
        )
        mock.get(TWSE_COMPANY_INFO_URL).mock(
            return_value=httpx.Response(
                200,
                json=[{"公司代號": "2330", "公司簡稱": "台積電", "產業別": "半導體業"}],
            )
        )
        mock.get(TPEX_COMPANY_INFO_URL).mock(return_value=httpx.Response(200, json=[]))
        mock.get(TWSE_VALUATION_URL).mock(
            return_value=httpx.Response(
                200,
                json=[{"Code": "2330", "PEratio": "22.5", "PBratio": "7.2", "DividendYield": "1.6"}],
            )
        )
        mock.get(TPEX_DAILY_QUOTES_URL).mock(return_value=httpx.Response(200, json=[]))
        mock.get(TWSE_DIRECTOR_PLEDGE_URL).mock(
            return_value=httpx.Response(
                200,
                json=[{"公司代號": "2330", "目前持股": "1000000", "設質股數": "5000"}],
            )
        )
        mock.get(TWSE_PUNISH_URL).mock(return_value=httpx.Response(200, json={"data": []}))

        async with httpx.AsyncClient(trust_env=False) as client:
            limiter = SlidingWindowRateLimiter(500)
            fm = FinMindClient(token="test", cache=cache, rate_limiter=limiter, http_client=client)
            tw = TwseTpexClient(cache=cache, snapshot_ttl_seconds=86400, http_client=client)
            agg = TwStockAggregator(settings=settings, cache=cache, finmind=fm, twse_tpex=tw)

            snap1 = await agg.get_stock_snapshot("2330", force_refresh=False)
            assert snap1.symbol == "2330"
            assert snap1.dataQuality.fromCache is False
            # 確認無靜默補 0：會計師意見必須為 None 且列入 manualVerificationRequired
            assert snap1.stageZeroMetrics.hasAuditOrGovernanceRedFlag is None
            assert snap1.ratios.forwardPe is None
            assert any("hasAuditOrGovernanceRedFlag" in x for x in snap1.dataQuality.manualVerificationRequired)

            calls_after_first = finmind_route.call_count
            assert calls_after_first > 0

            # 第二次請求必須直接命中 SQLite 快取，不可再發起 HTTP 呼叫
            snap2 = await agg.get_stock_snapshot("2330", force_refresh=False)
            assert snap2.dataQuality.fromCache is True
            assert finmind_route.call_count == calls_after_first
            assert snap2.recommendedProfile == "standard"
            assert snap2.cyclicalMetrics.contractLiabilitiesToRev is None
            assert any("合約負債" in x for x in snap2.dataQuality.manualVerificationRequired)


def test_cyclical_metrics_damodaran_pb_dio_and_per_filtering() -> None:
    import pandas as pd
    from app.calculators.cyclical_metrics import (
        compute_cyclical_metrics,
        recommend_valuation_profile,
    )

    assert recommend_valuation_profile("航運業", "2603", "長榮") == "cyclical_heavy_asset"
    assert recommend_valuation_profile("半導體業", "3131", "弘塑") == "cyclical_inventory_order"
    assert recommend_valuation_profile("食品工業", "1216", "統一") == "standard"

    # 建構 6 年 (2020-2025) 季度財報 + 故意混入 Inventories_per 百分比列
    income_rows = []
    balance_rows = []
    cashflow_rows = []
    years = [2020, 2021, 2022, 2023, 2024, 2025]
    q_dates = ["03-31", "06-30", "09-30", "12-31"]
    for yi, y in enumerate(years):
        # 循環營收與營業利益（10%~25% 循環波動，平均 ~15%）
        op_margin = [0.10, 0.14, 0.22, 0.18, 0.12, 0.14][yi]
        for qi, qd in enumerate(q_dates):
            d = f"{y}-{qd}"
            rev = 1000.0
            cogs = 600.0
            op_inc = rev * op_margin
            ni = op_inc * 0.8
            inv = 400.0 + yi * 20.0 + qi * 5.0
            income_rows.extend([
                {"date": d, "type": "Revenue", "value": rev},
                {"date": d, "type": "CostOfGoodsSold", "value": cogs},
                {"date": d, "type": "GrossProfit", "value": rev - cogs},
                {"date": d, "type": "OperatingIncome", "value": op_inc},
                {"date": d, "type": "IncomeAfterTaxes", "value": ni},
            ])
            balance_rows.extend([
                {"date": d, "type": "TotalAssets", "value": 3000.0 + yi * 100.0},
                {"date": d, "type": "CurrentAssets", "value": 1500.0},
                {"date": d, "type": "CurrentLiabilities", "value": 600.0},
                {"date": d, "type": "LongTermLiabilities", "value": 200.0},
                {"date": d, "type": "CashAndCashEquivalents", "value": 400.0},
                {"date": d, "type": "Equity", "value": 2000.0},
                {"date": d, "type": "OrdinaryShare", "value": 1000.0},  # 100 shares (面額 10)
                {"date": d, "type": "Inventories", "origin_name": "存貨", "value": inv},
                # 故意插入 FinMind 常見 _per 百分比列，若未過濾將嚴重污染存貨金額
                {"date": d, "type": "Inventories_per", "origin_name": "存貨百分比", "value": 13.5},
            ])
            cashflow_rows.extend([
                {"date": d, "type": "CashFlowsFromOperatingActivities", "value": 150.0},
                {"date": d, "type": "AcquisitionOfPropertyPlantAndEquipment", "value": 80.0},
                {"date": d, "type": "Depreciation", "value": 60.0},
            ])

    # 建構跨度 6 年每週股價序列，最後收在 50 元 (BVPS = 2000 / 100 = 20 -> P/B = 2.5，歷史最高)
    price_dates = pd.date_range("2020-04-01", "2026-01-10", freq="7D")
    price_rows = []
    for idx, pd_ts in enumerate(price_dates):
        p = 16.0 + (idx / len(price_dates)) * 34.0
        price_rows.append({"date": pd_ts.strftime("%Y-%m-%d"), "close": round(p, 2)})
    price_df = pd.DataFrame(price_rows)
    price_df["adj_close"] = price_df["close"]

    cyc = compute_cyclical_metrics(
        price_df=price_df,
        income_rows=income_rows,
        balance_rows=balance_rows,
        cashflow_rows=cashflow_rows,
        latest_price=50.0,
        ma200=38.0,
    )

    assert cyc["currentPB"] == pytest.approx(2.5, rel=0.05)
    assert cyc["pbPercentile5to7Y"] is not None and cyc["pbPercentile5to7Y"] >= 95.0
    assert cyc["pbBand"]["min"] is not None and cyc["pbBand"]["max"] is not None
    assert cyc["avgOpMargin5to7Y"] == pytest.approx(15.0, abs=0.2)
    assert cyc["normalizedEBIT"] == pytest.approx(600.0, rel=0.05)
    # EV = 50*100 + 200 - 400 = 4800; EV / 600 = 8.0
    assert cyc["normalizedEvToEbit"] == pytest.approx(8.0, rel=0.05)
    # 確認 DIO 未受 Inventories_per=13.5 影響：平均存貨 ~ 512.5, COGS = 600 -> DIO ~ (512.5/600)*90 = 76.9
    assert cyc["latestDio"] is not None and cyc["latestDio"] > 70.0
    assert len(cyc["dioQuarterlySeries"]) == 8
    assert len(cyc["grossMarginQuarterlySeries"]) == 8
    # 未提供合約負債 -> 必須回傳 None 不可補 0
    assert cyc["contractLiabilitiesYoY"] is None
    assert cyc["contractLiabilitiesToRev"] is None


@pytest.mark.asyncio
async def test_financial_sector_regulatory_endpoints_and_justified_pb(tmp_path: Path) -> None:
    from fastapi import FastAPI
    from app.api.routes import router
    from app.calculators.cyclical_metrics import recommend_valuation_profile
    from app.calculators.financial_sector_metrics import compute_justified_pb
    from app.core.regulatory_store import RegulatoryOverrideStore

    # 1. 金融業推薦次類型判斷
    assert recommend_valuation_profile("金融保險業", "2886", "兆豐金") == "financial_bank"
    assert recommend_valuation_profile("金融保險業", "2881", "富邦金") == "financial_life_fhc"
    assert recommend_valuation_profile("金融保險業", "9990", "未知銀行") == "financial_bank"

    # 2. Justified P/B 精度與防發散截斷驗證
    # ROE=10%, payout=60%, ke=8% -> g = min(0.10*0.4=0.04, 0.08-0.025=0.055, 0.05) = 0.04
    # justifiedPB = (0.10 - 0.04) / (0.08 - 0.04) = 0.06 / 0.04 = 1.50
    g_pct, jpb = compute_justified_pb(avg_roe_5y_pct=10.0, avg_payout_ratio_pct=60.0, ke=0.08)
    assert g_pct == pytest.approx(4.0, abs=0.01)
    assert jpb == pytest.approx(1.5, abs=0.01)

    # 極端高 ROE=28%, payout=0%, ke=8% -> 必須截斷 g <= ke - 0.025 = 0.055 (再取 <= 0.05)，絕不可發散
    g_clamped, jpb_clamped = compute_justified_pb(avg_roe_5y_pct=28.0, avg_payout_ratio_pct=0.0, ke=0.08)
    assert g_clamped is not None and g_clamped <= 5.0
    assert jpb_clamped is not None and jpb_clamped > 0

    # ROE <= 0 -> 回傳 None
    g_neg, jpb_neg = compute_justified_pb(avg_roe_5y_pct=-2.0, avg_payout_ratio_pct=50.0, ke=0.08)
    assert g_neg is None and jpb_neg is None

    # 3. 測試 PUT / GET /api/v1/stock/{symbol}/regulatory-data 持久化與即時生效
    db_file = str(tmp_path / "fin_reg.db")
    cache = SqliteTTLCache(db_file)
    await cache.init()
    reg_store = RegulatoryOverrideStore(db_file)
    await reg_store.init()
    settings = Settings(finmind_api_token="test", finmind_tier="free", cache_db_path=db_file)

    with respx.mock(assert_all_called=False) as mock:
        mock.get(FINMIND_V4_URL).mock(
            return_value=httpx.Response(
                200,
                json={
                    "msg": "success",
                    "status": 200,
                    "data": [
                        {
                            "date": "2026-11-19",
                            "stock_id": "2886",
                            "stock_name": "兆豐金",
                            "industry_category": "金融保險業",
                            "type": "twse",
                            "open": 40.0,
                            "max": 40.5,
                            "min": 39.8,
                            "close": 40.2,
                            "Trading_Volume": 20000000,
                            "Trading_money": 804000000,
                        }
                    ],
                },
            )
        )
        mock.get(TWSE_COMPANY_INFO_URL).mock(
            return_value=httpx.Response(
                200,
                json=[{"公司代號": "2886", "公司簡稱": "兆豐金", "產業別": "金融保險業"}],
            )
        )
        mock.get(TPEX_COMPANY_INFO_URL).mock(return_value=httpx.Response(200, json=[]))
        mock.get(TWSE_VALUATION_URL).mock(
            return_value=httpx.Response(
                200,
                json=[{"Code": "2886", "PEratio": "12.2", "PBratio": "1.15", "DividendYield": "5.1"}],
            )
        )
        mock.get(TPEX_DAILY_QUOTES_URL).mock(return_value=httpx.Response(200, json=[]))
        mock.get(TWSE_DIRECTOR_PLEDGE_URL).mock(return_value=httpx.Response(200, json=[]))
        mock.get(TWSE_PUNISH_URL).mock(return_value=httpx.Response(200, json={"data": []}))

        async with httpx.AsyncClient(trust_env=False) as http_client:
            limiter = SlidingWindowRateLimiter(500)
            fm = FinMindClient(token="test", cache=cache, rate_limiter=limiter, http_client=http_client)
            tw = TwseTpexClient(cache=cache, snapshot_ttl_seconds=86400, http_client=http_client)
            agg = TwStockAggregator(
                settings=settings,
                cache=cache,
                finmind=fm,
                twse_tpex=tw,
                regulatory_store=reg_store,
            )

            test_app = FastAPI()
            test_app.state.aggregator = agg
            test_app.include_router(router)

            transport = httpx.ASGITransport(app=test_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as api_client:
                # 尚未填寫監理資料前，必須回傳 None 且列入 manualVerificationRequired
                r1 = await api_client.get("/api/v1/stock/2886")
                assert r1.status_code == 200
                body1 = r1.json()
                assert body1["recommendedProfile"] == "financial_bank"
                assert body1["financialMetrics"]["fhcCarPct"] is None
                assert any("fhcCarPct" in m for m in body1["dataQuality"]["manualVerificationRequired"])

                # PUT 儲存 MOPS 監理數據
                put_resp = await api_client.put(
                    "/api/v1/stock/2886/regulatory-data",
                    json={
                        "asOfQuarter": "2026Q3",
                        "isDsib": True,
                        "fhcCarPct": 128.5,
                        "bankBisPct": 15.2,
                        "bankCet1Pct": 11.8,
                        "doubleLeverageRatioPct": 111.0,
                        "nplRatioPct": 0.14,
                        "nplConsecutiveRiseQuarters": 0,
                        "nplCoverageRatioPct": 880.0,
                        "ociRestrictsDividend": False,
                        "recentDilutiveOfferingPct": 0.0,
                    },
                )
                assert put_resp.status_code == 200
                assert put_resp.json()["fhcCarPct"] == 128.5

                # GET 單獨讀取監理端點
                get_reg = await api_client.get("/api/v1/stock/2886/regulatory-data")
                assert get_reg.status_code == 200
                assert get_reg.json()["bankCet1Pct"] == 11.8

                # 再次讀取 /stock/2886（即使快取命中也必須即時合併最新監理欄位）
                r2 = await api_client.get("/api/v1/stock/2886")
                body2 = r2.json()
                assert body2["financialMetrics"]["fhcCarPct"] == 128.5
                assert body2["financialMetrics"]["nplCoverageRatioPct"] == 880.0
                assert not any("fhcCarPct" in m for m in body2["dataQuality"]["manualVerificationRequired"])


