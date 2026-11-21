import { create } from 'zustand';
import { evaluateCyclicalRating } from '../engine/cyclicalScoring';
import { evaluateFinancialRating } from '../engine/financialScoring';
import { evaluateRating } from '../engine/ratingAndRegime';
import { rankBatchWithZScore } from '../engine/scoringBatchZ';
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
  createDefaultBenchmark,
  createEmptyCyclicalMetrics,
  createEmptyFinancialMetrics,
  createEmptyManualScorecard,
  createEmptyStageZeroInput,
  fetchStaticManifest,
  fetchStaticStocksBundle,
  mapSnapshotToCandidate,
  mergeRegulatoryIntoSnapshot,
  type ManifestData,
  type RegulatoryOverridePayload,
  type StaticStockSnapshot,
} from '../services/staticDataService';
import {
  loadPersistedTwState,
  savePersistedTwState,
  type PersistedTwState,
} from '../services/storage';

export type NavTab = 'dashboard' | 'scorecard' | 'screener' | 'portfolio' | 'sizer';

interface TwQuantState {
  activeTab: NavTab;
  manifest: ManifestData | null;
  rawSnapshots: StaticStockSnapshot[];
  dataLoading: boolean;
  dataError: string | null;

  regime: MarketRegime;
  benchmark: BenchmarkRegimeInput;
  universe: TwStockCandidate[];
  holdings: HoldingPosition[];
  regulatoryOverrides: Record<string, RegulatoryOverridePayload>;
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
  loadStaticData: () => Promise<void>;
  setRegime: (regime: MarketRegime) => void;
  updateBenchmark: (patch: Partial<BenchmarkRegimeInput>) => void;
  upsertUniverseStocks: (stocks: TwStockCandidate[]) => void;
  addHolding: (holding: HoldingPosition) => void;
  updateHolding: (id: string, patch: Partial<HoldingPosition>) => void;
  removeHolding: (id: string) => void;
  saveLocalRegulatoryOverride: (symbol: string, payload: RegulatoryOverridePayload) => void;
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
  loadSnapshot: (snapshot: Partial<PersistedTwState>) => void;
  resetPersonalData: () => void;
  getPersistedSnapshot: () => PersistedTwState;
}

const persisted = loadPersistedTwState();

