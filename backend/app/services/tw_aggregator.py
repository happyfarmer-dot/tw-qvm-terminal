from __future__ import annotations

import asyncio
import datetime as dt
from typing import Any, Optional

from app.calculators.adj_price import (
    compute_free_adjusted_prices,
    normalize_backer_adjusted_prices,
)
from app.calculators.cyclical_metrics import (
    compute_cyclical_metrics,
    recommend_valuation_profile,
)
from app.calculators.financial_ratios import compute_all_financial_ratios
from app.calculators.financial_sector_metrics import (
    MOPS_REGULATORY_HINT,
    compute_financial_sector_metrics,
)
from app.calculators.regime_detector import detect_taiex_regime
from app.calculators.technical_metrics import compute_technical_metrics
from app.config import Settings
from app.core.cache import SqliteTTLCache
from app.core.regulatory_store import RegulatoryOverrideStore
from app.providers.finmind_client import FinMindClient
from app.providers.twse_tpex_client import TwseTpexClient
from app.schemas.qvm_models import (
    BatchStockError,
    BatchStockResponse,
    CyclicalMetricsModel,
    DataQualityModel,
    FinancialRatiosModel,
    FinancialSectorMetricsModel,
    PiotroskiChecksModel,
    RegimeResponse,
    RegulatoryOverridePayload,
    RegulatoryOverrideRecord,
    StageZeroMetricsModel,
    TwStockSnapshot,
)


NON_MFG_KEYWORDS = (
    "貿易",
    "百貨",
    "資訊服務",
    "數位雲端",
    "軟體",
    "文化創意",
    "觀光",
    "餐旅",
    "電信",
    "通信網路",
    "航運",
    "金融",
    "生技醫療",
)


