from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


ValuationProfile = Literal[
    "standard",
    "cyclical_heavy_asset",
    "cyclical_inventory_order",
    "financial_bank",
    "financial_life_fhc",
]


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class RegimeModel(CamelModel):
    regime: Literal["NORMAL", "DEFENSIVE"]
    indexSymbol: str = "TAIEX"
    indexClose: Optional[float] = None
    ma200: Optional[float] = None
    drawdown20dPct: Optional[float] = None
    annualizedVol20dPct: Optional[float] = None
    reasons: list[str] = Field(default_factory=list)


class PiotroskiChecksModel(CamelModel):
    positiveRoa: Optional[bool] = None
    roaImproving: Optional[bool] = None
    positiveOcf: Optional[bool] = None
    ocfGreaterThanNetIncome: Optional[bool] = None
    lowerLongTermDebtRatio: Optional[bool] = None
    higherCurrentRatio: Optional[bool] = None
    noShareDilution: Optional[bool] = None
    higherGrossMargin: Optional[bool] = None
    higherAssetTurnover: Optional[bool] = None


class StageZeroMetricsModel(CamelModel):
    isManufacturing: bool = True
    beneishMScore: Optional[float] = None
    altmanZScore: Optional[float] = None
    altmanZDoublePrime: Optional[float] = None
    cumulative3yOCF: Optional[float] = None
    cumulative5yOCF: Optional[float] = None
    latestCurrentRatio: Optional[float] = None
    latestNetDebtToEquityPct: Optional[float] = None
    hasAuditOrGovernanceRedFlag: Optional[bool] = None
    isFullCashDeliveryOrSuspended: Optional[bool] = None
    directorPledgeRatio: Optional[float] = None
    directorInsufficientHoldingMonths: Optional[int] = None
    avgDailyTurnover20dTWD: Optional[float] = None
    price: Optional[float] = None
    isDispositionStock: Optional[bool] = None
    shareDilution3yPct: Optional[float] = None
    isRoicDeclining: Optional[bool] = None
    consecutive2qArOrInvBloat: Optional[bool] = None


class FinancialRatiosModel(CamelModel):
    roic3yAvgPct: Optional[float] = None
    gpaPct: Optional[float] = None
    ocfToNi3yPct: Optional[float] = None
    piotroskiRaw: Optional[int] = None
    piotroskiChecks: PiotroskiChecksModel = Field(default_factory=PiotroskiChecksModel)
    evToEbitda: Optional[float] = None
    evToEbit: Optional[float] = None
    fcfYieldPct: Optional[float] = None
    trailingPe: Optional[float] = None
    forwardPe: Optional[float] = None
    pbRatio: Optional[float] = None
    dividendYieldPct: Optional[float] = None
    consecutive5yDividend: Optional[bool] = None
    nonDebtFundedDividend: Optional[bool] = None
    mom12m1mSharpe: Optional[float] = None
    rev3mCumYoYPct: Optional[float] = None
    rev12mCumYoYPct: Optional[float] = None
    trendVsMa200Pct: Optional[float] = None
    trendVsMa120Pct: Optional[float] = None


class PbBandModel(CamelModel):
    min: Optional[float] = None
    p20: Optional[float] = None
    p50: Optional[float] = None
    p80: Optional[float] = None
    max: Optional[float] = None


class DioQuarterPoint(CamelModel):
    quarter: str
    dio: Optional[float] = None


class GmQuarterPoint(CamelModel):
    quarter: str
    grossMarginPct: Optional[float] = None


class WorstYearLiquidityModel(CamelModel):
    year: Optional[str] = None
    currentRatio: Optional[float] = None
    netDebtToEquityPct: Optional[float] = None


