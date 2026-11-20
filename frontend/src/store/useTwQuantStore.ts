import { create } from 'zustand';
import {
  DEFAULT_FINANCIAL_METRICS,
  DEFAULT_MANUAL_SCORECARD,
  DEFAULT_STAGE_ZERO_INPUT,
  DEFAULT_TW_BENCHMARK,
  MOCK_TW_HOLDINGS,
  MOCK_TW_STOCKS,
} from '../data/mockTwStocks';
import { evaluateCyclicalRating } from '../engine/cyclicalScoring';
import { evaluateFinancialRating } from '../engine/financialScoring';
import { evaluateRating } from '../engine/ratingAndRegime';
import { evaluateStageZero } from '../engine/stageZero';
import type {
  BenchmarkRegimeInput,
  CyclicalMetrics,
  DataQuality,
  FinancialSectorMetrics,
  HoldingPosition,
  ManualScorecardInput,
  MarketRegime,
  SizingConfig,
  StageZeroInput,
  TwFrictionConfig,
  TwStockCandidate,
  ValuationProfile,
} from '../engine/types';
import {
  mapSnapshotToCandidate,
  TwDataProvider,
  type BackendStockSnapshot,
  type DataSourceMode,
} from '../services/dataProvider';
import {
  loadPersistedTwState,
  savePersistedTwState,
  type PersistedTwState,
} from '../services/storage';

export type NavTab = 'dashboard' | 'scorecard' | 'screener' | 'portfolio' | 'sizer';

interface TwQuantState {
  activeTab: NavTab;
  dataSourceMode: DataSourceMode;
  backendUrl: string;
  regime: MarketRegime;
  benchmark: BenchmarkRegimeInput;
  universe: TwStockCandidate[];
  holdings: HoldingPosition[];
  selectedSizingIds: string[];
  sizingConfig: SizingConfig;
  frictionConfig: TwFrictionConfig;

  // Scorecard draft
  manualSymbol: string;
  manualName: string;
  manualSector: string;
  manualPrice: number;
  manualMa120: number;
  manualMa200: number;
  manualRev3mYoY: number;
  manualRev12mYoY: number;
  manualTrailingPe: number | null;
  manualForwardEps: number | null;
  manualProfile: ValuationProfile;
  recommendedProfile: ValuationProfile;
  manualScorecard: ManualScorecardInput;
  manualStageZero: StageZeroInput;
  manualCyclicalMetrics: CyclicalMetrics;
  manualFinancialMetrics: FinancialSectorMetrics;
  customKePct: number;
  customPayoutPct: number | null;
  manualDataQuality?: DataQuality;

  // Actions
  setActiveTab: (tab: NavTab) => void;
  setDataSourceMode: (mode: DataSourceMode) => void;
  setBackendUrl: (url: string) => void;
  setRegime: (regime: MarketRegime) => void;
  updateBenchmark: (patch: Partial<BenchmarkRegimeInput>) => void;
  upsertUniverseStocks: (stocks: TwStockCandidate[]) => void;
  addHolding: (holding: HoldingPosition) => void;
  updateHolding: (id: string, patch: Partial<HoldingPosition>) => void;
  removeHolding: (id: string) => void;
  toggleSizingSelection: (id: string) => void;
  setSelectedSizingIds: (ids: string[]) => void;
  updateSizingConfig: (patch: Partial<SizingConfig>) => void;
  updateFrictionConfig: (patch: Partial<TwFrictionConfig>) => void;
  setManualProfile: (profile: ValuationProfile) => void;
  updateManualMeta: (patch: {
    symbol?: string;
    name?: string;
    sector?: string;
    price?: number;
    ma120?: number;
    ma200?: number;
    rev3mYoY?: number;
    rev12mYoY?: number;
    forwardEps?: number | null;
  }) => void;
  updateManualScorecard: (patch: Partial<ManualScorecardInput>) => void;
  updateManualStageZero: (patch: Partial<StageZeroInput>) => void;
  updateManualCyclicalMetrics: (patch: Partial<CyclicalMetrics>) => void;
  updateManualFinancialMetrics: (patch: Partial<FinancialSectorMetrics>) => void;
  setJustifiedPbSensitivity: (patch: { kePct?: number; payoutPct?: number | null }) => void;
  loadCandidateIntoScorecard: (stock: TwStockCandidate, profileOverride?: ValuationProfile) => void;
  loadBackendSnapshotIntoScorecard: (snap: BackendStockSnapshot) => void;
  loadSnapshot: (snapshot: PersistedTwState) => void;
  resetToDefaults: () => void;
  getPersistedSnapshot: () => PersistedTwState;
  getProvider: () => TwDataProvider;
}

