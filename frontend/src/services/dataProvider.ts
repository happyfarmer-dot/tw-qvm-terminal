import { z } from 'zod';
import { MOCK_TW_STOCKS } from '../data/mockTwStocks';
import type {
  BenchmarkRegimeInput,
  CyclicalMetrics,
  DataQuality,
  FinancialSectorMetrics,
  MarketRegime,
  StageZeroInput,
  TwStockCandidate,
  ValuationProfile,
} from '../engine/types';

export type DataSourceMode = 'mock' | 'live';

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

export interface BackendHealth {
  status: 'ok';
  finmindTier: 'free' | 'backer';
  finmindTokenConfigured: boolean;
  cacheStats: {
    totalEntries: number;
    validEntries: number;
    dbPath: string;
  };
}

export interface BackendRegimePayload {
  regime: MarketRegime;
  indexSymbol: string;
  indexClose: number | null;
  ma200: number | null;
  drawdown20dPct: number | null;
  annualizedVol20dPct: number | null;
  reasons: string[];
  fromCache: boolean;
}

export interface BackendStockSnapshot {
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
}

export function mapSnapshotToCandidate(snap: BackendStockSnapshot): TwStockCandidate {
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
    roicPct: snap.ratios.roic3yAvgPct ?? 10,
    gpaPct: snap.ratios.gpaPct ?? 20,
    ocfToNiPct: snap.ratios.ocfToNi3yPct ?? 90,
    piotroskiRaw: snap.ratios.piotroskiRaw ?? 5,
    evToEbitda: snap.ratios.evToEbitda ?? 14,
    fcfYieldPct: snap.ratios.fcfYieldPct ?? 3,
    trailingPe: snap.ratios.trailingPe ?? 18,
    forwardPe: snap.ratios.forwardPe,
    dividendYieldPct: snap.ratios.dividendYieldPct ?? 2,
    consecutive5yDividend: snap.ratios.consecutive5yDividend ?? false,
    mom12m1mSharpe: snap.ratios.mom12m1mSharpe ?? 0.5,
    rev3mCumYoYPct: snap.ratios.rev3mCumYoYPct ?? 0,
    rev12mCumYoYPct: snap.ratios.rev12mCumYoYPct ?? 0,
    trendSlopeScore: snap.ratios.trendVsMa200Pct ?? 0,
    stageZeroInput: snap.stageZeroMetrics,
    cyclicalMetrics: snap.cyclicalMetrics,
    financialMetrics: snap.financialMetrics ?? undefined,
    dataQuality: snap.dataQuality,
  };
}

export class TwDataProvider {
  private readonly baseUrl: string;

  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async checkHealth(): Promise<BackendHealth> {
    const res = await fetch(`${this.baseUrl}/api/v1/health`);
    if (!res.ok) throw new Error(`後端連線失敗 (HTTP ${res.status})`);
    return (await res.json()) as BackendHealth;
  }

  async fetchRegime(forceRefresh = false): Promise<BenchmarkRegimeInput & { regime: MarketRegime; reasons: string[] }> {
    const res = await fetch(`${this.baseUrl}/api/v1/regime?force_refresh=${forceRefresh}`);
    if (!res.ok) throw new Error(`無法取得大盤體制 (HTTP ${res.status})`);
    const data = (await res.json()) as BackendRegimePayload;
    return {
      regime: data.regime,
      reasons: data.reasons,
      indexClose: data.indexClose ?? 22000,
      ma200: data.ma200 ?? 21000,
      drawdown20dPct: data.drawdown20dPct ?? 0,
      annualizedVol20dPct: data.annualizedVol20dPct ?? 15,
    };
  }

  async fetchStock(symbol: string, forceRefresh = false): Promise<BackendStockSnapshot> {
    const clean = symbol.trim().toUpperCase();
    const res = await fetch(
      `${this.baseUrl}/api/v1/stock/${encodeURIComponent(clean)}?force_refresh=${forceRefresh}`
    );
    if (!res.ok) throw new Error(`無法取得 ${clean} 資料 (HTTP ${res.status})`);
    return (await res.json()) as BackendStockSnapshot;
  }

  async getRegulatoryData(symbol: string): Promise<RegulatoryOverridePayload> {
    const clean = symbol.trim().toUpperCase();
    const res = await fetch(
      `${this.baseUrl}/api/v1/stock/${encodeURIComponent(clean)}/regulatory-data`
    );
    if (!res.ok) throw new Error(`無法取得 ${clean} 監理資料 (HTTP ${res.status})`);
    return (await res.json()) as RegulatoryOverridePayload;
  }

  async saveRegulatoryData(
    symbol: string,
    payload: RegulatoryOverridePayload
  ): Promise<RegulatoryOverridePayload> {
    const clean = symbol.trim().toUpperCase();
    const res = await fetch(
      `${this.baseUrl}/api/v1/stock/${encodeURIComponent(clean)}/regulatory-data`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) throw new Error(`儲存 ${clean} 監理資料失敗 (HTTP ${res.status})`);
    return (await res.json()) as RegulatoryOverridePayload;
  }

  async fetchBatch(
    symbols: string[],
    forceRefresh = false
  ): Promise<{ results: BackendStockSnapshot[]; errors: { symbol: string; error: string }[] }> {
    const res = await fetch(`${this.baseUrl}/api/v1/stocks/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols, force_refresh: forceRefresh }),
    });
    if (!res.ok) throw new Error(`批次抓取失敗 (HTTP ${res.status})`);
    return (await res.json()) as {
      results: BackendStockSnapshot[];
      errors: { symbol: string; error: string }[];
    };
  }

  async clearCache(symbol?: string): Promise<{ deletedCount: number }> {
    const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
    const res = await fetch(`${this.baseUrl}/api/v1/cache${qs}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`清除快取失敗 (HTTP ${res.status})`);
    return (await res.json()) as { deletedCount: number };
  }

  async fetchMockStock(symbol: string): Promise<TwStockCandidate | null> {
    const clean = symbol.trim().toUpperCase();
    return MOCK_TW_STOCKS.find((s) => s.symbol === clean) ?? null;
  }
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
    const baseTemplate = MOCK_TW_STOCKS[0].cyclicalMetrics;
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
      cyclicalMetrics: { ...baseTemplate },
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

  const sample = [
    '2317',
    '鴻海',
    'twse',
    '其他電子業',
    '212',
    '31.2',
    '6.5',
    '204',
    '192',
    '182',
    '14.5',
    '18.5',
    '112',
    '7',
    '11.4',
    '5.1',
    '16.2',
    '2.8',
    '1.35',
    '15.4',
    '11.2',
    '16.4',
    '-2.32',
    '3.8',
    '380000000000',
    '2.5',
    '12000000000',
  ].join(',');

  return `${header}\n${sample}\n`;
}
