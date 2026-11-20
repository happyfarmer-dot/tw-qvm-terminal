from __future__ import annotations

import re
from typing import Any, Optional

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.cache import SqliteTTLCache


TWSE_COMPANY_INFO_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
TWSE_DIRECTOR_PLEDGE_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap11_L"
TWSE_PUNISH_URL = "https://www.twse.com.tw/rwd/zh/announcement/punish?response=json"
TWSE_VALUATION_URL = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"

TPEX_COMPANY_INFO_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
TPEX_DAILY_QUOTES_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"


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
    if s in ("", "-", "--", "N/A", "null", "None"):
        return None
    try:
        num = float(s)
        return num
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
    def __init__(
        self,
        *,
        cache: SqliteTTLCache,
        snapshot_ttl_seconds: int = 86_400,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.cache = cache
        self.snapshot_ttl_seconds = snapshot_ttl_seconds
        self._external_client = http_client
        # In-memory symbol index backed by 24h SQLite snapshots
        self._mem_index: dict[str, dict[str, Any]] = {}

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=3),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.TransportError)),
        reraise=True,
    )
    async def _fetch_json(self, url: str) -> Any:
        headers = {"User-Agent": "TW-QVM-Quant-Terminal/1.0"}
        if self._external_client is not None:
            resp = await self._external_client.get(url, headers=headers, timeout=20.0)
            resp.raise_for_status()
            return resp.json()
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()

    async def _get_cached_snapshot(
        self, cache_key: str, url: str, force_refresh: bool = False
    ) -> tuple[Any, bool]:
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached is not None:
                return cached, True

        try:
            data = await self._fetch_json(url)
        except Exception:
            data = None

        if data is not None:
            await self.cache.set(
                cache_key,
                data,
                self.snapshot_ttl_seconds,
                symbol=None,
                category="market_snapshot",
            )
            self._mem_index.pop(cache_key, None)
        return data, False

    @staticmethod
    def normalize_director_pledge(
        rows: list[dict[str, Any]],
    ) -> dict[str, dict[str, Optional[float]]]:
        """
        彙總 t187ap11_L 董監事持股餘額明細：
        計算全體董監事加總「設質股數 / 目前持股」與單一主要董事最高設質比例，
        回傳以股票代號為 key 的字典。
        """
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            sym = _get_first_str(row, ["公司代號", "Code", "SecuritiesCompanyCode"])
            if not sym:
                continue
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
        """解析 TWSE 最新處置股清單，回傳處置股代號集合"""
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
    def normalize_valuation_rows(rows: Any, market_type: str) -> dict[str, dict[str, Optional[float]]]:
        if not isinstance(rows, list):
            return {}
        indexed: dict[str, dict[str, Optional[float]]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = _get_first_str(row, ["Code", "SecuritiesCompanyCode", "公司代號"])
            if not sym:
                continue
            if market_type == "twse":
                pe = _to_float(row.get("PEratio"))
                pb = _to_float(row.get("PBratio"))
                yld = _to_float(row.get("DividendYield"))
                close = None
            else:
                pe = _to_float(row.get("PEratio"))
                pb = _to_float(row.get("PBratio"))
                yld = _to_float(row.get("DividendYield"))
                close = _to_float(row.get("Close"))
            indexed[sym] = {
                "pe": pe,
                "pb": pb,
                "dividendYield": yld,
                "close": close,
            }
        return indexed

    async def get_twse_tpex_snapshot(
        self, symbol: str, force_refresh: bool = False
    ) -> dict[str, Any]:
        """
        取得單一個股在 TWSE / TPEx OpenAPI 之正規化欄位。
        整份全市場清單快取 24 小時並建立索引；找不到或上櫃未提供欄位時回傳 None。
        """
        sym = symbol.strip().upper()

        # 1. 上市基本資料
        twse_info_raw, _ = await self._get_cached_snapshot(
            "snapshot:twse:t187ap03_L", TWSE_COMPANY_INFO_URL, force_refresh
        )
        if "snapshot:twse:t187ap03_L" not in self._mem_index or force_refresh:
            self._mem_index["snapshot:twse:t187ap03_L"] = self.normalize_company_info_list(
                twse_info_raw, "twse"
            )
        twse_info = self._mem_index["snapshot:twse:t187ap03_L"].get(sym)

        # 2. 上櫃基本資料
        tpex_info_raw, _ = await self._get_cached_snapshot(
            "snapshot:tpex:t187ap03_O", TPEX_COMPANY_INFO_URL, force_refresh
        )
        if "snapshot:tpex:t187ap03_O" not in self._mem_index or force_refresh:
            self._mem_index["snapshot:tpex:t187ap03_O"] = self.normalize_company_info_list(
                tpex_info_raw, "tpex"
            )
        tpex_info = self._mem_index["snapshot:tpex:t187ap03_O"].get(sym)

        info = twse_info or tpex_info
        market_type = info["marketType"] if info else "twse"

        # 3. TWSE 估值 (PE/PB/Yield) 與 TPEx 每日收盤
        twse_val_raw, _ = await self._get_cached_snapshot(
            "snapshot:twse:BWIBBU_ALL", TWSE_VALUATION_URL, force_refresh
        )
        if "snapshot:twse:BWIBBU_ALL" not in self._mem_index or force_refresh:
            self._mem_index["snapshot:twse:BWIBBU_ALL"] = self.normalize_valuation_rows(
                twse_val_raw, "twse"
            )
        twse_val = self._mem_index["snapshot:twse:BWIBBU_ALL"].get(sym)

        tpex_quotes_raw, _ = await self._get_cached_snapshot(
            "snapshot:tpex:daily_quotes", TPEX_DAILY_QUOTES_URL, force_refresh
        )
        if "snapshot:tpex:daily_quotes" not in self._mem_index or force_refresh:
            self._mem_index["snapshot:tpex:daily_quotes"] = self.normalize_valuation_rows(
                tpex_quotes_raw, "tpex"
            )
        tpex_val = self._mem_index["snapshot:tpex:daily_quotes"].get(sym)

        val = twse_val if market_type == "twse" else (tpex_val or twse_val)

        # 4. 董監設質與處置股（上市結構化；上櫃若無結構化端點回傳 None）
        director_pledge_ratio: Optional[float] = None
        is_disposition_stock: Optional[bool] = None

        if market_type == "twse":
            pledge_raw, _ = await self._get_cached_snapshot(
                "snapshot:twse:t187ap11_L", TWSE_DIRECTOR_PLEDGE_URL, force_refresh
            )
            if isinstance(pledge_raw, list):
                if "snapshot:twse:t187ap11_L" not in self._mem_index or force_refresh:
                    self._mem_index["snapshot:twse:t187ap11_L"] = self.normalize_director_pledge(
                        pledge_raw
                    )
                pledge_entry = self._mem_index["snapshot:twse:t187ap11_L"].get(sym)
                if pledge_entry:
                    director_pledge_ratio = pledge_entry.get("effectivePledgeRatioPct")

            punish_raw, _ = await self._get_cached_snapshot(
                "snapshot:twse:punish", TWSE_PUNISH_URL, force_refresh
            )
            if isinstance(punish_raw, dict):
                punish_set = self.normalize_twse_punish(punish_raw)
                is_disposition_stock = sym in punish_set

        return {
            "symbol": sym,
            "name": info.get("name") if info else None,
            "sector": info.get("sector") if info else None,
            "marketType": market_type,
            "trailingPe": val.get("pe") if val else None,
            "pbRatio": val.get("pb") if val else None,
            "dividendYieldPct": val.get("dividendYield") if val else None,
            "directorPledgeRatio": director_pledge_ratio,
            "isDispositionStock": is_disposition_stock,
        }