const persisted = loadPersistedTwState();

function persist(s: TwQuantState): void {
  savePersistedTwState({
    version: 1,
    dataSourceMode: s.dataSourceMode,
    backendUrl: s.backendUrl,
    regime: s.regime,
    benchmark: s.benchmark,
    universe: s.universe,
    holdings: s.holdings,
    selectedSizingIds: s.selectedSizingIds,
    sizingConfig: s.sizingConfig,
    frictionConfig: s.frictionConfig,
    manualSymbol: s.manualSymbol,
    manualName: s.manualName,
    manualSector: s.manualSector,
    manualPrice: s.manualPrice,
    manualMa120: s.manualMa120,
    manualMa200: s.manualMa200,
    manualRev3mYoY: s.manualRev3mYoY,
    manualRev12mYoY: s.manualRev12mYoY,
    manualTrailingPe: s.manualTrailingPe,
    manualForwardEps: s.manualForwardEps,
    manualProfile: s.manualProfile,
    recommendedProfile: s.recommendedProfile,
    manualScorecard: s.manualScorecard,
    manualStageZero: s.manualStageZero,
    manualCyclicalMetrics: s.manualCyclicalMetrics,
    manualFinancialMetrics: s.manualFinancialMetrics,
    customKePct: s.customKePct,
    customPayoutPct: s.customPayoutPct,
    manualDataQuality: s.manualDataQuality,
  });
}

