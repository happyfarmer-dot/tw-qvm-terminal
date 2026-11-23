import { z } from 'zod';
import type {
  BenchmarkRegimeInput,
  CyclicalMetrics,
  DataQuality,
  FinancialSectorMetrics,
  HealthReport,
  ManualScorecardInput,
  MarketRegime,
  StageZeroInput,
  TwStockCandidate,
  UsMacroData,
  ValuationProfile,
} from '../engine/types';

export interface RegulatoryOverridePayload {
  asOfQuarter?: string | null;
  isDsib?: boolean | null;
  fhcCarPct?: number | null;
  bankBisPct?: number | null;
  bankCet1Pct?: number | null;
  doubleLeverageRatioPct?: number | null;
  nplRatioPct?: number | null;
  nplConsecutiveRiseQuarters?: number | null;
  nplCoverageRatioPct?: number | null;
  lifeSolvencyRatioPct?: number | null;
  lifeSolvencyRegime?: 'RBC' | 'TW-ICS' | null;
  ociRestrictsDividend?: boolean | null;
  recentDilutiveOfferingPct?: number | null;
}

export interface PipelineStats {
  totalWatchlist: number;
  successCount: number;
  failedCount: number;
  skippedDueToQuota: number;
  cacheHits: number;
  finmindFetched: number;
  failedSymbols: { symbol: string; error: string }[];
  finmindQuotaRemaining: number | null;
  finmindQuotaLimit: number | null;
}

export interface ManifestData {
  version: number;
  status: 'ready' | 'partial' | 'awaiting_first_run';
  updatedAtTaipei: string;
  updatedAtUtc: string;
  regime: {
    regime: MarketRegime;
    indexSymbol: string;
    indexClose: number | null;
    ma200: number | null;
    drawdown20dPct: number | null;
    annualizedVol20dPct: number | null;
    reasons: string[];
    usMacro?: UsMacroData | null;
  };
  stats: PipelineStats;
}

export interface StaticStockSnapshot {
  symbol: string;
  name: string;
  marketType: 'twse' | 'tpex';
  sector: string;
  recommendedProfile: ValuationProfile;
  price: number | null;
  avgDailyTurnover20dTWD: number | null;
  annualizedVol60dPct: number | null;
  annualizedVol120dPct: number | null;
  atr20: number | null;
  ma50: number | null;
  ma120: number | null;
  ma200: number | null;
  daysBelow200Ma: number;
  stageZeroMetrics: StageZeroInput;
  ratios: {
    roic3yAvgPct: number | null;
    gpaPct: number | null;
    ocfToNi3yPct: number | null;
    piotroskiRaw: number | null;
    piotroskiChecks: {
      positiveRoa: boolean | null;
      roaImproving: boolean | null;
      positiveOcf: boolean | null;
      ocfGreaterThanNetIncome: boolean | null;
      lowerLongTermDebtRatio: boolean | null;
      higherCurrentRatio: boolean | null;
      noShareDilution: boolean | null;
      higherGrossMargin: boolean | null;
      higherAssetTurnover: boolean | null;
    };
    evToEbitda: number | null;
    evToEbit: number | null;
    fcfYieldPct: number | null;
    trailingPe: number | null;
    forwardPe: number | null;
    pbRatio: number | null;
    dividendYieldPct: number | null;
    consecutive5yDividend: boolean | null;
    nonDebtFundedDividend: boolean | null;
    mom12m1mSharpe: number | null;
    rev3mCumYoYPct: number | null;
    rev12mCumYoYPct: number | null;
    trendVsMa200Pct: number | null;
    trendVsMa120Pct: number | null;
  };
  cyclicalMetrics: CyclicalMetrics;
  financialMetrics: FinancialSectorMetrics | null;
  dataQuality: DataQuality;
  healthReport?: HealthReport | null;
}

export interface StocksBundleData {
  version: number;
  updatedAtTaipei: string;
  stocks: StaticStockSnapshot[];
}

