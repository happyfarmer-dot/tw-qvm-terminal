from __future__ import annotations

import datetime as dt
from typing import Optional

import aiosqlite

from app.schemas.qvm_models import RegulatoryOverridePayload, RegulatoryOverrideRecord


class RegulatoryOverrideStore:
    """SQLite 金融監理指標結構化覆寫表 (financial_regulatory_overrides)"""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._initialized = False

    async def init(self) -> None:
        if self._initialized:
            return
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS financial_regulatory_overrides (
                    symbol TEXT PRIMARY KEY,
                    as_of_quarter TEXT,
                    is_dsib INTEGER,
                    fhc_car_pct REAL,
                    bank_bis_pct REAL,
                    bank_cet1_pct REAL,
                    double_leverage_ratio_pct REAL,
                    npl_ratio_pct REAL,
                    npl_consecutive_rise_quarters INTEGER,
                    npl_coverage_ratio_pct REAL,
                    life_solvency_ratio_pct REAL,
                    life_solvency_regime TEXT,
                    oci_restricts_dividend INTEGER,
                    recent_dilutive_offering_pct REAL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            await db.commit()
        self._initialized = True

    async def get(self, symbol: str) -> RegulatoryOverrideRecord:
        await self.init()
        sym = symbol.strip().upper()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM financial_regulatory_overrides WHERE symbol = ?",
                (sym,),
            ) as cursor:
                row = await cursor.fetchone()
                if not row:
                    return RegulatoryOverrideRecord(symbol=sym)

                return RegulatoryOverrideRecord(
                    symbol=sym,
                    asOfQuarter=row["as_of_quarter"],
                    isDsib=bool(row["is_dsib"]) if row["is_dsib"] is not None else None,
                    fhcCarPct=row["fhc_car_pct"],
                    bankBisPct=row["bank_bis_pct"],
                    bankCet1Pct=row["bank_cet1_pct"],
                    doubleLeverageRatioPct=row["double_leverage_ratio_pct"],
                    nplRatioPct=row["npl_ratio_pct"],
                    nplConsecutiveRiseQuarters=row["npl_consecutive_rise_quarters"],
                    nplCoverageRatioPct=row["npl_coverage_ratio_pct"],
                    lifeSolvencyRatioPct=row["life_solvency_ratio_pct"],
                    lifeSolvencyRegime=row["life_solvency_regime"],
                    ociRestrictsDividend=(
                        bool(row["oci_restricts_dividend"])
                        if row["oci_restricts_dividend"] is not None
                        else None
                    ),
                    recentDilutiveOfferingPct=row["recent_dilutive_offering_pct"],
                    updatedAt=row["updated_at"],
                )

    async def upsert(
        self, symbol: str, payload: RegulatoryOverridePayload
    ) -> RegulatoryOverrideRecord:
        await self.init()
        sym = symbol.strip().upper()
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        is_dsib_int: Optional[int] = (
            (1 if payload.isDsib else 0) if payload.isDsib is not None else None
        )
        oci_int: Optional[int] = (
            (1 if payload.ociRestrictsDividend else 0)
            if payload.ociRestrictsDividend is not None
            else None
        )

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO financial_regulatory_overrides (
                    symbol, as_of_quarter, is_dsib, fhc_car_pct, bank_bis_pct,
                    bank_cet1_pct, double_leverage_ratio_pct, npl_ratio_pct,
                    npl_consecutive_rise_quarters, npl_coverage_ratio_pct,
                    life_solvency_ratio_pct, life_solvency_regime,
                    oci_restricts_dividend, recent_dilutive_offering_pct, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    as_of_quarter = excluded.as_of_quarter,
                    is_dsib = excluded.is_dsib,
                    fhc_car_pct = excluded.fhc_car_pct,
                    bank_bis_pct = excluded.bank_bis_pct,
                    bank_cet1_pct = excluded.bank_cet1_pct,
                    double_leverage_ratio_pct = excluded.double_leverage_ratio_pct,
                    npl_ratio_pct = excluded.npl_ratio_pct,
                    npl_consecutive_rise_quarters = excluded.npl_consecutive_rise_quarters,
                    npl_coverage_ratio_pct = excluded.npl_coverage_ratio_pct,
                    life_solvency_ratio_pct = excluded.life_solvency_ratio_pct,
                    life_solvency_regime = excluded.life_solvency_regime,
                    oci_restricts_dividend = excluded.oci_restricts_dividend,
                    recent_dilutive_offering_pct = excluded.recent_dilutive_offering_pct,
                    updated_at = excluded.updated_at
                """,
                (
                    sym,
                    payload.asOfQuarter,
                    is_dsib_int,
                    payload.fhcCarPct,
                    payload.bankBisPct,
                    payload.bankCet1Pct,
                    payload.doubleLeverageRatioPct,
                    payload.nplRatioPct,
                    payload.nplConsecutiveRiseQuarters,
                    payload.nplCoverageRatioPct,
                    payload.lifeSolvencyRatioPct,
                    payload.lifeSolvencyRegime,
                    oci_int,
                    payload.recentDilutiveOfferingPct,
                    now_iso,
                ),
            )
            await db.commit()

        return await self.get(sym)
