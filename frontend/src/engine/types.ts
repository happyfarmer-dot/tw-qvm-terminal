export type Market = 'TW';
export type MarketRegime = 'NORMAL' | 'DEFENSIVE';
export type ValuationProfile =
  | 'standard'
  | 'cyclical_heavy_asset'
  | 'cyclical_inventory_order'
  | 'financial_bank'
  | 'financial_life_fhc';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type ExitPriority = 'P0' | 'P1-F' | 'P1-C' | 'P1' | 'P2' | 'P3' | 'P4' | 'HOLD';

export interface RegimeWeights {
  wQ: number;
  wV: number;
  wM: number;
}

export interface CyclicalRegimeWeights {
  wCQ: number;
  wCV: number;
  wCM: number;
}

export interface BenchmarkRegimeInput {
  indexClose: number;
  ma200: number;
  drawdown20dPct: number;
  annualizedVol20dPct: number;
}

export interface RegimeEvaluation {
  suggestedRegime: MarketRegime;
  shouldPromptSwitch: boolean;
  reasons: string[];
  weights: RegimeWeights;
  firstTranchePct: number;
}

export interface StageZeroInput {
  price: number | null;
  isManufacturing: boolean;
  beneishMScore: number | null;
  altmanZScore: number | null;
  altmanZDoublePrime: number | null;
  cumulative3yOCF: number | null;
  cumulative5yOCF?: number | null;
  latestCurrentRatio?: number | null;
  latestNetDebtToEquityPct?: number | null;
  hasAuditOrGovernanceRedFlag: boolean | null;
  isFullCashDeliveryOrSuspended: boolean | null;
  directorPledgeRatio: number | null;
  directorInsufficientHoldingMonths: number | null;
  avgDailyTurnover20dTWD: number | null;
  isDispositionStock: boolean | null;
  shareDilution3yPct: number | null;
  isRoicDeclining: boolean | null;
  consecutive2qArOrInvBloat: boolean | null;
}

export interface StageZeroRedFlag {
  code: string;
  title: string;
  detail: string;
}

export interface StageZeroResult {
  passed: boolean;
  gradeOverride: 'F' | null;
  redFlags: StageZeroRedFlag[];
  pendingManualChecks: string[];
}

export interface PiotroskiChecks {
  positiveRoa: boolean;
  roaImproving: boolean;
  positiveOcf: boolean;
  ocfGreaterThanNetIncome: boolean;
  lowerLongTermDebtRatio: boolean;
  higherCurrentRatio: boolean;
  noShareDilution: boolean;
  higherGrossMargin: boolean;
  higherAssetTurnover: boolean;
}

export interface ManualScorecardInput {
  q1RoicScore: number; // 0 - 12
  q2GpaScore: number; // 0 - 10
  q3OcfNiScore: number; // 0 - 10
  piotroskiChecks: PiotroskiChecks; // maps 0 - 9 -> 0 - 8
  v1EvMultipleScore: number; // 0 - 15
  v2FcfEvScore: number; // 0 - 12
  v3DivAndPeScore: number; // 0 - 8
  m1PriceMomScore: number; // 0 - 10
  m2FundMomScore: number; // 0 - 10
  m3TrendFilterScore: number; // 0 - 5
}

export interface DimensionBreakdown {
  sQ: number; // 0 - 40
  sV: number; // 0 - 35
  sM: number; // 0 - 25
  piotroskiRaw?: number;
  q4Mapped?: number;
}

export interface RatingResult {
  finalScore: number; // 0 - 100
  baseGrade: Grade;
  finalGrade: Grade;
  antiBiasDowngraded: boolean;
  antiBiasReasons: string[];
  qRatioPct: number;
  vRatioPct: number;
  mRatioPct: number;
  regime: MarketRegime;
  weights: RegimeWeights;
  firstTranchePct: number;
  stageZero: StageZeroResult;
}

export interface PbBand {
  min: number | null;
  p20: number | null;
  p50: number | null;
  p80: number | null;
  max: number | null;
}

export interface DioQuarterPoint {
  quarter: string;
  dio: number | null;
}

export interface GmQuarterPoint {
  quarter: string;
  grossMarginPct: number | null;
}

export interface WorstYearLiquidity {
  year: string | null;
  currentRatio: number | null;
  netDebtToEquityPct: number | null;
}

export interface CyclicalMetrics {
  currentPB: number | null;
  pbPercentile5to7Y: number | null;
  pbBand: PbBand;
  avgOpMargin5to7Y: number | null;
  normalizedEBIT: number | null;
  normalizedEvToEbit: number | null;
  avgRoic5to7Y: number | null;
  roeZScoreVs5to7Y: number | null;
  assetGrowthYoY: number | null;
  capexToDepreciation: number | null;
  worstYearLiquidity: WorstYearLiquidity;
  latestDio: number | null;
  dioQoqChange: number | null;
  consecutiveDioRiseQuarters: number | null;
  dioQuarterlySeries: DioQuarterPoint[];
  contractLiabilitiesYoY: number | null;
  contractLiabilitiesToRev: number | null;
  grossMarginLatest: number | null;
  grossMarginQoQ: number | null;
  grossMargin5yPercentile: number | null;
  grossMarginQuarterlySeries: GmQuarterPoint[];
  biasFromMa200Pct: number | null;
  historyYearsAvailable: number;
  capitalReductionSuspected: boolean;
}

