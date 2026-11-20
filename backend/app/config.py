from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    finmind_api_token: str = ""
    finmind_tier: Literal["free", "backer"] = "free"
    cache_db_path: str = "./data/tw_qvm_cache.db"
    cache_ttl_financial_seconds: int = 604_800  # 7 days
    cache_ttl_price_seconds: int = 43_200       # 12 hours
    cache_ttl_market_snapshot_seconds: int = 86_400  # 24 hours
    finmind_rate_limit_per_hour: int = 500
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