export function createEmptyStageZeroInput(): StageZeroInput {
  return {
    isManufacturing: true,
    beneishMScore: null,
    altmanZScore: null,
    altmanZDoublePrime: null,
    cumulative3yOCF: null,
    cumulative5yOCF: null,
    latestCurrentRatio: null,
    latestNetDebtToEquityPct: null,
    hasAuditOrGovernanceRedFlag: null,
    isFullCashDeliveryOrSuspended: null,
    directorPledgeRatio: null,
    directorInsufficientHoldingMonths: null,
    avgDailyTurnover20dTWD: null,
    price: null,
    isDispositionStock: null,
    shareDilution3yPct: null,
    isRoicDeclining: false,
    consecutive2qArOrInvBloat: false,
  };
}

export function createEmptyCyclicalMetrics(): CyclicalMetrics {
  return {
    currentPB: null,
    pbPercentile5to7Y: null,
    pbBand: { min: null, p20: null, p50: null, p80: null, max: null },
    avgOpMargin5to7Y: null,
    normalizedEBIT: null,
    normalizedEvToEbit: null,
    avgRoic5to7Y: null,
    roeZScoreVs5to7Y: null,
    assetGrowthYoY: null,
    capexToDepreciation: null,
    worstYearLiquidity: { year: null, currentRatio: null, netDebtToEquityPct: null },
    latestDio: null,
    dioQoqChange: null,
    consecutiveDioRiseQuarters: null,
    dioQuarterlySeries: [],
    contractLiabilitiesYoY: null,
    contractLiabilitiesToRev: null,
    grossMarginLatest: null,
    grossMarginQoQ: null,
    grossMargin5yPercentile: null,
    grossMarginQuarterlySeries: [],
    biasFromMa200Pct: null,
    historyYearsAvailable: 0,
    capitalReductionSuspected: false,
  };
}

export function createEmptyFinancialMetrics(): FinancialSectorMetrics {
  return {
    avgRoe5Y: null,
    roeStdDev5Y: null,
    minAnnualRoe5Y: null,
    currentTtmRoe: null,
    currentPB: null,
    pbPercentile5to7Y: null,
    pbBand: { min: null, p20: null, p50: null, p80: null, max: null },
    defaultKe: 0.08,
    avgPayoutRatio5Y: null,
    sustainableGrowthG: null,
    justifiedPB: null,
    pbValuationRatio: null,
    cashDividendYieldPct: null,
    consecutiveCashDivYears: null,
    latestPayoutRatioPct: null,
    usesCapitalReserveForDividend: null,
    netRevenue3mYoY: null,
    netRevenue12mYoY: null,
    biasFromMa200Pct: null,
    volAdjustedMomentum12_1M: null,
    asOfQuarter: null,
    isDsib: null,
    fhcCarPct: null,
    bankBisPct: null,
    bankCet1Pct: null,
    doubleLeverageRatioPct: null,
    nplRatioPct: null,
    nplConsecutiveRiseQuarters: null,
    nplCoverageRatioPct: null,
    lifeSolvencyRatioPct: null,
    lifeSolvencyRegime: null,
    ociRestrictsDividend: null,
    recentDilutiveOfferingPct: null,
  };
}

export function createEmptyManualScorecard(): ManualScorecardInput {
  return {
    q1RoicScore: 0,
    q2GpaScore: 0,
    q3OcfNiScore: 0,
    piotroskiChecks: {
      positiveRoa: false,
      roaImproving: false,
      positiveOcf: false,
      ocfGreaterThanNetIncome: false,
      lowerLongTermDebtRatio: false,
      higherCurrentRatio: false,
      noShareDilution: false,
      higherGrossMargin: false,
      higherAssetTurnover: false,
    },
    v1EvMultipleScore: 0,
    v2FcfEvScore: 0,
    v3DivAndPeScore: 0,
    m1PriceMomScore: 0,
    m2FundMomScore: 0,
    m3TrendFilterScore: 0,
  };
}