export interface CyclicalBreakdown {
  cq1AvgRoic: number; // 0 - 10
  cq2TroughLiquidity: number; // 0 - 10
  cq3AssetDiscipline: number; // 0 - 10
  sCQ: number; // 0 - 30
  cv1PbRiver: number; // heavy_asset 0-20 / inventory_order 0-15
  cv2NormEvEbit: number; // heavy_asset 0-12 / inventory_order 0-17
  cv3RoeOverheat: number; // 0 - 8
  sCV: number; // 0 - 40
  cm1InvOrderInflection: number; // 0 - 12
  cm2GmSecondDeriv: number; // 0 - 8
  cm3TrendAndBias: number; // 0 - 10
  sCM: number; // 0 - 30
}

export interface CyclicalRatingResult {
  profile: 'cyclical_heavy_asset' | 'cyclical_inventory_order';
  breakdown: CyclicalBreakdown;
  finalScore: number;
  baseGrade: Grade;
  finalGrade: Grade;
  cqRatioPct: number;
  cvRatioPct: number;
  cmRatioPct: number;
  antiBiasDowngraded: boolean;
  antiBiasReasons: string[];
  isPeakCircuitBreakerTriggered: boolean;
  peakCircuitBreakerReasons: string[];
  regime: MarketRegime;
  weights: CyclicalRegimeWeights;
  firstTranchePct: number;
  stageZero: StageZeroResult;
}

export interface FinancialSectorMetrics {
  avgRoe5Y: number | null;
  roeStdDev5Y: number | null;
  minAnnualRoe5Y: number | null;
  currentTtmRoe: number | null;
  currentPB: number | null;
  pbPercentile5to7Y: number | null;
  pbBand: PbBand;
  defaultKe: number;
  avgPayoutRatio5Y: number | null;
  sustainableGrowthG: number | null;
  justifiedPB: number | null;
  pbValuationRatio: number | null;
  cashDividendYieldPct: number | null;
  consecutiveCashDivYears: number | null;
  latestPayoutRatioPct: number | null;
  usesCapitalReserveForDividend: boolean | null;
  netRevenue3mYoY: number | null;
  netRevenue12mYoY: number | null;
  biasFromMa200Pct: number | null;
  volAdjustedMomentum12_1M: number | null;
  // MOPS 監理覆寫欄位
  asOfQuarter: string | null;
  isDsib: boolean | null;
  fhcCarPct: number | null;
  bankBisPct: number | null;
  bankCet1Pct: number | null;
  doubleLeverageRatioPct: number | null;
  nplRatioPct: number | null;
  nplConsecutiveRiseQuarters: number | null;
  nplCoverageRatioPct: number | null;
  lifeSolvencyRatioPct: number | null;
  lifeSolvencyRegime: 'RBC' | 'TW-ICS' | null;
  ociRestrictsDividend: boolean | null;
  recentDilutiveOfferingPct: number | null;
}

export interface FinancialRegimeWeights {
  wFQ: number;
  wFV: number;
  wFM: number;
}

export interface FinancialBreakdown {
  fq1CapitalBuffer: number; // 0 - 12
  fq2AssetQuality: number; // bank 0-12 / life 0-8
  fq3RoeAndDlr: number; // bank 0-8 / life 0-12
  fq4DividendReal: number; // 0 - 8
  sFQ: number; // 0 - 40
  fv1JustifiedPb: number; // 0 - 18
  fv2PbRiver: number; // 0 - 12
  fv3YieldSpread: number; // 0 - 10
  sFV: number; // 0 - 40
  fm1NetRevMom: number; // 0 - 10
  fm2TrendAndBias: number; // 0 - 10
  sFM: number; // 0 - 20
}

export interface FinancialStageZeroResult extends StageZeroResult {
  hasUnverifiedRegulatoryFields: boolean;
}

export interface FinancialRatingResult {
  profile: 'financial_bank' | 'financial_life_fhc';
  breakdown: FinancialBreakdown;
  finalScore: number;
  baseGrade: Grade;
  finalGrade: Grade;
  fqRatioPct: number;
  fvRatioPct: number;
  fmRatioPct: number;
  antiBiasDowngraded: boolean;
  antiBiasReasons: string[];
  isFinancialTrapCircuitBreakerTriggered: boolean;
  financialTrapReasons: string[];
  hasUnverifiedRegulatoryFields: boolean;
  effectiveKePct: number;
  effectivePayoutPct: number | null;
  recalculatedJustifiedPB: number | null;
  recalculatedPbValuationRatio: number | null;
  regime: MarketRegime;
  weights: FinancialRegimeWeights;
  firstTranchePct: number;
  stageZero: FinancialStageZeroResult;
}

