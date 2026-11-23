from __future__ import annotations

import datetime as dt
import re
from typing import Any, Optional

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential


TWSE_COMPANY_INFO_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
TWSE_STOCK_DAY_ALL_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TWSE_DIRECTOR_PLEDGE_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap11_L"
TWSE_MONTHLY_REV_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L"
TWSE_PUNISH_URL = "https://www.twse.com.tw/rwd/zh/announcement/punish?response=json"
TWSE_VALUATION_URL = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"

TPEX_COMPANY_INFO_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
TPEX_DAILY_QUOTES_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
TPEX_MONTHLY_REV_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"


def roc_to_iso(roc_str: Optional[str]) -> Optional[str]:
    """
    將民國年字串（如 '1150730'、'115/07/30'、'115.07.30'）精確轉換為 ISO '2026-07-30'。
    若格式不合法則回傳 None。
    """
    if not roc_str:
        return None
    s = str(roc_str).strip()
    digits = re.sub(r"\D", "", s)
    if len(digits) == 7:
        roc_year = int(digits[:3])
        month = int(digits[3:5])
        day = int(digits[5:7])
    elif len(digits) == 6:
        roc_year = int(digits[:2])
        month = int(digits[2:4])
        day = int(digits[4:6])
    else:
        return None

    year = roc_year + 1911
    if not (1912 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _to_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    s = str(val).replace(",", "").replace("%", "").strip()
    if s in ("", "-", "--", "N/A", "null", "None", "---"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _get_first_str(row: dict[str, Any], keys: list[str]) -> Optional[str]:
    for k in keys:
        if k in row and row[k] is not None:
            v = str(row[k]).strip()
            if v:
                return v
    return None


class TwseTpexClient:
    """
    零額度 TWSE / TPEx 官方 OpenAPI 全市場快照抓取器。
    每次執行管線只需呼叫一次 `prefetch_market_snapshots()` 即可取得全市場即時收盤、估值、董監設質與處置資訊。
    """

    def __init__(self, *, http_client: Optional[httpx.AsyncClient] = None) -> None:
        self._external_client = http_client
        self._twse_info: dict[str, dict[str, Any]] = {}
        self._tpex_info: dict[str, dict[str, Any]] = {}
        self._twse_day_all: dict[str, dict[str, Any]] = {}
        self._twse_val: dict[str, dict[str, Optional[float]]] = {}
        self._tpex_quotes: dict[str, dict[str, Any]] = {}
        self._twse_pledge: dict[str, dict[str, Optional[float]]] = {}
        self._twse_punish: set[str] = set()
        self._twse_rev: dict[str, dict[str, Optional[float]]] = {}
        self._tpex_rev: dict[str, dict[str, Optional[float]]] = {}
        self._twse_punish_loaded = False
        self._prefetched = False

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=3),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.TransportError)),
        reraise=True,
    )
    async def _fetch_json(self, url: str) -> Any:
        headers = {"User-Agent": "TW-QVM-Quant-Terminal/2.0"}
        if self._external_client is not None:
            resp = await self._external_client.get(url, headers=headers, timeout=25.0)
            resp.raise_for_status()
            return resp.json()
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()

    async def _safe_fetch(self, url: str) -> Any:
        try:
            return await self._fetch_json(url)
        except Exception:
            return None

    @staticmethod
    def normalize_director_pledge(
        rows: list[dict[str, Any]],
    ) -> dict[str, dict[str, Optional[float]]]:
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = _get_first_str(row, ["公司代號", "Code", "SecuritiesCompanyCode"])
            if sym:
                grouped.setdefault(sym, []).append(row)

        result: dict[str, dict[str, Optional[float]]] = {}
        for sym, items in grouped.items():
            total_held = 0.0
            total_pledged = 0.0
            max_single_ratio: Optional[float] = None
            has_valid = False

            for item in items:
                held = _to_float(
                    item.get("目前持股")
                    or item.get("選任時持股")
                    or item.get("CurrentShares")
                )
                pledged = _to_float(item.get("設質股數") or item.get("PledgedShares"))
                direct_ratio = _to_float(item.get("設質比率") or item.get("PledgeRatio"))

                if held is not None and held > 0:
                    has_valid = True
                    total_held += held
                    if pledged is not None and pledged >= 0:
                        total_pledged += pledged
                        single_pct = (pledged / held) * 100.0
                        if max_single_ratio is None or single_pct > max_single_ratio:
                            max_single_ratio = single_pct
                elif direct_ratio is not None:
                    has_valid = True
                    if max_single_ratio is None or direct_ratio > max_single_ratio:
                        max_single_ratio = direct_ratio

            total_ratio = (
                round((total_pledged / total_held) * 100.0, 2)
                if has_valid and total_held > 0
                else None
            )
            max_single = round(max_single_ratio, 2) if max_single_ratio is not None else None
            candidates = [x for x in (total_ratio, max_single) if x is not None]
            effective = max(candidates) if candidates else None

            result[sym] = {
                "totalPledgeRatioPct": total_ratio,
                "maxSingleDirectorPledgePct": max_single,
                "effectivePledgeRatioPct": effective,
            }
        return result

    @staticmethod
    def normalize_twse_punish(payload: Any) -> set[str]:
        punished: set[str] = set()
        if not isinstance(payload, dict):
            return punished
        rows = payload.get("data")
        if not isinstance(rows, list):
            return punished
        for row in rows:
            if isinstance(row, list):
                for cell in row:
                    s = str(cell).strip()
                    if re.fullmatch(r"\d{4,6}[A-Z]?", s):
                        punished.add(s)
                        break
            elif isinstance(row, dict):
                sym = _get_first_str(row, ["Code", "證券代號", "公司代號"])
                if sym:
                    punished.add(sym)
        return punished

    @staticmethod
    def normalize_company_info_list(
        rows: Any, market_type: str
    ) -> dict[str, dict[str, Any]]:
        if not isinstance(rows, list):
            return {}
        indexed: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = _get_first_str(row, ["公司代號", "SecuritiesCompanyCode", "Code"])
            if not sym:
                continue
            name = _get_first_str(row, ["公司簡稱", "公司名稱", "CompanyName", "Name"])
            sector = _get_first_str(row, ["產業別", "Industry", "產業類別"])
            indexed[sym] = {
                "symbol": sym,
                "name": name,
                "sector": sector,
                "marketType": market_type,
            }
        return indexed

    @staticmethod
    def normalize_twse_stock_day_all(rows: Any) -> dict[str, dict[str, Any]]:
        """解析 TWSE STOCK_DAY_ALL 每日全市場收盤行情（單位：股）。"""
        if not isinstance(rows, list):
            return {}
        indexed: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = _get_first_str(row, ["Code", "證券代號"])
            if not sym:
                continue
            close = _to_float(row.get("ClosingPrice"))
            if close is None or close <= 0:
                continue
            iso_date = roc_to_iso(_get_first_str(row, ["Date", "日期"]))
            indexed[sym] = {
                "date": iso_date,
                "open": _to_float(row.get("OpeningPrice")) or close,
                "high": _to_float(row.get("HighestPrice")) or close,
                "low": _to_float(row.get("LowestPrice")) or close,
                "close": close,
                "volume": _to_float(row.get("TradeVolume")) or 0.0,
                "trading_money": _to_float(row.get("TradeValue")) or 0.0,
            }
        return indexed

    @staticmethod
    def normalize_valuation_rows(rows: Any, market_type: str) -> dict[str, dict[str, Any]]:
        if not isinstance(rows, list):
            return {}
        indexed: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = _get_first_str(row, ["Code", "SecuritiesCompanyCode", "公司代號"])
            if not sym:
                continue
            pe = _to_float(row.get("PEratio") or row.get("本益比"))
            pb = _to_float(row.get("PBratio") or row.get("股價淨值比"))
            yld = _to_float(row.get("DividendYield") or row.get("殖利率(%)"))
            close = _to_float(row.get("Close") or row.get("收盤")) if market_type == "tpex" else None
            volume = _to_float(row.get("TradingShares") or row.get("成交股數")) if market_type == "tpex" else None
            trading_money = (
                _to_float(
                    row.get("TradingAmount")
                    or row.get("Turnover")
                    or row.get("成交金額(元)")
                    or row.get("成交金額")
                )
                if market_type == "tpex"
                else None
            )
            if trading_money is None and close is not None and volume is not None and close > 0 and volume > 0:
                trading_money = round(close * volume, 2)
            iso_date = roc_to_iso(_get_first_str(row, ["Date", "資料日期"])) if market_type == "tpex" else None
            indexed[sym] = {
                "pe": pe,
                "pb": pb,
                "dividendYield": yld,
                "close": close,
                "open": _to_float(row.get("Open") or row.get("開盤")) if market_type == "tpex" else None,
                "high": _to_float(row.get("High") or row.get("最高")) if market_type == "tpex" else None,
                "low": _to_float(row.get("Low") or row.get("最低")) if market_type == "tpex" else None,
                "volume": volume,
                "trading_money": trading_money,
                "date": iso_date,
            }
        return indexed

    @staticmethod
    def normalize_monthly_revenue_rows(rows: Any) -> dict[str, dict[str, Optional[float]]]:
        """
        正規化 TWSE t187ap05_L 與 TPEx mopsfin_t187ap05_O 月營收資料（處理中文欄位名稱）。
        """
        if not isinstance(rows, list):
            return {}
        indexed: dict[str, dict[str, Optional[float]]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = _get_first_str(row, ["公司代號", "SecuritiesCompanyCode", "Code"])
            if not sym:
                continue
            mom_yoy = _to_float(
                row.get("營業收入-去年同月增減(%)")
                or row.get("去年同月增減(%)")
                or row.get("YoY")
            )
            cum_yoy = _to_float(
                row.get("累計營業收入-前期比較增減(%)")
                or row.get("前期比較增減(%)")
                or row.get("CumYoY")
            )
            rev = _to_float(
                row.get("營業收入-當月營收")
                or row.get("當月營收")
                or row.get("Revenue")
            )
            indexed[sym] = {
                "monthlyYoY": mom_yoy,
                "cumYoY": cum_yoy,
                "revenue": rev,
            }
        return indexed

    async def prefetch_market_snapshots(self) -> None:
        """一次抓取全市場 TWSE / TPEx OpenAPI 快照並建立記憶體索引。"""
        if self._prefetched:
            return

        twse_info_raw = await self._safe_fetch(TWSE_COMPANY_INFO_URL)
        tpex_info_raw = await self._safe_fetch(TPEX_COMPANY_INFO_URL)
        twse_day_raw = await self._safe_fetch(TWSE_STOCK_DAY_ALL_URL)
        twse_val_raw = await self._safe_fetch(TWSE_VALUATION_URL)
        tpex_quotes_raw = await self._safe_fetch(TPEX_DAILY_QUOTES_URL)
        pledge_raw = await self._safe_fetch(TWSE_DIRECTOR_PLEDGE_URL)
        punish_raw = await self._safe_fetch(TWSE_PUNISH_URL)
        twse_rev_raw = await self._safe_fetch(TWSE_MONTHLY_REV_URL)
        tpex_rev_raw = await self._safe_fetch(TPEX_MONTHLY_REV_URL)

        self._twse_info = self.normalize_company_info_list(twse_info_raw, "twse")
        self._tpex_info = self.normalize_company_info_list(tpex_info_raw, "tpex")
        self._twse_day_all = self.normalize_twse_stock_day_all(twse_day_raw)
        self._twse_val = self.normalize_valuation_rows(twse_val_raw, "twse")
        self._tpex_quotes = self.normalize_valuation_rows(tpex_quotes_raw, "tpex")
        if isinstance(pledge_raw, list):
            self._twse_pledge = self.normalize_director_pledge(pledge_raw)
        if isinstance(punish_raw, dict):
            self._twse_punish = self.normalize_twse_punish(punish_raw)
            self._twse_punish_loaded = True
        self._twse_rev = self.normalize_monthly_revenue_rows(twse_rev_raw)
        self._tpex_rev = self.normalize_monthly_revenue_rows(tpex_rev_raw)
        self._prefetched = True

    def get_snapshot(self, symbol: str) -> dict[str, Any]:
        sym = symbol.strip().upper()
        info = self._twse_info.get(sym) or self._tpex_info.get(sym)
        market_type = info["marketType"] if info else (
            "tpex" if sym in self._tpex_quotes and sym not in self._twse_day_all else "twse"
        )
        val = self._twse_val.get(sym) if market_type == "twse" else (self._tpex_quotes.get(sym) or self._twse_val.get(sym))
        daily_quote = (
            self._twse_day_all.get(sym)
            if market_type == "twse"
            else self._tpex_quotes.get(sym)
        )
        # 若 TPEx daily quote 缺乏日期，以台灣今日日期補齊
        if daily_quote and not daily_quote.get("date"):
            tz_tw = dt.timezone(dt.timedelta(hours=8))
            daily_quote = {**daily_quote, "date": dt.datetime.now(tz_tw).strftime("%Y-%m-%d")}

        pledge_entry = self._twse_pledge.get(sym) if market_type == "twse" else None
        director_pledge_ratio = pledge_entry.get("effectivePledgeRatioPct") if pledge_entry else None
        is_disposition = (sym in self._twse_punish) if (market_type == "twse" and self._twse_punish_loaded) else None

        rev_snap = self._twse_rev.get(sym) if market_type == "twse" else self._tpex_rev.get(sym)

        return {
            "symbol": sym,
            "name": info.get("name") if info else None,
            "sector": info.get("sector") if info else None,
            "marketType": market_type,
            "trailingPe": val.get("pe") if val else None,
            "pbRatio": val.get("pb") if val else None,
            "dividendYieldPct": val.get("dividendYield") if val else None,
            "directorPledgeRatio": director_pledge_ratio,
            "isDispositionStock": is_disposition,
            "dailyQuote": daily_quote,
            "monthlyRevenueSnap": rev_snap,
        }
