from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
from pathlib import Path
from typing import Any, Optional

from pipeline.cache_manager import PipelineCacheManager
from pipeline.calculators.adj_price import compute_free_adjusted_prices
from pipeline.calculators.cyclical_metrics import (
    compute_cyclical_metrics,
    recommend_valuation_profile,
)
from pipeline.calculators.financial_ratios import compute_all_financial_ratios
from pipeline.calculators.financial_sector_metrics import compute_financial_sector_metrics
from pipeline.calculators.regime_detector import detect_taiex_regime
from pipeline.calculators.technical_metrics import compute_technical_metrics
from pipeline.providers.finmind_client import FinMindClient, FinMindQuotaExceededError
from pipeline.providers.twse_tpex_client import TwseTpexClient
from pipeline.schemas import (
    CyclicalMetricsModel,
    DataQualityModel,
    FinancialRatiosModel,
    FinancialSectorMetricsModel,
    ManifestModel,
    PipelineStatsModel,
    PiotroskiChecksModel,
    RegimeModel,
    RegulatoryOverrideRecord,
    StageZeroMetricsModel,
    StocksBundleModel,
    TwStockSnapshot,
)


TAIPEI_TZ = dt.timezone(dt.timedelta(hours=8))

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


def load_watchlist(watchlist_path: Path, target_symbols_env: str = "") -> list[str]:
    symbols: list[str] = []
    if watchlist_path.exists():
        raw = json.loads(watchlist_path.read_text(encoding="utf-8"))
        raw_syms = raw.get("symbols", []) if isinstance(raw, dict) else []
        for s in raw_syms:
            clean = str(s).strip().upper()
            if clean and clean not in symbols:
                symbols.append(clean)

    if target_symbols_env.strip():
        priority: list[str] = []
        for part in target_symbols_env.replace(" ", ",").split(","):
            clean = part.strip().upper()
            if clean and clean not in priority:
                priority.append(clean)
        # 將手動指定的 target_symbols 置於最優先佇列
        merged = priority + [s for s in symbols if s not in priority]
        return merged
    return symbols


def build_stock_snapshot(
    *,
    sym: str,
    info_rows: list[dict[str, Any]],
    price_rows: list[dict[str, Any]],
    div_res_rows: list[dict[str, Any]],
    income_rows: list[dict[str, Any]],
    balance_rows: list[dict[str, Any]],
    cashflow_rows: list[dict[str, Any]],
    revenue_rows: list[dict[str, Any]],
    dividend_rows: list[dict[str, Any]],
    official_snap: dict[str, Any],
    from_cache: bool,
    taipei_now_iso: str,
) -> TwStockSnapshot:
    latest_info = FinMindClient.pick_latest_stock_info(info_rows)
    name = (
        official_snap.get("name")
        or (latest_info.get("stock_name") if latest_info else None)
        or sym
    )
    sector = (
        official_snap.get("sector")
        or (latest_info.get("industry_category") if latest_info else None)
        or "未分類"
    )
    market_type_raw = (
        (latest_info.get("type") if latest_info else None)
        or official_snap.get("marketType")
        or "twse"
    )
    market_type: str = "tpex" if str(market_type_raw).lower() == "tpex" else "twse"
    recommended_profile = recommend_valuation_profile(sector, sym, name)
    is_financial = recommended_profile in ("financial_bank", "financial_life_fhc")

    price_df, price_warnings = compute_free_adjusted_prices(price_rows, div_res_rows)
    tech = compute_technical_metrics(price_df)

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
        empty_reg = RegulatoryOverrideRecord(symbol=sym)
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
            reg_override=empty_reg,
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
                (
                    "altmanZScore" if is_mfg else "altmanZDoublePrime",
                    fin["altmanZScore"] if is_mfg else fin["altmanZDoublePrime"],
                ),
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

    return TwStockSnapshot(
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
            fromCache=from_cache,
            fetchedAt=taipei_now_iso,
        ),
    )


