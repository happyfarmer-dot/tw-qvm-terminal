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
import type { DataSourceMode } from './dataProvider';

export const STORAGE_KEY = 'tw_qvm_quant_terminal_v1';

export interface PersistedTwState {
  version: number;
  dataSourceMode: DataSourceMode;
  backendUrl: string;
  regime: MarketRegime;
  benchmark: BenchmarkRegimeInput;
  universe: TwStockCandidate[];
  holdings: HoldingPosition[];
  selectedSizingIds: string[];
  sizingConfig: SizingConfig;
  frictionConfig: TwFrictionConfig;
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
}

export function loadPersistedTwState(): Partial<PersistedTwState> | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTwState>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function savePersistedTwState(state: PersistedTwState): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function exportTwBackupJson(state: PersistedTwState): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'TW-QVM Quant Terminal',
      ...state,
    },
    null,
    2
  );
}

export function parseTwBackupJson(jsonText: string): PersistedTwState | null {
  try {
    const parsed = JSON.parse(jsonText) as Partial<PersistedTwState>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.universe) ||
      !Array.isArray(parsed.holdings)
    ) {
      return null;
    }
    return parsed as PersistedTwState;
  } catch {
    return null;
  }
}