export function createDefaultBenchmark(): BenchmarkRegimeInput {
  return {
    indexClose: 0,
    ma200: 0,
    drawdown20dPct: 0,
    annualizedVol20dPct: 0,
  };
}

const MOPS_HINT = '免費公開 API 無結構化端點，請至公開資訊觀測站 (MOPS) 查核最新季報';

export function mergeRegulatoryIntoSnapshot(
  snap: StaticStockSnapshot,
  override?: RegulatoryOverridePayload
): StaticStockSnapshot {
  if (!override || !snap.financialMetrics) return snap;

  const mergedFm: FinancialSectorMetrics = {
    ...snap.financialMetrics,
    asOfQuarter: override.asOfQuarter ?? snap.financialMetrics.asOfQuarter,
    isDsib: override.isDsib ?? snap.financialMetrics.isDsib,
    fhcCarPct: override.fhcCarPct ?? snap.financialMetrics.fhcCarPct,
    bankBisPct: override.bankBisPct ?? snap.financialMetrics.bankBisPct,
    bankCet1Pct: override.bankCet1Pct ?? snap.financialMetrics.bankCet1Pct,
    doubleLeverageRatioPct:
      override.doubleLeverageRatioPct ?? snap.financialMetrics.doubleLeverageRatioPct,
    nplRatioPct: override.nplRatioPct ?? snap.financialMetrics.nplRatioPct,
    nplConsecutiveRiseQuarters:
      override.nplConsecutiveRiseQuarters ?? snap.financialMetrics.nplConsecutiveRiseQuarters,
    nplCoverageRatioPct:
      override.nplCoverageRatioPct ?? snap.financialMetrics.nplCoverageRatioPct,
    lifeSolvencyRatioPct:
      override.lifeSolvencyRatioPct ?? snap.financialMetrics.lifeSolvencyRatioPct,
    lifeSolvencyRegime: override.lifeSolvencyRegime ?? snap.financialMetrics.lifeSolvencyRegime,
    ociRestrictsDividend:
      override.ociRestrictsDividend ?? snap.financialMetrics.ociRestrictsDividend,
    recentDilutiveOfferingPct:
      override.recentDilutiveOfferingPct ?? snap.financialMetrics.recentDilutiveOfferingPct,
  };

  const regFields: [keyof RegulatoryOverridePayload, string][] = [
    ['fhcCarPct', '金控集團資本適足率 (CAR %)'],
    ['bankBisPct', '銀行總資本適足率 (BIS %)'],
    ['bankCet1Pct', '銀行普通股權益第一類資本比率 (CET1 %)'],
    ['doubleLeverageRatioPct', '金控雙重槓桿比 (DLR %)'],
    ['nplRatioPct', '銀行逾放比 (NPL %)'],
    ['nplCoverageRatioPct', '銀行備抵呆帳覆蓋率 (%)'],
    ['lifeSolvencyRatioPct', '壽險子公司清償比率 (RBC / TW-ICS %)'],
  ];

  const regPrefixes = regFields.map(([k]) => k);
  const cleanedManual = snap.dataQuality.manualVerificationRequired.filter(
    (item) => !regPrefixes.some((p) => item.startsWith(p))
  );

  for (const [key, label] of regFields) {
    if (key === 'lifeSolvencyRatioPct' && snap.recommendedProfile !== 'financial_life_fhc') {
      continue;
    }
    if (mergedFm[key] === null || mergedFm[key] === undefined) {
      cleanedManual.push(`${key}（${label} — ${MOPS_HINT}）`);
    }
  }

  return {
    ...snap,
    financialMetrics: mergedFm,
    dataQuality: {
      ...snap.dataQuality,
      manualVerificationRequired: cleanedManual,
    },
  };
}