class CyclicalMetricsModel(CamelModel):
    currentPB: Optional[float] = None
    pbPercentile5to7Y: Optional[float] = None
    pbBand: PbBandModel = Field(default_factory=PbBandModel)
    avgOpMargin5to7Y: Optional[float] = None
    normalizedEBIT: Optional[float] = None
    normalizedEvToEbit: Optional[float] = None
    avgRoic5to7Y: Optional[float] = None
    roeZScoreVs5to7Y: Optional[float] = None
    assetGrowthYoY: Optional[float] = None
    capexToDepreciation: Optional[float] = None
    worstYearLiquidity: WorstYearLiquidityModel = Field(default_factory=WorstYearLiquidityModel)
    latestDio: Optional[float] = None
    dioQoqChange: Optional[float] = None
    consecutiveDioRiseQuarters: Optional[int] = None
    dioQuarterlySeries: list[DioQuarterPoint] = Field(default_factory=list)
    contractLiabilitiesYoY: Optional[float] = None
    contractLiabilitiesToRev: Optional[float] = None
    grossMarginLatest: Optional[float] = None
    grossMarginQoQ: Optional[float] = None
    grossMargin5yPercentile: Optional[float] = None
    grossMarginQuarterlySeries: list[GmQuarterPoint] = Field(default_factory=list)
    biasFromMa200Pct: Optional[float] = None
    historyYearsAvailable: float = 0.0
    capitalReductionSuspected: bool = False


class RegulatoryOverridePayload(CamelModel):
    asOfQuarter: Optional[str] = None
    isDsib: Optional[bool] = None
    fhcCarPct: Optional[float] = None
    bankBisPct: Optional[float] = None
    bankCet1Pct: Optional[float] = None
    doubleLeverageRatioPct: Optional[float] = None
    nplRatioPct: Optional[float] = None
    nplConsecutiveRiseQuarters: Optional[int] = None
    nplCoverageRatioPct: Optional[float] = None
    lifeSolvencyRatioPct: Optional[float] = None
    lifeSolvencyRegime: Optional[Literal["RBC", "TW-ICS"]] = None
    ociRestrictsDividend: Optional[bool] = None
    recentDilutiveOfferingPct: Optional[float] = None


class RegulatoryOverrideRecord(RegulatoryOverridePayload):
    symbol: str
    updatedAt: Optional[str] = None


class FinancialSectorMetricsModel(CamelModel):
    avgRoe5Y: Optional[float] = None
    roeStdDev5Y: Optional[float] = None
    minAnnualRoe5Y: Optional[float] = None
    currentTtmRoe: Optional[float] = None
    currentPB: Optional[float] = None
    pbPercentile5to7Y: Optional[float] = None
    pbBand: PbBandModel = Field(default_factory=PbBandModel)
    defaultKe: float = 0.08
    avgPayoutRatio5Y: Optional[float] = None
    sustainableGrowthG: Optional[float] = None
    justifiedPB: Optional[float] = None
    pbValuationRatio: Optional[float] = None
    cashDividendYieldPct: Optional[float] = None
    consecutiveCashDivYears: Optional[int] = None
    latestPayoutRatioPct: Optional[float] = None
    usesCapitalReserveForDividend: Optional[bool] = None
    netRevenue3mYoY: Optional[float] = None
    netRevenue12mYoY: Optional[float] = None
    biasFromMa200Pct: Optional[float] = None
    volAdjustedMomentum12_1M: Optional[float] = None
    # 靜態管線中所有 MOPS 監理欄位預設為 None，由前端瀏覽器 localStorage 覆寫合併
    asOfQuarter: Optional[str] = None
    isDsib: Optional[bool] = None
    fhcCarPct: Optional[float] = None
    bankBisPct: Optional[float] = None
    bankCet1Pct: Optional[float] = None
    doubleLeverageRatioPct: Optional[float] = None
    nplRatioPct: Optional[float] = None
    nplConsecutiveRiseQuarters: Optional[int] = None
    nplCoverageRatioPct: Optional[float] = None
    lifeSolvencyRatioPct: Optional[float] = None
    lifeSolvencyRegime: Optional[Literal["RBC", "TW-ICS"]] = None
    ociRestrictsDividend: Optional[bool] = None
    recentDilutiveOfferingPct: Optional[float] = None


class DataQualityModel(CamelModel):
    completenessPct: float
    missingFields: list[str] = Field(default_factory=list)
    manualVerificationRequired: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    fromCache: bool = False
    fetchedAt: str


class HealthExecutiveSummaryModel(CamelModel):
    reportDate: str
    totalScore: float
    grade: Literal["A", "B", "C", "D", "F"]
    profileLabel: str
    verdictBadge: str
    oneLineDiagnosis: str
    suitableFor: str


class HealthSafetyItemModel(CamelModel):
    itemName: str
    displayValue: str
    status: Literal["pass", "warn", "fail", "unknown"]
    plainExplanation: str


class HealthDimensionMetricModel(CamelModel):
    label: str
    valueText: str
    benchmarkText: str
    status: Literal["優秀", "穩健", "偏貴", "警訊", "待確認"]
    comment: str