function persist(s: TwQuantState): void {
  savePersistedTwState({
    version: 2,
    regime: s.regime,
    holdings: s.holdings,
    regulatoryOverrides: s.regulatoryOverrides,
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
        ...createEmptyFinancialMetrics(),
        currentPB: stock.cyclicalMetrics.currentPB,
        pbPercentile5to7Y: stock.cyclicalMetrics.pbPercentile5to7Y,
        pbBand: { ...stock.cyclicalMetrics.pbBand },
        cashDividendYieldPct: stock.dividendYieldPct,
        netRevenue3mYoY: stock.rev3mCumYoYPct,
        netRevenue12mYoY: stock.rev12mCumYoYPct,
        biasFromMa200Pct: stock.cyclicalMetrics.biasFromMa200Pct,
      };
  const keDefault = stock.recommendedProfile === 'financial_life_fhc' ? 9.5 : 8.0;

  return {
    manualSymbol: stock.symbol,
    manualName: stock.name,
    manualSector: stock.sector,
    manualPrice: stock.price,
    manualMa120: stock.ma120,
    manualMa200: stock.ma200,
    manualRev3mYoY: stock.rev3mCumYoYPct,
    manualRev12mYoY: stock.rev12mCumYoYPct,
    manualTrailingPe: stock.trailingPe > 0 ? stock.trailingPe : null,
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
      v1EvMultipleScore: stock.evToEbitda > 0 && stock.evToEbitda <= 12 ? 14 : stock.evToEbitda <= 18 ? 10 : 3,
      v2FcfEvScore: stock.fcfYieldPct >= 6 ? 12 : stock.fcfYieldPct >= 3.5 ? 8 : 2,
      v3DivAndPeScore:
        stock.consecutive5yDividend && (stock.forwardPe ?? stock.trailingPe) > 0 && (stock.forwardPe ?? stock.trailingPe) <= 20
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

function buildUniverseFromSnapshots(
  snapshots: StaticStockSnapshot[],
  overrides: Record<string, RegulatoryOverridePayload>
): TwStockCandidate[] {
  return snapshots.map((snap) => {
    const merged = mergeRegulatoryIntoSnapshot(snap, overrides[snap.symbol]);
    return mapSnapshotToCandidate(merged);
  });
}

export const useTwQuantStore = create<TwQuantState>((set, get) => ({
  activeTab: 'dashboard',
  manifest: null,
  rawSnapshots: [],
  dataLoading: false,
  dataError: null,

  regime: persisted?.regime ?? 'NORMAL',
  benchmark: createDefaultBenchmark(),
  universe: [],
  holdings: persisted?.holdings ?? [],
  regulatoryOverrides: persisted?.regulatoryOverrides ?? {},
  selectedSizingIds: persisted?.selectedSizingIds ?? [],
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

  manualSymbol: persisted?.manualSymbol ?? '',
  manualName: persisted?.manualName ?? '',
  manualSector: persisted?.manualSector ?? '',
  manualPrice: persisted?.manualPrice ?? 0,
  manualMa120: persisted?.manualMa120 ?? 0,
  manualMa200: persisted?.manualMa200 ?? 0,
  manualRev3mYoY: persisted?.manualRev3mYoY ?? 0,
  manualRev12mYoY: persisted?.manualRev12mYoY ?? 0,
  manualTrailingPe: persisted?.manualTrailingPe ?? null,
  manualForwardEps: persisted?.manualForwardEps ?? null,
  manualProfile: persisted?.manualProfile ?? 'standard',
  recommendedProfile: persisted?.recommendedProfile ?? 'standard',
  manualScorecard: persisted?.manualScorecard ?? createEmptyManualScorecard(),
  manualStageZero: persisted?.manualStageZero ?? createEmptyStageZeroInput(),
  manualCyclicalMetrics: persisted?.manualCyclicalMetrics ?? createEmptyCyclicalMetrics(),
  manualFinancialMetrics: persisted?.manualFinancialMetrics ?? createEmptyFinancialMetrics(),
  customKePct: persisted?.customKePct ?? 8.0,
  customPayoutPct: persisted?.customPayoutPct ?? null,
  manualDataQuality: persisted?.manualDataQuality,

  setActiveTab: (activeTab) => set({ activeTab }),

  loadStaticData: async () => {
    set({ dataLoading: true, dataError: null });
    try {
      const [manifest, bundle] = await Promise.all([
        fetchStaticManifest(),
        fetchStaticStocksBundle(),
      ]);

      const state = get();
      const universe = buildUniverseFromSnapshots(bundle.stocks, state.regulatoryOverrides);

      const nextBenchmark: BenchmarkRegimeInput = {
        indexClose: manifest.regime.indexClose ?? 0,
        ma200: manifest.regime.ma200 ?? 0,
        drawdown20dPct: manifest.regime.drawdown20dPct ?? 0,
        annualizedVol20dPct: manifest.regime.annualizedVol20dPct ?? 0,
      };

      const nextRegime: MarketRegime =
        manifest.status !== 'awaiting_first_run' ? manifest.regime.regime : state.regime;

      let scorecardPatch: Partial<TwQuantState> = {};
      if (universe.length > 0) {
        const currentMatch = universe.find((u) => u.symbol === state.manualSymbol);
        if (currentMatch) {
          scorecardPatch = buildManualFromCandidate(currentMatch);
        } else {
          // 自動選中評級最高分且未踩雷的 A 級標的，若無則依序選 2330 或第一檔
          const rankedPool = rankBatchWithZScore(universe, nextRegime);
          const topA = rankedPool.find((r) => r.rating.finalGrade === 'A' && r.stageZero.passed);
          const tsmc = universe.find((u) => u.symbol === '2330');
          const defaultStock = topA?.stock ?? tsmc ?? universe[0];
          scorecardPatch = buildManualFromCandidate(defaultStock);
        }
      }

      // 同步持倉之最新收盤價
      const priceMap = new Map(universe.map((u) => [u.symbol, u]));
      const updatedHoldings = state.holdings.map((h) => {
        const match = priceMap.get(h.symbol);
        if (!match) return h;
        return {
          ...h,
          currentPrice: match.price > 0 ? match.price : h.currentPrice,
          highestPriceSinceEntry: Math.max(h.highestPriceSinceEntry, match.price),
          atr20: match.atr20,
          ma120: match.ma120,
          ma200: match.ma200,
          daysBelow200Ma: match.daysBelow200Ma,
          cyclicalMetrics: match.cyclicalMetrics,
          financialMetrics: match.financialMetrics,
        };
      });

      set({
        manifest,
        rawSnapshots: bundle.stocks,
        universe,
        benchmark: nextBenchmark,
        regime: nextRegime,
        holdings: updatedHoldings,
        dataLoading: false,
        dataError: null,
        ...scorecardPatch,
      });
      persist(get());
    } catch (err) {
      set({
        dataLoading: false,
        dataError: err instanceof Error ? err.message : '載入靜態真實數據失敗',
      });
    }
  },

  setRegime: (regime) => {
    set((s) => ({
      regime,
      holdings: s.holdings.map((h) => {
        const stockMatch = s.universe.find((u) => u.symbol === h.symbol);
        const szInput = stockMatch?.stageZeroInput ?? createEmptyStageZeroInput();
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
                  createEmptyStageZeroInput(),
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

  saveLocalRegulatoryOverride: (symbol, payload) => {
    const clean = symbol.trim().toUpperCase();
    set((s) => {
      const nextOverrides = { ...s.regulatoryOverrides, [clean]: payload };
      const nextUniverse = buildUniverseFromSnapshots(s.rawSnapshots, nextOverrides);
      const updatedMatch = nextUniverse.find((u) => u.symbol === clean);
      const scorecardPatch =
        updatedMatch && s.manualSymbol === clean
          ? {
              manualFinancialMetrics: updatedMatch.financialMetrics ?? s.manualFinancialMetrics,
              manualDataQuality: updatedMatch.dataQuality,
            }
          : {};
      return {
        regulatoryOverrides: nextOverrides,
        universe: nextUniverse,
        ...scorecardPatch,
      };
    });
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

  loadSnapshot: (snapshot) => {
    set((s) => {
      const nextOverrides = snapshot.regulatoryOverrides ?? s.regulatoryOverrides;
      return {
        ...snapshot,
        universe: buildUniverseFromSnapshots(s.rawSnapshots, nextOverrides),
      };
    });
    persist(get());
  },

  resetPersonalData: () => {
    set((s) => {
      const nextUniverse = buildUniverseFromSnapshots(s.rawSnapshots, {});
      return {
        holdings: [],
        regulatoryOverrides: {},
        selectedSizingIds: [],
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
        universe: nextUniverse,
      };
    });
    persist(get());
  },

  getPersistedSnapshot: () => {
    const s = get();
    return {
      version: 2,
      regime: s.regime,
      holdings: s.holdings,
      regulatoryOverrides: s.regulatoryOverrides,
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
}));