export function mapSnapshotToCandidate(snap: StaticStockSnapshot): TwStockCandidate {
  const price = snap.price ?? 0;
  const vol = snap.annualizedVol60dPct ?? snap.annualizedVol120dPct ?? 25;
  return {
    id: `TW-${snap.symbol}`,
    symbol: snap.symbol,
    name: snap.name,
    marketType: snap.marketType,
    sector: snap.sector,
    recommendedProfile: snap.recommendedProfile,
    price,
    annualizedVolPct: vol,
    atr20: snap.atr20 ?? Math.max(0.5, Number((price * 0.025).toFixed(2))),
    ma50: snap.ma50 ?? price,
    ma120: snap.ma120 ?? price,
    ma200: snap.ma200 ?? price,
    daysBelow200Ma: snap.daysBelow200Ma,
    roicPct: snap.ratios.roic3yAvgPct ?? 0,
    gpaPct: snap.ratios.gpaPct ?? 0,
    ocfToNiPct: snap.ratios.ocfToNi3yPct ?? 0,
    piotroskiRaw: snap.ratios.piotroskiRaw ?? 0,
    evToEbitda: snap.ratios.evToEbitda ?? 0,
    fcfYieldPct: snap.ratios.fcfYieldPct ?? 0,
    trailingPe: snap.ratios.trailingPe ?? 0,
    forwardPe: snap.ratios.forwardPe,
    dividendYieldPct: snap.ratios.dividendYieldPct ?? 0,
    consecutive5yDividend: snap.ratios.consecutive5yDividend ?? false,
    mom12m1mSharpe: snap.ratios.mom12m1mSharpe ?? 0,
    rev3mCumYoYPct: snap.ratios.rev3mCumYoYPct ?? 0,
    rev12mCumYoYPct: snap.ratios.rev12mCumYoYPct ?? 0,
    trendSlopeScore: snap.ratios.trendVsMa200Pct ?? 0,
    stageZeroInput: snap.stageZeroMetrics,
    cyclicalMetrics: snap.cyclicalMetrics,
    financialMetrics: snap.financialMetrics ?? undefined,
    dataQuality: snap.dataQuality,
    healthReport: snap.healthReport ?? undefined,
  };
}

export async function fetchStaticManifest(): Promise<ManifestData> {
  const res = await fetch(`./data/manifest.json?t=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`無法載入靜態數據清單 manifest.json (HTTP ${res.status})`);
  }
  return (await res.json()) as ManifestData;
}

export async function fetchStaticStocksBundle(): Promise<StocksBundleData> {
  const res = await fetch(`./data/stocks_bundle.json?t=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`無法載入真實台股數據包 stocks_bundle.json (HTTP ${res.status})`);
  }
  return (await res.json()) as StocksBundleData;
}

export const CsvTwStockSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  marketType: z.enum(['twse', 'tpex']).default('twse'),
  sector: z.string().min(1),
  price: z.coerce.number().positive(),
  annualizedVolPct: z.coerce.number().positive().default(25),
  atr20: z.coerce.number().nonnegative().default(5),
  ma50: z.coerce.number().positive().default(100),
  ma120: z.coerce.number().positive().default(100),
  ma200: z.coerce.number().positive().default(100),
  roicPct: z.coerce.number().default(12),
  gpaPct: z.coerce.number().default(25),
  ocfToNiPct: z.coerce.number().default(100),
  piotroskiRaw: z.coerce.number().min(0).max(9).default(6),
  evToEbitda: z.coerce.number().default(14),
  fcfYieldPct: z.coerce.number().default(4),
  trailingPe: z.coerce.number().default(18),
  dividendYieldPct: z.coerce.number().default(2.5),
  mom12m1mSharpe: z.coerce.number().default(0.8),
  rev3mCumYoYPct: z.coerce.number().default(8),
  rev12mCumYoYPct: z.coerce.number().default(5),
  trendSlopeScore: z.coerce.number().default(5),
  beneishMScore: z.coerce.number().default(-2.3),
  altmanZScore: z.coerce.number().default(3.5),
  cumulative3yOCF: z.coerce.number().default(1_000_000_000),
  directorPledgeRatio: z.coerce.number().default(5),
  avgDailyTurnover20dTWD: z.coerce.number().default(200_000_000),
});

