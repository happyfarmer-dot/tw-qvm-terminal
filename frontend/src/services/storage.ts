import type {
  CyclicalMetrics,
  DataQuality,
  FinancialSectorMetrics,
  HoldingPosition,
  ManualScorecardInput,
  MarketRegime,
  SizingConfig,
  StageZeroInput,
  TwFrictionConfig,
  ValuationProfile,
} from '../engine/types';
import type { RegulatoryOverridePayload } from './staticDataService';

export const STORAGE_KEY = 'tw_qvm_quant_terminal_v2';

export interface PersistedTwState {
  version: number;
  regime: MarketRegime;
  holdings: HoldingPosition[];
  regulatoryOverrides: Record<string, RegulatoryOverridePayload>;
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
      app: 'TW-QVM Quant Terminal (Serverless)',
      ...state,
    },
    null,
    2
  );
}

export function parseTwBackupJson(jsonText: string): Partial<PersistedTwState> | null {
  try {
    const parsed = JSON.parse(jsonText) as Partial<PersistedTwState>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.holdings !== undefined && !Array.isArray(parsed.holdings)) return null;
    if (
      parsed.regulatoryOverrides !== undefined &&
      (typeof parsed.regulatoryOverrides !== 'object' || parsed.regulatoryOverrides === null)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
