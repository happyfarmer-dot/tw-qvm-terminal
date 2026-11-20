from __future__ import annotations

from typing import Any

import pandas as pd


CASH_REDUCTION_WARNING = (
    "免費版還原價已計入除權息，但不含現金減資還原，若個股近一年曾辦理現金減資請人工核對。"
)


def compute_free_adjusted_prices(
    price_rows: list[dict[str, Any]],
    dividend_rows: list[dict[str, Any]],
) -> tuple[pd.DataFrame, list[str]]:
    """
    免費版還原權息價計算器：
    1. 過濾掉 close <= 0 的異常交易日（有量無價）
    2. 保留 Trading_Volume（股數）與 Trading_money（成交金額 TWD）
    3. 依據 TaiwanStockDividendResult 的除權息日 date、before_price、after_price，
       對除權息日之前的歷史 open/max/min/close 乘上累積還原因子 (after_price / before_price)
    """
    warnings: list[str] = []
    if not price_rows:
        return pd.DataFrame(), warnings

    df = pd.DataFrame(price_rows).copy()
    if "date" not in df.columns or "close" not in df.columns:
        return pd.DataFrame(), warnings

    for col in ("open", "max", "min", "close", "Trading_Volume", "Trading_money"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        else:
            df[col] = pd.NA

    # 清洗規則 1：過濾 close <= 0 或 NaN
    dropped_count = int((df["close"].isna() | (df["close"] <= 0)).sum())
    df = df[df["close"].notna() & (df["close"] > 0)].copy()
    if dropped_count > 0:
        warnings.append(f"已過濾 {dropped_count} 筆 close <= 0 之有量無價異常交易日。")

    if df.empty:
        return df, warnings

    df["date"] = df["date"].astype(str)
    df = df.sort_values("date").drop_duplicates(subset=["date"], keep="last").reset_index(drop=True)

    # 確保 open / max / min 若有缺失時以 close 補齊合理界線（不影響 close 缺失過濾）
    df["open"] = df["open"].where(df["open"] > 0, df["close"])
    df["max"] = df["max"].where(df["max"] > 0, df["close"])
    df["min"] = df["min"].where(df["min"] > 0, df["close"])

    df["adj_factor"] = 1.0

    if dividend_rows:
        div_df = pd.DataFrame(dividend_rows).copy()
        if {"date", "before_price", "after_price"}.issubset(div_df.columns):
            div_df["before_price"] = pd.to_numeric(div_df["before_price"], errors="coerce")
            div_df["after_price"] = pd.to_numeric(div_df["after_price"], errors="coerce")
            div_df = div_df[
                div_df["before_price"].notna()
                & div_df["after_price"].notna()
                & (div_df["before_price"] > 0)
                & (div_df["after_price"] > 0)
            ].copy()

            for _, div_row in div_df.iterrows():
                ex_date = str(div_row["date"])
                factor = float(div_row["after_price"]) / float(div_row["before_price"])
                mask = df["date"] < ex_date
                if mask.any():
                    df.loc[mask, "adj_factor"] = df.loc[mask, "adj_factor"] * factor

    for col in ("open", "max", "min", "close"):
        df[f"adj_{col}"] = (df[col].astype(float) * df["adj_factor"]).round(4)

    warnings.append(CASH_REDUCTION_WARNING)
    return df, warnings


def normalize_backer_adjusted_prices(price_adj_rows: list[dict[str, Any]]) -> pd.DataFrame:
    """付費版 TaiwanStockPriceAdj 標準化"""
    if not price_adj_rows:
        return pd.DataFrame()
    df = pd.DataFrame(price_adj_rows).copy()
    for col in ("open", "max", "min", "close", "Trading_Volume", "Trading_money"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df[df["close"].notna() & (df["close"] > 0)].copy()
    if df.empty:
        return df
    df["date"] = df["date"].astype(str)
    df = df.sort_values("date").drop_duplicates(subset=["date"], keep="last").reset_index(drop=True)
    for col in ("open", "max", "min", "close"):
        df[f"adj_{col}"] = df[col].astype(float)
    return df
