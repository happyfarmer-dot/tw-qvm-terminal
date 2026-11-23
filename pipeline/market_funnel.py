from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from pipeline.calculators.cyclical_metrics import recommend_valuation_profile
from pipeline.providers.twse_tpex_client import TwseTpexClient


COMMON_STOCK_RE = re.compile(r"^\d{4}$")

DEFAULT_MIN_PRICE_TWD = 15.0
DEFAULT_MIN_TURNOVER_TWD = 50_000_000.0  # 5,000 萬元
DEFAULT_MAX_FUNNEL_SIZE = 500


def is_common_tw_stock(symbol: str) -> bool:
    """只保留 4 碼純數字普通股，排除 00 開頭 ETF、權證、特別股、存託憑證。"""
    s = (symbol or "").strip().upper()
    return bool(COMMON_STOCK_RE.match(s)) and not s.startswith("00")


def load_symbol_list_json(path: Path) -> list[str]:
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        raw_syms = raw.get("symbols", []) if isinstance(raw, dict) else []
        out: list[str] = []
        for s in raw_syms:
            clean = str(s).strip().upper()
            if clean and clean not in out:
                out.append(clean)
        return out
    except Exception:
        return []


def build_dynamic_universe(
    *,
    twse_tpex: TwseTpexClient,
    custom_watchlist: list[str],
    cached_symbols: set[str],
    fallback_watchlist: Optional[list[str]] = None,
    target_symbols_env: str = "",
    min_price_twd: float = DEFAULT_MIN_PRICE_TWD,
    min_turnover_twd: float = DEFAULT_MIN_TURNOVER_TWD,
    max_funnel_size: int = DEFAULT_MAX_FUNNEL_SIZE,
) -> tuple[list[str], dict[str, Any]]:
    """
    零額度全市場智慧篩選漏斗（400–500 檔精華台股動態擴容）：
    1. 只保留 4 碼純數字普通股（排除 00 開頭 ETF、權證、特別股、DR）。
    2. 排除低價與監理地雷：收盤價 < 15.0 元、處置股、董監設質 >= 70%。
    3. 排除冷門殭屍股：當日成交金額 < 5,000 萬元；若超過 500 檔依成交金額由高到低取前 500 檔。
    4. 基本體質初篩：排除本益比為負或缺失之長期虧損公司（金融保險業或強景氣循環龍頭保留進入特化模型評估）。
    5. custom_watchlist.json 白名單不受成交金額前 500 名限制，優先納入抓取。

    回傳 (ordered_symbols, funnel_stats)，其中 ordered_symbols 依以下 3 順位排序：
    - 第 1 順位：target_symbols_env / custom_watchlist / 成交金額前 100 大權值龍頭
    - 第 2 順位：其餘尚未完成 7 年歷史入庫（無快取）之漏斗入選股
    - 第 3 順位：已完成建庫（有快取）之漏斗入選股（每日零額度更新）
    """
    custom_valid = [s for s in custom_watchlist if is_common_tw_stock(s)]
    custom_set = set(custom_valid)

    manual_priority: list[str] = []
    if target_symbols_env.strip():
        for part in target_symbols_env.replace(" ", ",").split(","):
            clean = part.strip().upper()
            if clean and is_common_tw_stock(clean) and clean not in manual_priority:
                manual_priority.append(clean)

    # 彙整全市場 TWSE + TPEx 當日快照代號
    all_market_syms = set(twse_tpex._twse_day_all.keys()) | set(twse_tpex._tpex_quotes.keys())

    # 若 TWSE / TPEx 官方全市場快照為空（例如離線測試或暫時性斷線），安全回退至自訂 + 備援清單
    if not all_market_syms:
        merged: list[str] = []
        for s in manual_priority + custom_valid + (fallback_watchlist or []):
            clean = s.strip().upper()
            if clean and is_common_tw_stock(clean) and clean not in merged:
                merged.append(clean)
        return merged, {
            "mode": "fallback_watchlist",
            "totalMarketScanned": 0,
            "qualifiedCount": len(merged),
            "customCount": len(custom_valid),
        }

    candidates: list[tuple[str, float]] = []
    for sym in all_market_syms:
        if not is_common_tw_stock(sym):
            continue

        snap = twse_tpex.get_snapshot(sym)
        quote = snap.get("dailyQuote") or {}
        close = quote.get("close")
        turnover = quote.get("trading_money") or 0.0
        pe = snap.get("trailingPe")
        pledge = snap.get("directorPledgeRatio")
        is_disp = snap.get("isDispositionStock")
        raw_sector = snap.get("sector") or ""
        name = snap.get("name") or ""

        # 白名單標的（僅排除處置股與設質 >= 70% 之重大地雷）
        if sym in custom_set:
            if is_disp is True or (pledge is not None and float(pledge) >= 70.0):
                continue
            candidates.append((sym, float(turnover)))
            continue

        # 規則 2：排除低價 (< 15 元) 與監理地雷
        if close is None or float(close) < min_price_twd:
            continue
        if is_disp is True:
            continue
        if pledge is not None and float(pledge) >= 70.0:
            continue

        # 規則 3：排除冷門殭屍股 (成交金額 < 5,000 萬)
        if float(turnover) < min_turnover_twd:
            continue

        # 規則 4：基本體質初篩（排除虧損或無 PE，但保留金融與景氣循環特化模型標的）
        profile = recommend_valuation_profile(raw_sector, sym, name)
        if profile == "standard" and (pe is None or float(pe) <= 0):
            continue

        candidates.append((sym, float(turnover)))

    # 依成交金額由高到低排序
    candidates.sort(key=lambda x: x[1], reverse=True)

    # 確保白名單全部納入，其餘名額依成交金額取至 max_funnel_size (預設 500 檔)
    custom_in_cand = [(s, t) for s, t in candidates if s in custom_set]
    other_cands = [(s, t) for s, t in candidates if s not in custom_set]

    # 若白名單中有個股當日無報價，仍強制保留
    custom_cand_syms = {s for s, _ in custom_in_cand}
    for s in custom_valid:
        if s not in custom_cand_syms:
            custom_in_cand.append((s, 0.0))

    remaining_slots = max(0, max_funnel_size - len(custom_in_cand))
    selected_others = other_cands[:remaining_slots]

    # 合併為動態精華池並依成交金額排序
    pool_with_turnover = custom_in_cand + selected_others
    pool_with_turnover.sort(key=lambda x: x[1], reverse=True)
    top100_leaders = {s for s, _ in pool_with_turnover[:100]}

    # 3 順位優先排序：
    # 第 1 順位：manual_priority + custom_watchlist + 成交金額前 100 大權值龍頭
    # 第 2 順位：其餘尚未完成 7 年歷史入庫（無快取）的漏斗入選股
    # 第 3 順位：已完成建庫（有快取）的漏斗入選股
    tier1: list[str] = []
    tier2_uncached: list[str] = []
    tier3_cached: list[str] = []

    all_selected_syms = [s for s, _ in pool_with_turnover]
    for s in manual_priority:
        if s not in tier1:
            tier1.append(s)
    for s in custom_valid:
        if s not in tier1:
            tier1.append(s)
    for s in all_selected_syms:
        if s in top100_leaders and s not in tier1:
            tier1.append(s)

    tier1_set = set(tier1)
    for s in all_selected_syms:
        if s in tier1_set:
            continue
        if s not in cached_symbols:
            tier2_uncached.append(s)
        else:
            tier3_cached.append(s)

    ordered = tier1 + tier2_uncached + tier3_cached
    return ordered, {
        "mode": "dynamic_funnel",
        "totalMarketScanned": len(all_market_syms),
        "qualifiedCount": len(candidates),
        "selectedCount": len(ordered),
        "customCount": len(custom_valid),
        "tier1Leaders": len(tier1),
        "tier2Uncached": len(tier2_uncached),
        "tier3Cached": len(tier3_cached),
    }