function buildManualFromCandidate(stock: TwStockCandidate): Partial<TwQuantState> {
  const revImproving = stock.rev3mCumYoYPct > 0 && stock.rev3mCumYoYPct > stock.rev12mCumYoYPct;
  const finMetrics = stock.financialMetrics
    ? { ...stock.financialMetrics }
    : {
        ...DEFAULT_FINANCIAL_METRICS,
        currentPB: stock.cyclicalMetrics.currentPB,
        pbPercentile5to7Y: stock.cyclicalMetrics.pbPercentile5to7Y,
        pbBand: { ...stock.cyclicalMetrics.pbBand },
        cashDividendYieldPct: stock.dividendYieldPct,
        netRevenue3mYoY: stock.rev3mCumYoYPct,
        netRevenue12mYoY: stock.rev12mCumYoYPct,
        biasFromMa200Pct: stock.cyclicalMetrics.biasFromMa200Pct,
      };
  const keDefault =
    stock.recommendedProfile === 'financial_life_fhc' ? 9.5 : 8.0;

  return {
    manualSymbol: stock.symbol,
    manualName: stock.name,
    manualSector: stock.sector,
    manualPrice: stock.price,
    manualMa120: stock.ma120,
    manualMa200: stock.ma200,
    manualRev3mYoY: stock.rev3mCumYoYPct,
    manualRev12mYoY: stock.rev12mCumYoYPct,
    manualTrailingPe: stock.trailingPe,
    manualForwardEps: null,
    manualProfile: stock.recommendedProfile,
    recommendedProfile: stock.recommendedProfile,
    manualStageZero: { ...stock.stageZeroInput },
    manualCyclicalMetrics: { ...stock.cyclicalMetrics },
    manualFinancialMetrics: finMetrics,
    customKePct: stock.financialMetrics ? stock.financialMetrics.defaultKe * 100 : keDefault,
    customPayoutPct: finMetrics.avgPayoutRatio5Y,
    manualDataQuality: stock.dataQuality,
    manualScorecard: {
      q1RoicScore: stock.roicPct >= 15 ? 12 : stock.roicPct >= 12 ? 10 : stock.roicPct >= 8 ? 7 : 2,
      q2GpaScore: stock.gpaPct >= 30 ? 9 : stock.gpaPct >= 20 ? 6 : 2,
      q3OcfNiScore: stock.ocfToNiPct >= 100 ? 10 : stock.ocfToNiPct >= 80 ? 7 : 2,
      piotroskiChecks: {
        positiveRoa: stock.piotroskiRaw >= 1,
        roaImproving: stock.piotroskiRaw >= 2,
        positiveOcf: stock.piotroskiRaw >= 3,
        ocfGreaterThanNetIncome: stock.piotroskiRaw >= 4,
        lowerLongTermDebtRatio: stock.piotroskiRaw >= 5,
        higherCurrentRatio: stock.piotroskiRaw >= 6,
        noShareDilution: stock.piotroskiRaw >= 7,
        higherGrossMargin: stock.piotroskiRaw >= 8,
        higherAssetTurnover: stock.piotroskiRaw >= 9,
      },
      v1EvMultipleScore: stock.evToEbitda <= 12 ? 14 : stock.evToEbitda <= 18 ? 10 : 3,
      v2FcfEvScore: stock.fcfYieldPct >= 6 ? 12 : stock.fcfYieldPct >= 3.5 ? 8 : 2,
      v3DivAndPeScore:
        stock.consecutive5yDividend && (stock.forwardPe ?? stock.trailingPe) <= 20
          ? 8
          : stock.consecutive5yDividend
            ? 5
            : 1,
      m1PriceMomScore: stock.mom12m1mSharpe >= 1.2 ? 9 : stock.mom12m1mSharpe >= 0.4 ? 5 : 1,
      m2FundMomScore: revImproving ? 9 : stock.rev3mCumYoYPct > 0 ? 5 : 1,
      m3TrendFilterScore:
        stock.trendSlopeScore >= 5 ? 5 : stock.trendSlopeScore >= -3 ? 2.5 : 0,
    },
  };
}