export interface DataQuality {
  completenessPct: number;
  missingFields: string[];
  manualVerificationRequired: string[];
  warnings: string[];
  fromCache: boolean;
  fetchedAt: string;
}

export interface TwStockCandidate {
  id: string;
  symbol: string;
  name: string;
  marketType: 'twse' | 'tpex';
  sector: string;
  recommendedProfile: ValuationProfile;
  price: number;
  annualizedVolPct: number;
  atr20: number;
  ma50: number;
  ma120: number;
  ma200: number;
  daysBelow200Ma: number;
  // Standard QVM raw metrics
  roicPct: number;
  gpaPct: number;
  ocfToNiPct: number;
  piotroskiRaw: number;
  evToEbitda: number;
  fcfYieldPct: number;
  trailingPe: number;
  forwardPe: number | null;
  dividendYieldPct: number;
  consecutive5yDividend: boolean;
  mom12m1mSharpe: number;
  rev3mCumYoYPct: number;
  rev12mCumYoYPct: number;
  trendSlopeScore: number;
  stageZeroInput: StageZeroInput;
  cyclicalMetrics: CyclicalMetrics;
  financialMetrics?: FinancialSectorMetrics;
  dataQuality?: DataQuality;
  notes?: string;
}

export interface BatchRankedStock {
  stock: TwStockCandidate;
  stageZero: StageZeroResult;
  rating: RatingResult;
  breakdown: DimensionBreakdown;
  sectorSampleCount: number;
  fallbackToMarketPool: boolean;
  subScoresPct: {
    roic: number;
    gpa: number;
    ocfNi: number;
    piotroski: number;
    evMultiple: number;
    fcfYield: number;
    pe: number;
    divYield: number;
    priceMom: number;
    fundMom: number;
    trend: number;
  };
  marketRank: number;
}

export interface EntryPlan {
  allowEntry: boolean;
  actionTitle: string;
  firstTranchePct: number;
  secondTranchePct: number;
  secondTrancheChecklist: string[];
  twSpecificNotes: string[];
  blockedReasons: string[];
  defensiveLeftSideEntryAllowed?: boolean;
  defensiveLeftSideMessage?: string;
}

export interface HoldingPosition {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  valuationProfile: ValuationProfile;
  shares: number;
  costPrice: number;
  currentPrice: number;
  highestPriceSinceEntry: number;
  atr20: number;
  ma60: number;
  ma120: number;
  ma200: number;
  daysBelow200Ma: number;
  moatPermanentlyBroken: boolean;
  stopDrawdownThresholdPct: number;
  currentRating: RatingResult;
  currentBreakdown: DimensionBreakdown;
  cyclicalMetrics?: CyclicalMetrics;
  cyclicalRating?: CyclicalRatingResult;
  financialMetrics?: FinancialSectorMetrics;
  financialRating?: FinancialRatingResult;
}

export interface ExitDecision {
  holdingId: string;
  symbol: string;
  name: string;
  primaryPriority: ExitPriority;
  actionLabel: string;
  actionDetail: string;
  recommendedSellShares: number;
  recommendedSellPct: number;
  estimatedProceeds: number;
  estimatedFrictionCost: number;
  frictionCostRatePct: number;
  trailingStopPrice?: number;
  portfolioLossImpactPct: number;
  positionWeightPct: number;
  triggeredSignals: {
    priority: ExitPriority;
    title: string;
    detail: string;
  }[];
  bufferProtected: boolean;
}

export interface TwFrictionConfig {
  feeDiscount: number; // e.g., 0.6 (6折) or 0.28 (2.8折)
  applyMinFee20: boolean;
  slippageRoundTripPct: number; // default 0.15%
}

export interface SizingCandidate {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  price: number;
  annualizedVolPct: number;
  finalScore: number;
  grade: Grade;
}

export interface SizingConfig {
  totalActiveCapital: number;
  portfolioMode: 'SATELLITE' | 'FULL';
  minWeightPct: number;
  maxWeightPct: number;
  sectorCapPct: number;
  applySectorScaling: boolean;
}

export interface SizedAllocation {
  candidate: SizingCandidate;
  rawInverseVolWeightPct: number;
  constrainedWeightPct: number;
  finalWeightPct: number;
  allocatedAmount: number;
  suggestedShares: number;
  twLots: number;
  twOddShares: number;
  isCappedAtMax: boolean;
  isFlooredAtMin: boolean;
  sectorScaledDown: boolean;
}

export interface SectorExposure {
  sector: string;
  unscaledWeightPct: number;
  finalWeightPct: number;
  exceedsCap: boolean;
  capPct: number;
}

export interface PortfolioSizingResult {
  allocations: SizedAllocation[];
  sectorExposures: SectorExposure[];
  totalWeightPct: number;
  totalAllocatedAmount: number;
  cashReservePct: number;
  warnings: string[];
}