class TwStockAggregator:
    def __init__(
        self,
        *,
        settings: Settings,
        cache: SqliteTTLCache,
        finmind: FinMindClient,
        twse_tpex: TwseTpexClient,
        regulatory_store: Optional[RegulatoryOverrideStore] = None,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.finmind = finmind
        self.twse_tpex = twse_tpex
        self.regulatory_store = regulatory_store or RegulatoryOverrideStore(
            settings.cache_db_path
        )

    async def get_regulatory_data(self, symbol: str) -> RegulatoryOverrideRecord:
        return await self.regulatory_store.get(symbol)

    async def save_regulatory_data(
        self, symbol: str, payload: RegulatoryOverridePayload
    ) -> RegulatoryOverrideRecord:
        return await self.regulatory_store.upsert(symbol, payload)

    @staticmethod
    def _merge_regulatory_into_snapshot(
        snap: TwStockSnapshot, reg: RegulatoryOverrideRecord
    ) -> TwStockSnapshot:
        if snap.financialMetrics is None:
            return snap
        fm = snap.financialMetrics.model_copy(
            update={
                "asOfQuarter": reg.asOfQuarter,
                "isDsib": reg.isDsib,
                "fhcCarPct": reg.fhcCarPct,
                "bankBisPct": reg.bankBisPct,
                "bankCet1Pct": reg.bankCet1Pct,
                "doubleLeverageRatioPct": reg.doubleLeverageRatioPct,
                "nplRatioPct": reg.nplRatioPct,
                "nplConsecutiveRiseQuarters": reg.nplConsecutiveRiseQuarters,
                "nplCoverageRatioPct": reg.nplCoverageRatioPct,
                "lifeSolvencyRatioPct": reg.lifeSolvencyRatioPct,
                "lifeSolvencyRegime": reg.lifeSolvencyRegime,
                "ociRestrictsDividend": reg.ociRestrictsDividend,
                "recentDilutiveOfferingPct": reg.recentDilutiveOfferingPct,
            }
        )
        # 更新 manualVerificationRequired，移除已由使用者填入的監理欄位
        reg_map = {
            "fhcCarPct": ("金控集團資本適足率 (CAR %)", reg.fhcCarPct),
            "bankBisPct": ("銀行總資本適足率 (BIS %)", reg.bankBisPct),
            "bankCet1Pct": ("銀行普通股權益第一類資本比率 (CET1 %)", reg.bankCet1Pct),
            "doubleLeverageRatioPct": ("金控雙重槓桿比 (DLR %)", reg.doubleLeverageRatioPct),
            "nplRatioPct": ("銀行逾放比 (NPL %)", reg.nplRatioPct),
            "nplCoverageRatioPct": ("銀行備抵呆帳覆蓋率 (%)", reg.nplCoverageRatioPct),
            "lifeSolvencyRatioPct": ("壽險子公司清償比率 (RBC / TW-ICS %)", reg.lifeSolvencyRatioPct),
        }
        reg_prefixes = tuple(reg_map.keys())
        cleaned_manual = [
            item
            for item in snap.dataQuality.manualVerificationRequired
            if not item.startswith(reg_prefixes)
        ]
        for key, (label, val) in reg_map.items():
            if key == "lifeSolvencyRatioPct" and snap.recommendedProfile != "financial_life_fhc":
                continue
            if val is None:
                cleaned_manual.append(f"{key}（{label} — {MOPS_REGULATORY_HINT}）")

        dq = snap.dataQuality.model_copy(update={"manualVerificationRequired": cleaned_manual})
        return snap.model_copy(update={"financialMetrics": fm, "dataQuality": dq})

    async def get_regime(self, force_refresh: bool = False) -> RegimeResponse:
        cache_key = "regime:TAIEX"
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached is not None:
                return RegimeResponse(**cached, fromCache=True)

        start_date = (dt.date.today() - dt.timedelta(days=420)).strftime("%Y-%m-%d")
        rows, _ = await self.finmind.fetch_dataset(
            "TaiwanStockPrice",
            data_id="TAIEX",
            start_date=start_date,
            ttl_seconds=self.settings.cache_ttl_price_seconds,
            force_refresh=force_refresh,
            category="regime",
        )
        result = detect_taiex_regime(rows)
        await self.cache.set(
            cache_key,
            result,
            min(self.settings.cache_ttl_price_seconds, 21_600),
            symbol="TAIEX",
            category="regime",
        )
        return RegimeResponse(**result, fromCache=False)

    async def get_stock_snapshot(
        self, symbol: str, force_refresh: bool = False
    ) -> TwStockSnapshot:
        sym = symbol.strip().upper()
        agg_cache_key = f"snapshot:stock:v3:{sym}"
        reg_override = await self.regulatory_store.get(sym)

        if not force_refresh:
            cached = await self.cache.get(agg_cache_key)
            if cached is not None:
                snap = TwStockSnapshot(**cached)
                snap.dataQuality.fromCache = True
                return self._merge_regulatory_into_snapshot(snap, reg_override)

        today = dt.date.today()
        lookback_7y = (today - dt.timedelta(days=2600)).strftime("%Y-%m-%d")
        rev_start = (today - dt.timedelta(days=800)).strftime("%Y-%m-%d")
        div_start = (today - dt.timedelta(days=2600)).strftime("%Y-%m-%d")

        # 1. 基本資料 + TWSE/TPEx 官方快照
        info_rows, _ = await self.finmind.fetch_dataset(
            "TaiwanStockInfo",
            data_id=sym,
            ttl_seconds=self.settings.cache_ttl_market_snapshot_seconds,
            force_refresh=force_refresh,
            category="info",
        )
        latest_info = self.finmind.pick_latest_stock_info(info_rows)
        official_snap = await self.twse_tpex.get_twse_tpex_snapshot(
            sym, force_refresh=force_refresh
        )

        name = official_snap.get("name") or (
            latest_info.get("stock_name") if latest_info else None
        ) or sym
        sector = official_snap.get("sector") or (
            latest_info.get("industry_category") if latest_info else None
        ) or "未分類"
        market_type_raw = (
            (latest_info.get("type") if latest_info else None)
            or official_snap.get("marketType")
            or "twse"
        )
        market_type: str = "tpex" if str(market_type_raw).lower() == "tpex" else "twse"
        recommended_profile = recommend_valuation_profile(sector, sym, name)
        is_financial = recommended_profile in ("financial_bank", "financial_life_fhc")

        # 2. 股價與除權息還原 (7 年序列)
        price_warnings: list[str] = []
        if self.settings.finmind_tier == "backer":
            raw_adj_rows, _ = await self.finmind.fetch_dataset(
                "TaiwanStockPriceAdj",
                data_id=sym,
                start_date=lookback_7y,
                ttl_seconds=self.settings.cache_ttl_price_seconds,
                force_refresh=force_refresh,
                category="price",
            )
            price_df = normalize_backer_adjusted_prices(raw_adj_rows)
        else:
            raw_price_rows, _ = await self.finmind.fetch_dataset(
                "TaiwanStockPrice",
                data_id=sym,
                start_date=lookback_7y,
                ttl_seconds=self.settings.cache_ttl_price_seconds,
                force_refresh=force_refresh,
                category="price",
            )
            div_res_rows, _ = await self.finmind.fetch_dataset(
                "TaiwanStockDividendResult",
                data_id=sym,
                start_date=lookback_7y,
                ttl_seconds=self.settings.cache_ttl_price_seconds,
                force_refresh=force_refresh,
                category="dividend_result",
            )
            price_df, price_warnings = compute_free_adjusted_prices(
                raw_price_rows, div_res_rows
            )

        tech = compute_technical_metrics(price_df)

        # 3. 七年財報、月營收與股利政策
        income_rows, _ = await self.finmind.fetch_dataset(
            "TaiwanStockFinancialStatements",
            data_id=sym,
            start_date=lookback_7y,
            ttl_seconds=self.settings.cache_ttl_financial_seconds,
            force_refresh=force_refresh,
            category="financial",
        )
        balance_rows, _ = await self.finmind.fetch_dataset(
            "TaiwanStockBalanceSheet",
            data_id=sym,
            start_date=lookback_7y,
            ttl_seconds=self.settings.cache_ttl_financial_seconds,
            force_refresh=force_refresh,
            category="financial",
        )
        cashflow_rows, _ = await self.finmind.fetch_dataset(
            "TaiwanStockCashFlowsStatement",
            data_id=sym,
            start_date=lookback_7y,
            ttl_seconds=self.settings.cache_ttl_financial_seconds,
            force_refresh=force_refresh,
            category="financial",
        )
        revenue_rows, _ = await self.finmind.fetch_dataset(
            "TaiwanStockMonthRevenue",
            data_id=sym,
            start_date=rev_start,
            ttl_seconds=self.settings.cache_ttl_price_seconds,
            force_refresh=force_refresh,
            category="revenue",
        )
        dividend_rows, _ = await self.finmind.fetch_dataset(
            "TaiwanStockDividend",
            data_id=sym,
            start_date=div_start,
            ttl_seconds=self.settings.cache_ttl_financial_seconds,
            force_refresh=force_refresh,
            category="dividend",
        )

        fin = compute_all_financial_ratios(
            income_rows=income_rows,
            balance_rows=balance_rows,
            cashflow_rows=cashflow_rows,
            revenue_rows=revenue_rows,
            dividend_rows=dividend_rows,
            latest_price=tech["price"],
        )

        cyc = compute_cyclical_metrics(
            price_df=price_df,
            income_rows=income_rows,
            balance_rows=balance_rows,
            cashflow_rows=cashflow_rows,
            latest_price=tech["price"],
            ma200=tech["ma200"],
            trailing_pb_override=official_snap.get("pbRatio"),
        )

        financial_metrics_model: Optional[FinancialSectorMetricsModel] = None
        fin_manual_verify: list[str] = []
        fin_warnings: list[str] = []
        if is_financial:
            fin_sec_dict, fin_manual_verify, fin_warnings = compute_financial_sector_metrics(
                profile=recommended_profile,  # type: ignore[arg-type]
                price_df=price_df,
                income_rows=income_rows,
                balance_rows=balance_rows,
                cashflow_rows=cashflow_rows,
                revenue_rows=revenue_rows,
                dividend_rows=dividend_rows,
                latest_price=tech["price"],
                ma200=tech["ma200"],
                tech=tech,
                official_snap=official_snap,
                fin_ratios=fin,
                reg_override=reg_override,
            )
            financial_metrics_model = FinancialSectorMetricsModel(**fin_sec_dict)

        is_mfg = not any(kw in sector for kw in NON_MFG_KEYWORDS)

        stage_zero_metrics = StageZeroMetricsModel(
            isManufacturing=is_mfg,
            beneishMScore=fin["beneishMScore"],
            altmanZScore=fin["altmanZScore"],
            altmanZDoublePrime=fin["altmanZDoublePrime"],
            cumulative3yOCF=fin["cumulative3yOCF"],
            cumulative5yOCF=fin["cumulative5yOCF"],
            latestCurrentRatio=fin["latestCurrentRatio"],
            latestNetDebtToEquityPct=fin["latestNetDebtToEquityPct"],
            hasAuditOrGovernanceRedFlag=None,
            isFullCashDeliveryOrSuspended=None,
            directorPledgeRatio=official_snap.get("directorPledgeRatio"),
            directorInsufficientHoldingMonths=None,
            avgDailyTurnover20dTWD=tech["avgDailyTurnover20dTWD"],
            price=tech["price"],
            isDispositionStock=official_snap.get("isDispositionStock"),
            shareDilution3yPct=fin["shareDilution3yPct"],
            isRoicDeclining=fin["isRoicDeclining"],
            consecutive2qArOrInvBloat=fin["consecutive2qArOrInvBloat"],
        )

        ratios = FinancialRatiosModel(
            roic3yAvgPct=fin["roic3yAvgPct"],
            gpaPct=fin["gpaPct"],
            ocfToNi3yPct=fin["ocfToNi3yPct"],
            piotroskiRaw=fin["piotroskiRaw"],
            piotroskiChecks=PiotroskiChecksModel(**fin["piotroskiChecks"]),
            evToEbitda=fin["evToEbitda"],
            evToEbit=fin["evToEbit"],
            fcfYieldPct=fin["fcfYieldPct"],
            trailingPe=official_snap.get("trailingPe"),
            forwardPe=None,
            pbRatio=official_snap.get("pbRatio") or cyc["currentPB"],
            dividendYieldPct=official_snap.get("dividendYieldPct"),
            consecutive5yDividend=fin["consecutive5yDividend"],
            nonDebtFundedDividend=fin["nonDebtFundedDividend"],
            mom12m1mSharpe=tech["mom12m1mSharpe"],
            rev3mCumYoYPct=fin["rev3mCumYoYPct"],
            rev12mCumYoYPct=fin["rev12mCumYoYPct"],
            trendVsMa200Pct=tech["trendVsMa200Pct"],
            trendVsMa120Pct=tech["trendVsMa120Pct"],
        )

        cyclical_model = CyclicalMetricsModel(**cyc)

        missing_fields: list[str] = []
        manual_verify: list[str] = [
            "hasAuditOrGovernanceRedFlag（會計師查核意見／非換屆無故更換事務所）",
            "isFullCashDeliveryOrSuspended（是否列為全額交割或停止買賣）",
            "directorInsufficientHoldingMonths（董監持股連續不足月數）",
        ]
        if not is_financial:
            manual_verify.append(
                "免費版 FinMind 僅提供總存貨，未區分原物料／在製品／製成品結構，請至 MOPS 附註確認存貨增加係備料或滯銷"
            )
            if cyc["contractLiabilitiesToRev"] is None:
                missing_fields.append("contractLiabilities")
                manual_verify.append(
                    "公開財報未檢出合約負債欄位，半導體設備股請至 MOPS 財報附註確認預收款項與訂單能見度"
                )
        else:
            manual_verify.extend(fin_manual_verify)

        warnings = list(price_warnings) + list(fin_warnings)

        if "航運" in sector or "航運" in name:
            manual_verify.append("請同步核對 SCFI／BDI 運價指數與全球新船訂單運力比")

        if cyc["historyYearsAvailable"] < 5:
            warnings.append("歷史未滿完整景氣循環（< 5 年），P/B 位階與常態化估值可信度較低。")

        if cyc["capitalReductionSuspected"]:
            warnings.append("偵測到股本縮減，請人工確認現金減資對歷史 P/B 位階之影響。")

        if ratios.forwardPe is None and not is_financial:
            missing_fields.append("forwardPe")
            warnings.append("免費公開 API 無券商預估 Forward P/E，請參考 Trailing P/E 或人工填入預估 EPS。")

        check_map: list[tuple[str, Optional[Any]]] = [
            ("price", tech["price"]),
            ("avgDailyTurnover20dTWD", tech["avgDailyTurnover20dTWD"]),
            ("annualizedVol60dPct", tech["annualizedVol60dPct"]),
            ("ma200", tech["ma200"]),
            ("directorPledgeRatio", official_snap.get("directorPledgeRatio")),
            ("isDispositionStock", official_snap.get("isDispositionStock")),
            ("trailingPe", official_snap.get("trailingPe")),
            ("rev3mCumYoYPct", fin["rev3mCumYoYPct"]),
            ("pbPercentile5to7Y", cyc["pbPercentile5to7Y"]),
        ]
        if not is_financial:
            check_map.extend(
                [
                    ("beneishMScore", fin["beneishMScore"]),
                    ("altmanZScore" if is_mfg else "altmanZDoublePrime", fin["altmanZScore"] if is_mfg else fin["altmanZDoublePrime"]),
                    ("cumulative3yOCF", fin["cumulative3yOCF"]),
                    ("roic3yAvgPct", fin["roic3yAvgPct"]),
                    ("gpaPct", fin["gpaPct"]),
                    ("ocfToNi3yPct", fin["ocfToNi3yPct"]),
                    ("piotroskiRaw", fin["piotroskiRaw"]),
                    ("evToEbitda", fin["evToEbitda"]),
                    ("fcfYieldPct", fin["fcfYieldPct"]),
                    ("normalizedEvToEbit", cyc["normalizedEvToEbit"]),
                    ("latestDio", cyc["latestDio"]),
                ]
            )
        elif financial_metrics_model is not None:
            check_map.extend(
                [
                    ("avgRoe5Y", financial_metrics_model.avgRoe5Y),
                    ("justifiedPB", financial_metrics_model.justifiedPB),
                    ("fhcCarPct", financial_metrics_model.fhcCarPct),
                    ("bankCet1Pct", financial_metrics_model.bankCet1Pct),
                    ("doubleLeverageRatioPct", financial_metrics_model.doubleLeverageRatioPct),
                    ("nplRatioPct", financial_metrics_model.nplRatioPct),
                    ("nplCoverageRatioPct", financial_metrics_model.nplCoverageRatioPct),
                ]
            )

        non_null_count = 0
        for field_name, val in check_map:
            if val is None:
                missing_fields.append(field_name)
                if field_name in ("directorPledgeRatio", "isDispositionStock"):
                    manual_verify.append(
                        f"{field_name}（{'上櫃' if market_type == 'tpex' else '公開'}結構化端點缺失，請於公開資訊觀測站核對）"
                    )
            else:
                non_null_count += 1

        completeness_pct = round((non_null_count / len(check_map)) * 100.0, 1)

        snapshot = TwStockSnapshot(
            symbol=sym,
            name=name,
            marketType=market_type,  # type: ignore[arg-type]
            sector=sector,
            recommendedProfile=recommended_profile,
            price=tech["price"],
            avgDailyTurnover20dTWD=tech["avgDailyTurnover20dTWD"],
            annualizedVol60dPct=tech["annualizedVol60dPct"],
            annualizedVol120dPct=tech["annualizedVol120dPct"],
            atr20=tech["atr20"],
            ma50=tech["ma50"],
            ma120=tech["ma120"],
            ma200=tech["ma200"],
            daysBelow200Ma=tech["daysBelow200Ma"],
            stageZeroMetrics=stage_zero_metrics,
            ratios=ratios,
            cyclicalMetrics=cyclical_model,
            financialMetrics=financial_metrics_model,
            dataQuality=DataQualityModel(
                completenessPct=completeness_pct,
                missingFields=missing_fields,
                manualVerificationRequired=manual_verify,
                warnings=warnings,
                fromCache=False,
                fetchedAt=dt.datetime.now(dt.timezone.utc).isoformat(),
            ),
        )

        await self.cache.set(
            agg_cache_key,
            snapshot.model_dump(),
            min(self.settings.cache_ttl_price_seconds, 43_200),
            symbol=sym,
            category="stock_snapshot",
        )
        return snapshot

    async def get_batch_snapshots(
        self, symbols: list[str], force_refresh: bool = False
    ) -> BatchStockResponse:
        sem = asyncio.Semaphore(2)
        results: list[TwStockSnapshot] = []
        errors: list[BatchStockError] = []

        async def fetch_one(raw_sym: str) -> None:
            sym = raw_sym.strip().upper()
            if not sym:
                return
            async with sem:
                try:
                    snap = await self.get_stock_snapshot(sym, force_refresh=force_refresh)
                    results.append(snap)
                except Exception as exc:
                    errors.append(BatchStockError(symbol=sym, error=str(exc)))

        await asyncio.gather(*(fetch_one(s) for s in symbols))
        return BatchStockResponse(results=results, errors=errors)