export const useTwQuantStore = create<TwQuantState>((set, get) => ({
  activeTab: 'dashboard',
  dataSourceMode: persisted?.dataSourceMode ?? 'mock',
  backendUrl: persisted?.backendUrl ?? 'http://localhost:8000',
  regime: persisted?.regime ?? 'NORMAL',
  benchmark: persisted?.benchmark ?? DEFAULT_TW_BENCHMARK,
  universe: persisted?.universe ?? MOCK_TW_STOCKS,
  holdings: persisted?.holdings ?? MOCK_TW_HOLDINGS,
  selectedSizingIds: persisted?.selectedSizingIds ?? [
    'TW-2330',
    'TW-2308',
    'TW-2382',
    'TW-2345',
    'TW-3131',
    'TW-2886',
  ],
  sizingConfig: persisted?.sizingConfig ?? {
    totalActiveCapital: 3_000_000,
    portfolioMode: 'SATELLITE',
    minWeightPct: 4,
    maxWeightPct: 22,
    sectorCapPct: 28,
    applySectorScaling: true,
  },
  frictionConfig: persisted?.frictionConfig ?? {
    feeDiscount: 0.6,
    applyMinFee20: true,
    slippageRoundTripPct: 0.15,
  },
  manualSymbol: persisted?.manualSymbol ?? MOCK_TW_STOCKS[0].symbol,
  manualName: persisted?.manualName ?? MOCK_TW_STOCKS[0].name,
  manualSector: persisted?.manualSector ?? MOCK_TW_STOCKS[0].sector,
  manualPrice: persisted?.manualPrice ?? MOCK_TW_STOCKS[0].price,
  manualMa120: persisted?.manualMa120 ?? MOCK_TW_STOCKS[0].ma120,
  manualMa200: persisted?.manualMa200 ?? MOCK_TW_STOCKS[0].ma200,
  manualRev3mYoY: persisted?.manualRev3mYoY ?? MOCK_TW_STOCKS[0].rev3mCumYoYPct,
  manualRev12mYoY: persisted?.manualRev12mYoY ?? MOCK_TW_STOCKS[0].rev12mCumYoYPct,
  manualTrailingPe: persisted?.manualTrailingPe ?? MOCK_TW_STOCKS[0].trailingPe,
  manualForwardEps: persisted?.manualForwardEps ?? null,
  manualProfile: persisted?.manualProfile ?? 'standard',
  recommendedProfile: persisted?.recommendedProfile ?? 'standard',
  manualScorecard: persisted?.manualScorecard ?? DEFAULT_MANUAL_SCORECARD,
  manualStageZero: persisted?.manualStageZero ?? DEFAULT_STAGE_ZERO_INPUT,
  manualCyclicalMetrics:
    persisted?.manualCyclicalMetrics ?? MOCK_TW_STOCKS[0].cyclicalMetrics,
  manualFinancialMetrics:
    persisted?.manualFinancialMetrics ?? DEFAULT_FINANCIAL_METRICS,
  customKePct: persisted?.customKePct ?? 8.0,
  customPayoutPct: persisted?.customPayoutPct ?? 62.0,
  manualDataQuality: persisted?.manualDataQuality,

  setActiveTab: (activeTab) => set({ activeTab }),

  setDataSourceMode: (dataSourceMode) => {
    set({ dataSourceMode });
    persist(get());
  },

  setBackendUrl: (backendUrl) => {
    set({ backendUrl });
    persist(get());
  },

  setRegime: (regime) => {
    set((s) => ({
      regime,
      holdings: s.holdings.map((h) => {
        const stockMatch = s.universe.find((u) => u.symbol === h.symbol);
        const szInput = stockMatch?.stageZeroInput ?? DEFAULT_STAGE_ZERO_INPUT;
        const sz = evaluateStageZero(szInput, h.valuationProfile);
        const isCyc =
          h.valuationProfile === 'cyclical_heavy_asset' ||
          h.valuationProfile === 'cyclical_inventory_order';
        const isFin =
          h.valuationProfile === 'financial_bank' ||
          h.valuationProfile === 'financial_life_fhc';

        const cycRating =
          isCyc && h.cyclicalMetrics
            ? evaluateCyclicalRating({
                profile: h.valuationProfile as 'cyclical_heavy_asset' | 'cyclical_inventory_order',
                regime,
                stageZero: sz,
                metrics: h.cyclicalMetrics,
                price: h.currentPrice,
                ma120: h.ma120,
                ma200: h.ma200,
                rev3mCumYoYPct: 0,
                rev12mCumYoYPct: 0,
              })
            : undefined;

        const finRating =
          isFin && h.financialMetrics
            ? evaluateFinancialRating({
                profile: h.valuationProfile as 'financial_bank' | 'financial_life_fhc',
                regime,
                commonStageZeroInput: szInput,
                metrics: h.financialMetrics,
                price: h.currentPrice,
                ma200: h.ma200,
              })
            : undefined;

        return {
          ...h,
          currentRating: evaluateRating({ breakdown: h.currentBreakdown, regime, stageZero: sz }),
          cyclicalRating: cycRating,
          financialRating: finRating,
        };
      }),
    }));
    persist(get());
  },

  updateBenchmark: (patch) => {
    set((s) => ({ benchmark: { ...s.benchmark, ...patch } }));
    persist(get());
  },

  upsertUniverseStocks: (incoming) => {
    set((s) => {
      const map = new Map(s.universe.map((u) => [u.symbol, u]));
      incoming.forEach((st) => map.set(st.symbol, st));
      return { universe: Array.from(map.values()) };
    });
    persist(get());
  },

  addHolding: (holding) => {
    set((s) => ({ holdings: [holding, ...s.holdings.filter((h) => h.id !== holding.id)] }));
    persist(get());
  },

  updateHolding: (id, patch) => {
    set((s) => ({
      holdings: s.holdings.map((h) => {
        if (h.id !== id) return h;
        const merged = { ...h, ...patch };
        const sz = patch.currentRating?.stageZero ?? merged.currentRating.stageZero;
        const bd = patch.currentBreakdown ?? merged.currentBreakdown;
        const isCyc =
          merged.valuationProfile === 'cyclical_heavy_asset' ||
          merged.valuationProfile === 'cyclical_inventory_order';
        const isFin =
          merged.valuationProfile === 'financial_bank' ||
          merged.valuationProfile === 'financial_life_fhc';
        const cycRating =
          isCyc && merged.cyclicalMetrics
            ? evaluateCyclicalRating({
                profile: merged.valuationProfile as 'cyclical_heavy_asset' | 'cyclical_inventory_order',
                regime: s.regime,
                stageZero: sz,
                metrics: merged.cyclicalMetrics,
                price: merged.currentPrice,
                ma120: merged.ma120,
                ma200: merged.ma200,
                rev3mCumYoYPct: 0,
                rev12mCumYoYPct: 0,
              })
            : undefined;
        const finRating =
          isFin && merged.financialMetrics
            ? evaluateFinancialRating({
                profile: merged.valuationProfile as 'financial_bank' | 'financial_life_fhc',
                regime: s.regime,
                commonStageZeroInput:
                  s.universe.find((u) => u.symbol === merged.symbol)?.stageZeroInput ??
                  DEFAULT_STAGE_ZERO_INPUT,
                metrics: merged.financialMetrics,
                price: merged.currentPrice,
                ma200: merged.ma200,
              })
            : undefined;
        return {
          ...merged,
          currentBreakdown: bd,
          currentRating: evaluateRating({ breakdown: bd, regime: s.regime, stageZero: sz }),
          cyclicalRating: cycRating,
          financialRating: finRating,
        };
      }),
    }));
    persist(get());
  },

  removeHolding: (id) => {
    set((s) => ({ holdings: s.holdings.filter((h) => h.id !== id) }));
    persist(get());
  },

  toggleSizingSelection: (id) => {
    set((s) => ({
      selectedSizingIds: s.selectedSizingIds.includes(id)
        ? s.selectedSizingIds.filter((x) => x !== id)
        : [...s.selectedSizingIds, id],
    }));
    persist(get());
  },

  setSelectedSizingIds: (selectedSizingIds) => {
    set({ selectedSizingIds });
    persist(get());
  },

  updateSizingConfig: (patch) => {
    set((s) => ({ sizingConfig: { ...s.sizingConfig, ...patch } }));
    persist(get());
  },

  updateFrictionConfig: (patch) => {
    set((s) => ({ frictionConfig: { ...s.frictionConfig, ...patch } }));
    persist(get());
  },

  setManualProfile: (manualProfile) => {
    set((s) => ({
      manualProfile,
      customKePct:
        manualProfile === 'financial_life_fhc'
          ? 9.5
          : manualProfile === 'financial_bank'
            ? 8.0
            : s.customKePct,
    }));
    persist(get());
  },

  updateManualMeta: (patch) => {
    set((s) => ({
      manualSymbol: patch.symbol ?? s.manualSymbol,
      manualName: patch.name ?? s.manualName,
      manualSector: patch.sector ?? s.manualSector,
      manualPrice: patch.price ?? s.manualPrice,
      manualMa120: patch.ma120 ?? s.manualMa120,
      manualMa200: patch.ma200 ?? s.manualMa200,
      manualRev3mYoY: patch.rev3mYoY ?? s.manualRev3mYoY,
      manualRev12mYoY: patch.rev12mYoY ?? s.manualRev12mYoY,
      manualForwardEps:
        patch.forwardEps !== undefined ? patch.forwardEps : s.manualForwardEps,
      manualStageZero:
        patch.price !== undefined
          ? { ...s.manualStageZero, price: patch.price }
          : s.manualStageZero,
    }));
    persist(get());
  },

  updateManualScorecard: (patch) => {
    set((s) => ({ manualScorecard: { ...s.manualScorecard, ...patch } }));
    persist(get());
  },

  updateManualStageZero: (patch) => {
    set((s) => ({ manualStageZero: { ...s.manualStageZero, ...patch } }));
    persist(get());
  },

  updateManualCyclicalMetrics: (patch) => {
    set((s) => ({ manualCyclicalMetrics: { ...s.manualCyclicalMetrics, ...patch } }));
    persist(get());
  },

  updateManualFinancialMetrics: (patch) => {
    set((s) => ({ manualFinancialMetrics: { ...s.manualFinancialMetrics, ...patch } }));
    persist(get());
  },

  setJustifiedPbSensitivity: (patch) => {
    set((s) => ({
      customKePct: patch.kePct !== undefined ? patch.kePct : s.customKePct,
      customPayoutPct:
        patch.payoutPct !== undefined ? patch.payoutPct : s.customPayoutPct,
    }));
    persist(get());
  },

  loadCandidateIntoScorecard: (stock, profileOverride) => {
    const built = buildManualFromCandidate(stock);
    set({
      activeTab: 'scorecard',
      ...built,
      manualProfile: profileOverride ?? stock.recommendedProfile,
    });
    persist(get());
  },

  loadBackendSnapshotIntoScorecard: (snap) => {
    const candidate = mapSnapshotToCandidate(snap);
    const built = buildManualFromCandidate(candidate);
    set((s) => {
      const map = new Map(s.universe.map((u) => [u.symbol, u]));
      map.set(candidate.symbol, candidate);
      return {
        ...built,
        universe: Array.from(map.values()),
        manualTrailingPe: snap.ratios.trailingPe,
        manualDataQuality: snap.dataQuality,
      };
    });
    persist(get());
  },

  loadSnapshot: (snapshot) => {
    set({ ...snapshot });
    persist(get());
  },

  resetToDefaults: () => {
    set({
      dataSourceMode: 'mock',
      backendUrl: 'http://localhost:8000',
      regime: 'NORMAL',
      benchmark: DEFAULT_TW_BENCHMARK,
      universe: MOCK_TW_STOCKS,
      holdings: MOCK_TW_HOLDINGS,
      selectedSizingIds: ['TW-2330', 'TW-2308', 'TW-2382', 'TW-2345', 'TW-3131', 'TW-2886'],
      sizingConfig: {
        totalActiveCapital: 3_000_000,
        portfolioMode: 'SATELLITE',
        minWeightPct: 4,
        maxWeightPct: 22,
        sectorCapPct: 28,
        applySectorScaling: true,
      },
      frictionConfig: {
        feeDiscount: 0.6,
        applyMinFee20: true,
        slippageRoundTripPct: 0.15,
      },
      ...buildManualFromCandidate(MOCK_TW_STOCKS[0]),
      manualProfile: 'standard',
    });
    persist(get());
  },

  getPersistedSnapshot: () => {
    const s = get();
    return {
      version: 1,
      dataSourceMode: s.dataSourceMode,
      backendUrl: s.backendUrl,
      regime: s.regime,
      benchmark: s.benchmark,
      universe: s.universe,
      holdings: s.holdings,
      selectedSizingIds: s.selectedSizingIds,
      sizingConfig: s.sizingConfig,
      frictionConfig: s.frictionConfig,
      manualSymbol: s.manualSymbol,
      manualName: s.manualName,
      manualSector: s.manualSector,
      manualPrice: s.manualPrice,
      manualMa120: s.manualMa120,
      manualMa200: s.manualMa200,
      manualRev3mYoY: s.manualRev3mYoY,
      manualRev12mYoY: s.manualRev12mYoY,
      manualTrailingPe: s.manualTrailingPe,
      manualForwardEps: s.manualForwardEps,
      manualProfile: s.manualProfile,
      recommendedProfile: s.recommendedProfile,
      manualScorecard: s.manualScorecard,
      manualStageZero: s.manualStageZero,
      manualCyclicalMetrics: s.manualCyclicalMetrics,
      manualFinancialMetrics: s.manualFinancialMetrics,
      customKePct: s.customKePct,
      customPayoutPct: s.customPayoutPct,
      manualDataQuality: s.manualDataQuality,
    };
  },

  getProvider: () => new TwDataProvider(get().backendUrl),
}));