class HealthDimensionModel(CamelModel):
    key: Literal["quality", "value", "momentum"]
    title: str
    scorePct: float
    gradeText: str
    summaryComment: str
    metrics: list[HealthDimensionMetricModel] = Field(default_factory=list)


class HealthBuyStrategyModel(CamelModel):
    canBuyNow: bool
    firstTranchePct: int
    entryZoneText: str
    secondTrancheCondition: str


class HealthSellDefenseStrategyModel(CamelModel):
    stopLossPrice: Optional[float] = None
    ma200Price: Optional[float] = None
    trailingStopPrice: Optional[float] = None
    fundamentalExitRule: str


class HealthActionPlanModel(CamelModel):
    stance: Literal["BUY", "HOLD_OR_WATCH", "AVOID_OR_SELL"]
    stanceLabel: str
    buyStrategy: HealthBuyStrategyModel
    sellAndDefenseStrategy: HealthSellDefenseStrategyModel


class HealthQuarterlyChartPointModel(CamelModel):
    quarter: str
    revenueYi: Optional[float] = None
    grossMarginPct: Optional[float] = None
    dio: Optional[float] = None


class HealthPeRiverPricesModel(CamelModel):
    ttmEps: Optional[float] = None
    p20Pe: Optional[float] = None
    p50Pe: Optional[float] = None
    p80Pe: Optional[float] = None
    cheapPrice: Optional[float] = None
    fairPrice: Optional[float] = None
    expensivePrice: Optional[float] = None
    currentStatusLabel: Optional[str] = None


class HealthValuationBandSummaryModel(CamelModel):
    metricLabel: str
    currentValue: Optional[float] = None
    percentile5to7Y: Optional[float] = None
    minVal: Optional[float] = None
    p20Val: Optional[float] = None
    p50Val: Optional[float] = None
    p80Val: Optional[float] = None
    maxVal: Optional[float] = None
    positionComment: str
    peRiver: Optional[HealthPeRiverPricesModel] = None


class HealthChartSeriesModel(CamelModel):
    quarterlyTrend: list[HealthQuarterlyChartPointModel] = Field(default_factory=list)
    valuationBand: HealthValuationBandSummaryModel


class HealthReportModel(CamelModel):
    executiveSummary: HealthExecutiveSummaryModel
    safetyCheckup: list[HealthSafetyItemModel] = Field(default_factory=list)
    dimensions: list[HealthDimensionModel] = Field(default_factory=list)
    actionPlan: HealthActionPlanModel
    chartSeries: HealthChartSeriesModel


class TwStockSnapshot(CamelModel):
    symbol: str
    name: str
    marketType: Literal["twse", "tpex"]
    sector: str
    recommendedProfile: ValuationProfile = "standard"
    price: Optional[float] = None
    avgDailyTurnover20dTWD: Optional[float] = None
    annualizedVol60dPct: Optional[float] = None
    annualizedVol120dPct: Optional[float] = None
    atr20: Optional[float] = None
    ma50: Optional[float] = None
    ma120: Optional[float] = None
    ma200: Optional[float] = None
    daysBelow200Ma: int = 0
    stageZeroMetrics: StageZeroMetricsModel
    ratios: FinancialRatiosModel
    cyclicalMetrics: CyclicalMetricsModel = Field(default_factory=CyclicalMetricsModel)
    financialMetrics: Optional[FinancialSectorMetricsModel] = None
    dataQuality: DataQualityModel
    healthReport: Optional[HealthReportModel] = None


class PipelineStatsModel(CamelModel):
    totalWatchlist: int
    successCount: int
    failedCount: int
    skippedDueToQuota: int = 0
    cacheHits: int = 0
    finmindFetched: int = 0
    failedSymbols: list[dict[str, str]] = Field(default_factory=list)
    finmindQuotaRemaining: Optional[int] = None
    finmindQuotaLimit: Optional[int] = None


class ManifestModel(CamelModel):
    version: int = 1
    status: Literal["ready", "partial", "awaiting_first_run"] = "ready"
    updatedAtTaipei: str
    updatedAtUtc: str
    regime: RegimeModel
    stats: PipelineStatsModel


class StocksBundleModel(CamelModel):
    version: int = 1
    updatedAtTaipei: str
    stocks: list[TwStockSnapshot] = Field(default_factory=list)