export function parseTwCsvUniverse(csvText: string): {
  stocks: TwStockCandidate[];
  errors: string[];
} {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { stocks: [], errors: ['CSV 至少須包含標題列與一筆資料列。'] };
  }
  const headers = lines[0].split(',').map((h) => h.trim());
  const stocks: TwStockCandidate[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (cols[idx] !== undefined && cols[idx] !== '') obj[h] = cols[idx];
    });
    const parsed = CsvTwStockSchema.safeParse(obj);
    if (!parsed.success) {
      errors.push(
        `第 ${i + 1} 列驗證失敗：${parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`
      );
      continue;
    }
    const d = parsed.data;
    stocks.push({
      id: `TW-${d.symbol.toUpperCase()}`,
      symbol: d.symbol.toUpperCase(),
      name: d.name,
      marketType: d.marketType,
      sector: d.sector,
      recommendedProfile: 'standard',
      price: d.price,
      annualizedVolPct: d.annualizedVolPct,
      atr20: d.atr20,
      ma50: d.ma50,
      ma120: d.ma120,
      ma200: d.ma200,
      daysBelow200Ma: 0,
      roicPct: d.roicPct,
      gpaPct: d.gpaPct,
      ocfToNiPct: d.ocfToNiPct,
      piotroskiRaw: d.piotroskiRaw,
      evToEbitda: d.evToEbitda,
      fcfYieldPct: d.fcfYieldPct,
      trailingPe: d.trailingPe,
      forwardPe: null,
      dividendYieldPct: d.dividendYieldPct,
      consecutive5yDividend: true,
      mom12m1mSharpe: d.mom12m1mSharpe,
      rev3mCumYoYPct: d.rev3mCumYoYPct,
      rev12mCumYoYPct: d.rev12mCumYoYPct,
      trendSlopeScore: d.trendSlopeScore,
      stageZeroInput: {
        price: d.price,
        isManufacturing: true,
        beneishMScore: d.beneishMScore,
        altmanZScore: d.altmanZScore,
        altmanZDoublePrime: null,
        cumulative3yOCF: d.cumulative3yOCF,
        hasAuditOrGovernanceRedFlag: null,
        isFullCashDeliveryOrSuspended: null,
        directorPledgeRatio: d.directorPledgeRatio,
        directorInsufficientHoldingMonths: null,
        avgDailyTurnover20dTWD: d.avgDailyTurnover20dTWD,
        isDispositionStock: null,
        shareDilution3yPct: 0,
        isRoicDeclining: false,
        consecutive2qArOrInvBloat: false,
      },
      cyclicalMetrics: createEmptyCyclicalMetrics(),
    });
  }
  return { stocks, errors };
}

export function generateTwCsvTemplate(): string {
  const header = [
    'symbol',
    'name',
    'marketType',
    'sector',
    'price',
    'annualizedVolPct',
    'atr20',
    'ma50',
    'ma120',
    'ma200',
    'roicPct',
    'gpaPct',
    'ocfToNiPct',
    'piotroskiRaw',
    'evToEbitda',
    'fcfYieldPct',
    'trailingPe',
    'dividendYieldPct',
    'mom12m1mSharpe',
    'rev3mCumYoYPct',
    'rev12mCumYoYPct',
    'trendSlopeScore',
    'beneishMScore',
    'altmanZScore',
    'cumulative3yOCF',
    'directorPledgeRatio',
    'avgDailyTurnover20dTWD',
  ].join(',');

  return `${header}\n`;
}