async def run_pipeline(
    *,
    root_dir: Path,
    finmind_token: str = "",
    max_finmind_stocks: int = 65,
    target_symbols_env: str = "",
    force_refresh: bool = False,
    finmind_client: Optional[FinMindClient] = None,
    twse_client: Optional[TwseTpexClient] = None,
) -> tuple[ManifestModel, StocksBundleModel]:
    pipeline_dir = root_dir / "pipeline"
    cache_dir = pipeline_dir / "cache"
    output_dir = root_dir / "frontend" / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    watchlist = load_watchlist(pipeline_dir / "watchlist.json", target_symbols_env)
    cache_mgr = PipelineCacheManager(cache_dir)
    finmind = finmind_client or FinMindClient(token=finmind_token, min_interval_seconds=1.2)
    twse_tpex = twse_client or TwseTpexClient()

    taipei_now = dt.datetime.now(TAIPEI_TZ)
    taipei_today = taipei_now.date()
    taipei_now_str = taipei_now.strftime("%Y-%m-%d %H:%M")
    taipei_now_iso = taipei_now.isoformat()
    utc_now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    lookback_7y = (taipei_today - dt.timedelta(days=2600)).strftime("%Y-%m-%d")
    rev_start = (taipei_today - dt.timedelta(days=800)).strftime("%Y-%m-%d")
    taiex_start = (taipei_today - dt.timedelta(days=420)).strftime("%Y-%m-%d")

    # 1. 檢查 FinMind 額度
    quota_info = await finmind.check_user_info()
    quota_remaining = quota_info.get("remaining")
    quota_limit = quota_info.get("limit")
    quota_exhausted = quota_remaining is not None and quota_remaining < 10

    # 2. 預抓 TWSE / TPEx 全市場零額度快照
    await twse_tpex.prefetch_market_snapshots()

    # 3. 計算 TAIEX 大盤體制
    regime_data = RegimeModel(
        regime="NORMAL",
        indexSymbol="TAIEX",
        reasons=["尚未取得 TAIEX 歷史序列，暫以常態體制顯示。"],
    )
    if not quota_exhausted:
        try:
            taiex_rows = await finmind.fetch_dataset(
                "TaiwanStockPrice",
                data_id="TAIEX",
                start_date=taiex_start,
            )
            detected = detect_taiex_regime(taiex_rows)
            regime_data = RegimeModel(**detected)
        except FinMindQuotaExceededError:
            quota_exhausted = True
        except Exception as exc:
            regime_data.reasons = [f"TAIEX 體制抓取異常：{exc}"]

    # 4. 逐檔處理追蹤清單
    snapshots: list[TwStockSnapshot] = []
    failed_symbols: list[dict[str, str]] = []
    finmind_stocks_used = 0
    cache_hits = 0
    skipped_due_to_quota = 0

    for sym in watchlist:
        cached = cache_mgr.load_symbol_cache(sym)
        need_price = cache_mgr.needs_price_backfill(cached, force_refresh=force_refresh)
        need_fin = cache_mgr.needs_financial_refresh(
            cached, taipei_today, force_refresh=force_refresh
        )
        need_rev = cache_mgr.needs_revenue_refresh(
            cached, taipei_today, force_refresh=force_refresh
        )
        needs_any_finmind = need_price or need_fin or need_rev

        can_call_finmind = (
            not quota_exhausted
            and finmind_stocks_used < max_finmind_stocks
            and (quota_remaining is None or (quota_remaining - finmind.request_count) >= 8)
        )

        used_finmind_for_sym = False
        try:
            data = dict(cached) if cached else {}

            if needs_any_finmind and can_call_finmind:
                used_finmind_for_sym = True
                finmind_stocks_used += 1

                if not data.get("info_rows") or force_refresh:
                    data["info_rows"] = await finmind.fetch_dataset(
                        "TaiwanStockInfo", data_id=sym
                    )

                if need_price:
                    data["price_rows"] = await finmind.fetch_dataset(
                        "TaiwanStockPrice", data_id=sym, start_date=lookback_7y
                    )
                    data["div_res_rows"] = await finmind.fetch_dataset(
                        "TaiwanStockDividendResult", data_id=sym, start_date=lookback_7y
                    )
                    data["last_price_sync"] = taipei_today.isoformat()

                if need_fin:
                    data["income_rows"] = await finmind.fetch_dataset(
                        "TaiwanStockFinancialStatements", data_id=sym, start_date=lookback_7y
                    )
                    data["balance_rows"] = await finmind.fetch_dataset(
                        "TaiwanStockBalanceSheet", data_id=sym, start_date=lookback_7y
                    )
                    data["cashflow_rows"] = await finmind.fetch_dataset(
                        "TaiwanStockCashFlowsStatement", data_id=sym, start_date=lookback_7y
                    )
                    data["dividend_rows"] = await finmind.fetch_dataset(
                        "TaiwanStockDividend", data_id=sym, start_date=lookback_7y
                    )
                    data["last_financial_sync"] = taipei_today.isoformat()

                if need_rev:
                    data["revenue_rows"] = await finmind.fetch_dataset(
                        "TaiwanStockMonthRevenue", data_id=sym, start_date=rev_start
                    )
                    data["last_revenue_sync"] = taipei_today.isoformat()

            elif needs_any_finmind and cached is None:
                # 尚未入庫且額度/上限已達，跳過待下次執行
                skipped_due_to_quota += 1
                continue
            else:
                cache_hits += 1

            # 無論是否呼叫 FinMind，皆以 TWSE/TPEx 零額度快照追加最新日線收盤價
            official_snap = twse_tpex.get_snapshot(sym)
            merged_price_rows = cache_mgr.append_daily_quote(
                list(data.get("price_rows") or []),
                official_snap.get("dailyQuote"),
                sym,
            )
            data["price_rows"] = merged_price_rows

            cache_mgr.save_symbol_cache(sym, data)

            snap = build_stock_snapshot(
                sym=sym,
                info_rows=list(data.get("info_rows") or []),
                price_rows=merged_price_rows,
                div_res_rows=list(data.get("div_res_rows") or []),
                income_rows=list(data.get("income_rows") or []),
                balance_rows=list(data.get("balance_rows") or []),
                cashflow_rows=list(data.get("cashflow_rows") or []),
                revenue_rows=list(data.get("revenue_rows") or []),
                dividend_rows=list(data.get("dividend_rows") or []),
                official_snap=official_snap,
                from_cache=not used_finmind_for_sym,
                taipei_now_iso=taipei_now_iso,
            )
            snapshots.append(snap)

        except FinMindQuotaExceededError:
            quota_exhausted = True
            skipped_due_to_quota += 1
            # 若已有快取資料，仍可產出快照
            if cached and cached.get("price_rows"):
                official_snap = twse_tpex.get_snapshot(sym)
                snap = build_stock_snapshot(
                    sym=sym,
                    info_rows=list(cached.get("info_rows") or []),
                    price_rows=cache_mgr.append_daily_quote(
                        list(cached.get("price_rows") or []),
                        official_snap.get("dailyQuote"),
                        sym,
                    ),
                    div_res_rows=list(cached.get("div_res_rows") or []),
                    income_rows=list(cached.get("income_rows") or []),
                    balance_rows=list(cached.get("balance_rows") or []),
                    cashflow_rows=list(cached.get("cashflow_rows") or []),
                    revenue_rows=list(cached.get("revenue_rows") or []),
                    dividend_rows=list(cached.get("dividend_rows") or []),
                    official_snap=official_snap,
                    from_cache=True,
                    taipei_now_iso=taipei_now_iso,
                )
                snapshots.append(snap)
        except Exception as exc:
            failed_symbols.append({"symbol": sym, "error": str(exc)})

    status_val: str = "ready"
    if not snapshots:
        status_val = "awaiting_first_run"
    elif skipped_due_to_quota > 0 or failed_symbols:
        status_val = "partial"

    manifest = ManifestModel(
        status=status_val,  # type: ignore[arg-type]
        updatedAtTaipei=taipei_now_str,
        updatedAtUtc=utc_now_iso,
        regime=regime_data,
        stats=PipelineStatsModel(
            totalWatchlist=len(watchlist),
            successCount=len(snapshots),
            failedCount=len(failed_symbols),
            skippedDueToQuota=skipped_due_to_quota,
            cacheHits=cache_hits,
            finmindFetched=finmind_stocks_used,
            failedSymbols=failed_symbols,
            finmindQuotaRemaining=(
                max(0, quota_remaining - finmind.request_count)
                if quota_remaining is not None
                else None
            ),
            finmindQuotaLimit=quota_limit,
        ),
    )

    bundle = StocksBundleModel(
        updatedAtTaipei=taipei_now_str,
        stocks=snapshots,
    )

    (output_dir / "manifest.json").write_text(
        manifest.model_dump_json(indent=2), encoding="utf-8"
    )
    (output_dir / "stocks_bundle.json").write_text(
        bundle.model_dump_json(), encoding="utf-8"
    )
    return manifest, bundle


def main() -> None:
    root_dir = Path(__file__).resolve().parent.parent
    token = os.getenv("FINMIND_API_TOKEN", "")
    max_stocks = int(os.getenv("MAX_FINMIND_STOCKS_PER_RUN", "65"))
    target_symbols = os.getenv("TARGET_SYMBOLS", "")
    force_refresh = os.getenv("FORCE_REFRESH", "false").lower() in ("1", "true", "yes")

    manifest, _ = asyncio.run(
        run_pipeline(
            root_dir=root_dir,
            finmind_token=token,
            max_finmind_stocks=max_stocks,
            target_symbols_env=target_symbols,
            force_refresh=force_refresh,
        )
    )
    print(
        f"[TW-QVM Pipeline] 完成！狀態={manifest.status}, "
        f"成功={manifest.stats.successCount}/{manifest.stats.totalWatchlist}, "
        f"快取命中={manifest.stats.cacheHits}, "
        f"FinMind補抓={manifest.stats.finmindFetched}, "
        f"額度跳過={manifest.stats.skippedDueToQuota}, "
        f"更新時間={manifest.updatedAtTaipei} (Asia/Taipei)"
    )


if __name__ == "__main__":
    main()
