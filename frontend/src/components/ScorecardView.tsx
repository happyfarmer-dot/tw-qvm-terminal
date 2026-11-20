import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  DownloadCloud,
  Flame,
  PlusCircle,
  Save,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { evaluateCyclicalRating } from '../engine/cyclicalScoring';
import { evaluateFinancialRating } from '../engine/financialScoring';
import { evaluateRating } from '../engine/ratingAndRegime';
import { calculatePiotroskiScore, scoreManualCard } from '../engine/scoringManual';
import { evaluateStageZero } from '../engine/stageZero';
import { adviseEntry, adviseHoldingExit } from '../engine/tradeAdvisor';
import type { HoldingPosition, PiotroskiChecks, ValuationProfile } from '../engine/types';
import { useTwQuantStore } from '../store/useTwQuantStore';
import {
  formatTwd,
  getProfileLabel,
  GradeBadge,
  PriorityBadge,
} from './GradeBadge';

const PIOTROSKI_ITEMS: { key: keyof PiotroskiChecks; label: string }[] = [
  { key: 'positiveRoa', label: '1. 正 ROA（資產報酬率 > 0）' },
  { key: 'roaImproving', label: '2. ROA 提升（高於去年同期）' },
  { key: 'positiveOcf', label: '3. 正營業現金流（OCF > 0）' },
  { key: 'ocfGreaterThanNetIncome', label: '4. 盈餘品質（OCF > 稅後淨利）' },
  { key: 'lowerLongTermDebtRatio', label: '5. 長期負債比率下降' },
  { key: 'higherCurrentRatio', label: '6. 流動比率提升' },
  { key: 'noShareDilution', label: '7. 近一年未發行新股稀釋' },
  { key: 'higherGrossMargin', label: '8. 毛利率提升' },
  { key: 'higherAssetTurnover', label: '9. 資產週轉率提升' },
];

export const ScorecardView: React.FC = () => {
  const {
    dataSourceMode,
    regime,
    holdings,
    frictionConfig,
    manualSymbol,
    manualName,
    manualSector,
    manualPrice,
    manualMa120,
    manualMa200,
    manualRev3mYoY,
    manualRev12mYoY,
    manualTrailingPe,
    manualForwardEps,
    manualProfile,
    recommendedProfile,
    manualScorecard,
    manualStageZero,
    manualCyclicalMetrics,
    manualFinancialMetrics,
    customKePct,
    customPayoutPct,
    manualDataQuality,
    setManualProfile,
    updateManualMeta,
    updateManualScorecard,
    updateManualStageZero,
    updateManualCyclicalMetrics,
    updateManualFinancialMetrics,
    setJustifiedPbSensitivity,
    loadCandidateIntoScorecard,
    loadBackendSnapshotIntoScorecard,
    addHolding,
    setActiveTab,
    getProvider,
  } = useTwQuantStore();

  const [fetchCode, setFetchCode] = useState(manualSymbol);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [regSaveMsg, setRegSaveMsg] = useState<string | null>(null);
  const [showPiotroski, setShowPiotroski] = useState(false);
  const [diagMode, setDiagMode] = useState<'ENTRY' | 'HOLDING'>('ENTRY');
  const [simCost, setSimCost] = useState(manualPrice);
  const [simShares, setSimShares] = useState(2000);
  const [simAtr20, setSimAtr20] = useState(Math.max(0.4, Number((manualPrice * 0.025).toFixed(2))));
  const [simMa60, setSimMa60] = useState(Number((manualPrice * 0.96).toFixed(2)));
  const [simDaysBelow200, setSimDaysBelow200] = useState(0);
  const [simMoatBroken, setSimMoatBroken] = useState(false);

  const isFinancialProfile =
    manualProfile === 'financial_bank' || manualProfile === 'financial_life_fhc';
  const isCyclicalProfile =
    manualProfile === 'cyclical_heavy_asset' || manualProfile === 'cyclical_inventory_order';

  const nonFinStageZero = useMemo(
    () => evaluateStageZero(manualStageZero, manualProfile),
    [manualStageZero, manualProfile]
  );

  const stdBreakdown = useMemo(() => scoreManualCard(manualScorecard), [manualScorecard]);
  const stdRating = useMemo(
    () => evaluateRating({ breakdown: stdBreakdown, regime, stageZero: nonFinStageZero }),
    [stdBreakdown, regime, nonFinStageZero]
  );

  const cycRating = useMemo(() => {
    if (!isCyclicalProfile) return null;
    return evaluateCyclicalRating({
      profile: manualProfile as 'cyclical_heavy_asset' | 'cyclical_inventory_order',
      regime,
      stageZero: nonFinStageZero,
      metrics: manualCyclicalMetrics,
      price: manualPrice,
      ma120: manualMa120,
      ma200: manualMa200,
      rev3mCumYoYPct: manualRev3mYoY,
      rev12mCumYoYPct: manualRev12mYoY,
    });
  }, [
    isCyclicalProfile,
    manualProfile,
    regime,
    nonFinStageZero,
    manualCyclicalMetrics,
    manualPrice,
    manualMa120,
    manualMa200,
    manualRev3mYoY,
    manualRev12mYoY,
  ]);

  const finRating = useMemo(() => {
    if (!isFinancialProfile) return null;
    return evaluateFinancialRating({
      profile: manualProfile as 'financial_bank' | 'financial_life_fhc',
      regime,
      commonStageZeroInput: manualStageZero,
      metrics: manualFinancialMetrics,
      price: manualPrice,
      ma200: manualMa200,
      customKePct,
      customPayoutPct,
    });
  }, [
    isFinancialProfile,
    manualProfile,
    regime,
    manualStageZero,
    manualFinancialMetrics,
    manualPrice,
    manualMa200,
    customKePct,
    customPayoutPct,
  ]);

  const activeRating = finRating ?? cycRating ?? stdRating;
  const activeStageZero = activeRating.stageZero;
  const entryPlan = useMemo(() => adviseEntry(activeRating), [activeRating]);

  const simHolding: HoldingPosition = useMemo(
    () => ({
      id: `SIM-TW-${manualSymbol}`,
      symbol: manualSymbol,
      name: manualName,
      sector: manualSector,
      valuationProfile: manualProfile,
      shares: simShares,
      costPrice: simCost,
      currentPrice: manualPrice,
      highestPriceSinceEntry: Math.max(manualPrice, simCost),
      atr20: simAtr20,
      ma60: simMa60,
      ma120: manualMa120,
      ma200: manualMa200,
      daysBelow200Ma: simDaysBelow200,
      moatPermanentlyBroken: simMoatBroken,
      stopDrawdownThresholdPct: 15,
      currentRating: stdRating,
      currentBreakdown: stdBreakdown,
      cyclicalMetrics: manualCyclicalMetrics,
      cyclicalRating: cycRating ?? undefined,
      financialMetrics: manualFinancialMetrics,
      financialRating: finRating ?? undefined,
    }),
    [
      manualSymbol,
      manualName,
      manualSector,
      manualProfile,
      simShares,
      simCost,
      manualPrice,
      simAtr20,
      simMa60,
      manualMa120,
      manualMa200,
      simDaysBelow200,
      simMoatBroken,
      stdRating,
      stdBreakdown,
      manualCyclicalMetrics,
      cycRating,
      manualFinancialMetrics,
      finRating,
    ]
  );

  const exitDecision = useMemo(() => {
    const othersVal = holdings.reduce((acc, h) => acc + h.currentPrice * h.shares, 0);
    return adviseHoldingExit({
      holding: simHolding,
      totalActivePortfolioValue: Math.max(othersVal, simShares * manualPrice),
      frictionConfig,
    });
  }, [holdings, simHolding, simShares, manualPrice, frictionConfig]);

  const piotroski = useMemo(
    () => calculatePiotroskiScore(manualScorecard.piotroskiChecks),
    [manualScorecard.piotroskiChecks]
  );

  const handleFetchStock = async (forceRefresh = false) => {
    const clean = fetchCode.trim().toUpperCase();
    if (!clean) return;
    setFetchError(null);
    setRegSaveMsg(null);
    setFetchLoading(true);
    try {
      const provider = getProvider();
      if (dataSourceMode === 'mock') {
        const mockHit = await provider.fetchMockStock(clean);
        if (!mockHit) {
          throw new Error(
            `Mock 資料集內建 10 檔範例（2330, 2308, 2382, 2345, 9910, 6599, 2603, 3131, 2886, 2888），請切換 Live FastAPI 查詢 ${clean}`
          );
        }
        loadCandidateIntoScorecard(mockHit);
      } else {
        const snap = await provider.fetchStock(clean, forceRefresh);
        loadBackendSnapshotIntoScorecard(snap);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchLoading(false);
    }
  };

  const handleSaveRegulatoryToBackend = async () => {
    setRegSaveMsg(null);
    try {
      const provider = getProvider();
      await provider.saveRegulatoryData(manualSymbol, {
        asOfQuarter: manualFinancialMetrics.asOfQuarter,
        isDsib: manualFinancialMetrics.isDsib,
        fhcCarPct: manualFinancialMetrics.fhcCarPct,
        bankBisPct: manualFinancialMetrics.bankBisPct,
        bankCet1Pct: manualFinancialMetrics.bankCet1Pct,
        doubleLeverageRatioPct: manualFinancialMetrics.doubleLeverageRatioPct,
        nplRatioPct: manualFinancialMetrics.nplRatioPct,
        nplConsecutiveRiseQuarters: manualFinancialMetrics.nplConsecutiveRiseQuarters,
        nplCoverageRatioPct: manualFinancialMetrics.nplCoverageRatioPct,
        lifeSolvencyRatioPct: manualFinancialMetrics.lifeSolvencyRatioPct,
        lifeSolvencyRegime: manualFinancialMetrics.lifeSolvencyRegime,
        ociRestrictsDividend: manualFinancialMetrics.ociRestrictsDividend,
        recentDilutiveOfferingPct: manualFinancialMetrics.recentDilutiveOfferingPct,
      });
      setRegSaveMsg('已儲存至後端 SQLite（即時生效）');
      setTimeout(() => setRegSaveMsg(null), 3000);
    } catch (err) {
      setRegSaveMsg(`儲存失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const radarData = isFinancialProfile
    ? [
        { dim: '金融體質 FQ', pct: finRating?.fqRatioPct ?? 0, floor: 40 },
        { dim: '金融估值 FV', pct: finRating?.fvRatioPct ?? 0, floor: 40 },
        { dim: '獲利動能 FM', pct: finRating?.fmRatioPct ?? 0, floor: 40 },
      ]
    : isCyclicalProfile
      ? [
          { dim: '跨週期體質 CQ', pct: cycRating?.cqRatioPct ?? 0, floor: 40 },
          { dim: '週期估值 CV', pct: cycRating?.cvRatioPct ?? 0, floor: 40 },
          { dim: '拐點動能 CM', pct: cycRating?.cmRatioPct ?? 0, floor: 40 },
        ]
      : [
          { dim: '品質 Quality', pct: stdRating.qRatioPct, floor: 40 },
          { dim: '價值 Value', pct: stdRating.vRatioPct, floor: 40 },
          { dim: '動能 Momentum', pct: stdRating.mRatioPct, floor: 40 },
        ];

  const dioVsGmData = useMemo(() => {
    const dios = manualCyclicalMetrics.dioQuarterlySeries;
    const gms = manualCyclicalMetrics.grossMarginQuarterlySeries;
    return dios.map((pt, idx) => ({
      quarter: pt.quarter,
      dio: pt.dio,
      grossMarginPct: gms[idx]?.grossMarginPct ?? null,
    }));
  }, [manualCyclicalMetrics]);

  const pbCompareData = useMemo(() => {
    const b = manualFinancialMetrics.pbBand;
    return [
      { label: '5-7Y Min', value: b.min ?? 0, fill: '#475569' },
      { label: 'P20 便宜', value: b.p20 ?? 0, fill: '#10b981' },
      { label: 'P50 中位', value: b.p50 ?? 0, fill: '#64748b' },
      { label: '合理 P/B', value: finRating?.recalculatedJustifiedPB ?? 0, fill: '#06b6d4' },
      { label: '實際 P/B', value: manualFinancialMetrics.currentPB ?? 0, fill: '#f59e0b' },
      { label: 'P80 偏貴', value: b.p80 ?? 0, fill: '#f43f5e' },
    ];
  }, [manualFinancialMetrics, finRating]);

  const fairImpliedPrice =
    manualFinancialMetrics.currentPB &&
    manualFinancialMetrics.currentPB > 0 &&
    finRating?.recalculatedJustifiedPB
      ? Number(
          ((manualPrice * finRating.recalculatedJustifiedPB) / manualFinancialMetrics.currentPB).toFixed(2)
        )
      : null;

  const forwardPeCalculated =
    manualForwardEps && manualForwardEps > 0 && manualPrice > 0
      ? Number((manualPrice / manualForwardEps).toFixed(2))
      : null;

  const pbPct = manualCyclicalMetrics.pbPercentile5to7Y;

  return (
    <div className="space-y-4">
      {/* Top Bar: Fetch + 5-Mode Profile Switcher */}
      <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={fetchCode}
              onChange={(e) => setFetchCode(e.target.value.toUpperCase())}
              placeholder="輸入台股代號 (如 2330, 2603, 2886, 2888)"
              className="w-60 px-3 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-700 font-mono text-slate-100"
            />
            <button
              onClick={() => handleFetchStock(false)}
              disabled={fetchLoading}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 flex items-center gap-1.5 disabled:opacity-50"
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              {fetchLoading
                ? '抓取中...'
                : dataSourceMode === 'live'
                  ? '向後端拉取真實數據'
                  : '載入 Mock 範例'}
            </button>
            {dataSourceMode === 'live' && (
              <button
                onClick={() => handleFetchStock(true)}
                disabled={fetchLoading}
                className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
              >
                強制重整
              </button>
            )}
          </div>

          <button
            onClick={() => {
              addHolding({ ...simHolding, id: `HOLD-TW-${manualSymbol}-${Date.now()}` });
              setActiveTab('portfolio');
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            加入持倉監控台
          </button>
        </div>

        {fetchError && (
          <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 px-3 py-2 rounded-lg">
            {fetchError}
          </div>
        )}

        {/* 5-Option Profile Capsule Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400 mr-1">評分模型：</span>
            {(
              [
                { id: 'standard', label: '標準品質型' },
                { id: 'cyclical_heavy_asset', label: '循環－重資產' },
                { id: 'cyclical_inventory_order', label: '循環－存貨訂單' },
                { id: 'financial_bank', label: '金融－銀行／官股型' },
                { id: 'financial_life_fhc', label: '金融－壽險雙引擎型' },
              ] as { id: ValuationProfile; label: string }[]
            ).map((opt) => {
              const isSelected = manualProfile === opt.id;
              const isFin = opt.id.startsWith('financial');
              const isCyc = opt.id.startsWith('cyclical');
              return (
                <button
                  key={opt.id}
                  onClick={() => setManualProfile(opt.id)}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-full border transition ${
                    isSelected
                      ? isFin
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                        : isCyc
                          ? 'bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-200'
                          : 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {recommendedProfile !== manualProfile && (
            <button
              onClick={() => setManualProfile(recommendedProfile)}
              className="px-2.5 py-1 text-xs rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              建議切換「{getProfileLabel(recommendedProfile)}」
            </button>
          )}
        </div>
      </div>

      {/* Pending Manual Verification Banner */}
      {(activeStageZero.pendingManualChecks.length > 0 ||
        (manualDataQuality?.manualVerificationRequired.length ?? 0) > 0) && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200 space-y-2">
          <div className="font-bold flex items-center gap-2 text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            待人工覆核清單（反靜默失真原則：缺失欄位回傳 null，未覆核前不偽裝安全）
            {manualDataQuality && (
              <span className="ml-auto font-mono tabular-nums">
                資料完整度 {manualDataQuality.completenessPct}%
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px] text-amber-100/90">
            {Array.from(
              new Set([
                ...activeStageZero.pendingManualChecks,
                ...(manualDataQuality?.manualVerificationRequired ?? []),
              ])
            ).map((item, i) => (
              <div key={i}>• {item}</div>
            ))}
          </div>
          {manualDataQuality && manualDataQuality.warnings.length > 0 && (
            <div className="pt-1.5 border-t border-amber-500/25 text-[11px] text-amber-300 space-y-0.5">
              {manualDataQuality.warnings.map((w, i) => (
                <div key={i}>[提示] {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left Column (7 cols) */}
        <div className="xl:col-span-7 space-y-4">
          {/* Basic Target Info */}
          <section className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">標的基礎資料與均線參數</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
              <label className="space-y-1">
                <span className="text-slate-400">代號</span>
                <input
                  value={manualSymbol}
                  onChange={(e) => updateManualMeta({ symbol: e.target.value.toUpperCase() })}
                  className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">名稱</span>
                <input
                  value={manualName}
                  onChange={(e) => updateManualMeta({ name: e.target.value })}
                  className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">產業</span>
                <input
                  value={manualSector}
                  onChange={(e) => updateManualMeta({ sector: e.target.value })}
                  className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">收盤價 (TWD)</span>
                <input
                  type="number"
                  step="0.5"
                  value={manualPrice}
                  onChange={(e) => updateManualMeta({ price: Number(e.target.value) || 0 })}
                  className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400">200MA</span>
                <input
                  type="number"
                  step="0.5"
                  value={manualMa200}
                  onChange={(e) => updateManualMeta({ ma200: Number(e.target.value) || 1 })}
                  className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                />
              </label>
            </div>
          </section>

          {/* Financial MOPS Regulatory Panel OR Standard/Cyclical Stage Zero */}
          {isFinancialProfile ? (
            <>
              <section className="p-4 rounded-xl bg-[#0f172a] border border-emerald-500/35 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    MOPS 監理數據填寫抽屜（階段零金融防雷＋體質評分）
                  </h2>
                  <div className="flex items-center gap-2">
                    {dataSourceMode === 'live' && (
                      <button
                        onClick={handleSaveRegulatoryToBackend}
                        className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" />
                        儲存至後端 SQLite
                      </button>
                    )}
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        activeStageZero.passed
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                          : 'bg-rose-500/20 text-rose-300 border-rose-500/50 font-semibold'
                      }`}
                    >
                      {activeStageZero.passed
                        ? '監理無紅燈'
                        : `觸發 ${activeStageZero.redFlags.length} 項紅燈`}
                    </span>
                  </div>
                </div>
                {regSaveMsg && <div className="text-xs text-emerald-300">{regSaveMsg}</div>}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <label className="space-y-1">
                    <span className="text-slate-400">財報季度 (如 2026Q3)</span>
                    <input
                      type="text"
                      value={manualFinancialMetrics.asOfQuarter ?? ''}
                      placeholder="2026Q3"
                      onChange={(e) =>
                        updateManualFinancialMetrics({ asOfQuarter: e.target.value || null })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">金控 CAR % (&lt;105% 紅燈)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={manualFinancialMetrics.fhcCarPct ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          fhcCarPct: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">銀行 BIS % (&lt;10.5% 紅燈)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={manualFinancialMetrics.bankBisPct ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          bankBisPct: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">
                      銀行 CET1 % (&lt;{manualFinancialMetrics.isDsib ? '9.5%' : '7.0%'})
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      value={manualFinancialMetrics.bankCet1Pct ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          bankCet1Pct: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">雙重槓桿比 DLR % (&gt;125%)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={manualFinancialMetrics.doubleLeverageRatioPct ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          doubleLeverageRatioPct:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">銀行逾放比 NPL % (&gt;1.0%)</span>
                    <input
                      type="number"
                      step="0.01"
                      value={manualFinancialMetrics.nplRatioPct ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          nplRatioPct: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">備抵呆帳覆蓋率 % (&lt;100%)</span>
                    <input
                      type="number"
                      step="10"
                      value={manualFinancialMetrics.nplCoverageRatioPct ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          nplCoverageRatioPct:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">NPL 連升季數 (&gt;=2 警戒)</span>
                    <input
                      type="number"
                      min={0}
                      value={manualFinancialMetrics.nplConsecutiveRiseQuarters ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          nplConsecutiveRiseQuarters:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">近1年現增稀釋 % (&gt;10%)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={manualFinancialMetrics.recentDilutiveOfferingPct ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          recentDilutiveOfferingPct:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">5Y 平均 ROE (%)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={manualFinancialMetrics.avgRoe5Y ?? ''}
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          avgRoe5Y: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">實際 P/B 倍數</span>
                    <input
                      type="number"
                      step="0.01"
                      value={manualFinancialMetrics.currentPB ?? ''}
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          currentPB: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">現金殖利率 (%)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={manualFinancialMetrics.cashDividendYieldPct ?? ''}
                      onChange={(e) =>
                        updateManualFinancialMetrics({
                          cashDividendYieldPct:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                </div>

                {manualProfile === 'financial_life_fhc' && (
                  <div className="grid grid-cols-2 gap-2.5 text-xs pt-2 border-t border-slate-800">
                    <label className="space-y-1">
                      <span className="text-slate-400">壽險制度 (RBC&lt;200 / TW-ICS&lt;100)</span>
                      <select
                        value={manualFinancialMetrics.lifeSolvencyRegime ?? 'RBC'}
                        onChange={(e) =>
                          updateManualFinancialMetrics({
                            lifeSolvencyRegime: e.target.value as 'RBC' | 'TW-ICS',
                          })
                        }
                        className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700"
                      >
                        <option value="RBC">舊制 RBC (法定 &gt;= 200%)</option>
                        <option value="TW-ICS">新制 TW-ICS (法定 &gt;= 100%)</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-400">壽險子公司清償比率 (%)</span>
                      <input
                        type="number"
                        step="1"
                        value={manualFinancialMetrics.lifeSolvencyRatioPct ?? ''}
                        placeholder="null"
                        onChange={(e) =>
                          updateManualFinancialMetrics({
                            lifeSolvencyRatioPct:
                              e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                      />
                    </label>
                  </div>
                )}

                <div className="flex flex-wrap gap-4 pt-1 text-xs text-slate-300">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(manualFinancialMetrics.isDsib)}
                      onChange={(e) =>
                        updateManualFinancialMetrics({ isDsib: e.target.checked })
                      }
                      className="accent-emerald-400"
                    />
                    系統性重要銀行 D-SIBs (CET1 門檻 9.5%)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(manualFinancialMetrics.ociRestrictsDividend)}
                      onChange={(e) =>
                        updateManualFinancialMetrics({ ociRestrictsDividend: e.target.checked })
                      }
                      className="accent-rose-500"
                    />
                    OCI 其他權益大幅負數致限制配息
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={manualStageZero.hasAuditOrGovernanceRedFlag === true}
                      onChange={(e) =>
                        updateManualStageZero({
                          hasAuditOrGovernanceRedFlag: e.target.checked,
                        })
                      }
                      className="accent-rose-500"
                    />
                    重大金管會裁罰／查核異常
                  </label>
                </div>
              </section>

              {/* Justified P/B Sensitivity Sliders & Comparison Chart */}
              <section className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-cyan-300 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Justified P/B 敏感度即時試算與歷史區間對照
                  </h2>
                  <div className="text-xs font-mono tabular-nums text-slate-200">
                    合理 P/B：<strong className="text-cyan-300">{finRating?.recalculatedJustifiedPB ?? 'null'}x</strong>
                    {' ｜ '}折價率：<strong className="text-amber-300">{finRating?.recalculatedPbValuationRatio ?? 'null'}x</strong>
                    {fairImpliedPrice !== null && (
                      <span className="text-emerald-300 ml-2">(合理價 ≈ {fairImpliedPrice} 元)</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-300">權益資金成本 ke（6.5%–11.0%）</span>
                      <span className="font-mono font-bold text-cyan-300">{customKePct.toFixed(1)}%</span>
                    </div>
                    <input
                      type="range"
                      min={6.5}
                      max={11.0}
                      step={0.1}
                      value={customKePct}
                      onChange={(e) => setJustifiedPbSensitivity({ kePct: Number(e.target.value) })}
                      className="w-full accent-cyan-400"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-300">預估長期配發率（0%–100%）</span>
                      <span className="font-mono font-bold text-emerald-300">
                        {(customPayoutPct ?? 50).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={2}
                      value={customPayoutPct ?? 50}
                      onChange={(e) => setJustifiedPbSensitivity({ payoutPct: Number(e.target.value) })}
                      className="w-full accent-emerald-400"
                    />
                  </label>
                </div>

                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pbCompareData} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 12 }}
                      />
                      <Bar dataKey="value" name="P/B 倍數" radius={[6, 6, 0, 0]}>
                        {pbCompareData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </>
          ) : (
            <>
              {/* Non-Financial Stage Zero */}
              <section className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                    階段零：台股一票否決防雷閘門（支援 null 人工覆核）
                  </h2>
                  {activeStageZero.passed ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                      無觸發紅燈
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/50 font-semibold">
                      觸發 {activeStageZero.redFlags.length} 項紅燈 (F 級)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <label className="space-y-1">
                    <span className="text-slate-400">Beneish M-Score (&gt; -1.78)</span>
                    <input
                      type="number"
                      step="0.05"
                      value={manualStageZero.beneishMScore ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualStageZero({
                          beneishMScore: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">
                      {manualStageZero.isManufacturing ? 'Altman Z (< 1.81)' : "Altman Z'' (< 1.10)"}
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      value={
                        (manualStageZero.isManufacturing
                          ? manualStageZero.altmanZScore
                          : manualStageZero.altmanZDoublePrime) ?? ''
                      }
                      placeholder="null"
                      onChange={(e) => {
                        const val = e.target.value === '' ? null : Number(e.target.value);
                        updateManualStageZero(
                          manualStageZero.isManufacturing
                            ? { altmanZScore: val }
                            : { altmanZDoublePrime: val }
                        );
                      }}
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">董監設質 % (&gt;= 70% 紅燈)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={manualStageZero.directorPledgeRatio ?? ''}
                      placeholder="null"
                      onChange={(e) =>
                        updateManualStageZero({
                          directorPledgeRatio:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">20日均成交額 (TWD)</span>
                    <input
                      type="number"
                      step="1000000"
                      value={manualStageZero.avgDailyTurnover20dTWD ?? ''}
                      onChange={(e) =>
                        updateManualStageZero({
                          avgDailyTurnover20dTWD:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">會計師／治理人工覆核</span>
                    <select
                      value={
                        manualStageZero.hasAuditOrGovernanceRedFlag === null
                          ? 'null'
                          : String(manualStageZero.hasAuditOrGovernanceRedFlag)
                      }
                      onChange={(e) =>
                        updateManualStageZero({
                          hasAuditOrGovernanceRedFlag:
                            e.target.value === 'null' ? null : e.target.value === 'true',
                        })
                      }
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700"
                    >
                      <option value="null">未覆核 (null)</option>
                      <option value="false">已確認無異常</option>
                      <option value="true">保留意見/異常換所</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">處置股覆核</span>
                    <select
                      value={
                        manualStageZero.isDispositionStock === null
                          ? 'null'
                          : String(manualStageZero.isDispositionStock)
                      }
                      onChange={(e) =>
                        updateManualStageZero({
                          isDispositionStock:
                            e.target.value === 'null' ? null : e.target.value === 'true',
                        })
                      }
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700"
                    >
                      <option value="null">未覆核 (null)</option>
                      <option value="false">正常交易</option>
                      <option value="true">處置股</option>
                    </select>
                  </label>
                </div>
              </section>

              {manualProfile === 'standard' ? (
                <>
                  <section className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-emerald-300">
                        品質維度 Quality (滿分 40)
                      </h2>
                      <span className="font-mono font-bold text-emerald-300">
                        {stdBreakdown.sQ.toFixed(1)} / 40 ({stdRating.qRatioPct}%)
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="space-y-1">
                        <div className="flex justify-between">
                          <span>Q1 ROIC (12)</span>
                          <span className="font-mono">{manualScorecard.q1RoicScore}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={12}
                          step={0.5}
                          value={manualScorecard.q1RoicScore}
                          onChange={(e) => updateManualScorecard({ q1RoicScore: Number(e.target.value) })}
                          className="w-full accent-emerald-400"
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="flex justify-between">
                          <span>Q2 GP/A (10)</span>
                          <span className="font-mono">{manualScorecard.q2GpaScore}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={0.5}
                          value={manualScorecard.q2GpaScore}
                          onChange={(e) => updateManualScorecard({ q2GpaScore: Number(e.target.value) })}
                          className="w-full accent-emerald-400"
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="flex justify-between">
                          <span>Q3 OCF/NI (10)</span>
                          <span className="font-mono">{manualScorecard.q3OcfNiScore}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={0.5}
                          value={manualScorecard.q3OcfNiScore}
                          onChange={(e) => updateManualScorecard({ q3OcfNiScore: Number(e.target.value) })}
                          className="w-full accent-emerald-400"
                        />
                      </label>
                    </div>
                    <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2.5">
                      <button
                        onClick={() => setShowPiotroski((v) => !v)}
                        className="w-full flex items-center justify-between font-semibold text-slate-200"
                      >
                        <span>
                          Q4 Piotroski F-Score：{piotroski.rawScore}/9 → 映射 {piotroski.mappedQ4Score}/8 分
                        </span>
                        {showPiotroski ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      {showPiotroski && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-2 mt-2 border-t border-slate-800">
                          {PIOTROSKI_ITEMS.map((item) => (
                            <label key={item.key} className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={manualScorecard.piotroskiChecks[item.key]}
                                onChange={(e) =>
                                  updateManualScorecard({
                                    piotroskiChecks: {
                                      ...manualScorecard.piotroskiChecks,
                                      [item.key]: e.target.checked,
                                    },
                                  })
                                }
                                className="accent-emerald-400"
                              />
                              {item.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-cyan-300">
                        價值 (35) ＋ 動能 (25) 評分
                      </h2>
                      <span className="font-mono font-bold text-cyan-300">
                        V:{stdBreakdown.sV.toFixed(1)} / M:{stdBreakdown.sM.toFixed(1)}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400">
                        Trailing P/E：{manualTrailingPe ?? 'null'} ｜ 人工預估 EPS：
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.5"
                          value={manualForwardEps ?? ''}
                          placeholder="輸入預估 EPS"
                          onChange={(e) =>
                            updateManualMeta({
                              forwardEps: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className="w-28 px-2 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-slate-100"
                        />
                        {forwardPeCalculated !== null && (
                          <span className="font-mono text-cyan-300">
                            Forward P/E = {forwardPeCalculated}x
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <label className="space-y-1">
                        <div className="flex justify-between">
                          <span>V1 EV倍數 (15)</span>
                          <span className="font-mono">{manualScorecard.v1EvMultipleScore}</span>
                        </div>
                        <input type="range" min={0} max={15} step={0.5} value={manualScorecard.v1EvMultipleScore} onChange={(e) => updateManualScorecard({ v1EvMultipleScore: Number(e.target.value) })} className="w-full accent-cyan-400" />
                      </label>
                      <label className="space-y-1">
                        <div className="flex justify-between">
                          <span>V2 FCF/EV (12)</span>
                          <span className="font-mono">{manualScorecard.v2FcfEvScore}</span>
                        </div>
                        <input type="range" min={0} max={12} step={0.5} value={manualScorecard.v2FcfEvScore} onChange={(e) => updateManualScorecard({ v2FcfEvScore: Number(e.target.value) })} className="w-full accent-cyan-400" />
                      </label>
                      <label className="space-y-1">
                        <div className="flex justify-between">
                          <span>V3 配息&amp;PE (8)</span>
                          <span className="font-mono">{manualScorecard.v3DivAndPeScore}</span>
                        </div>
                        <input type="range" min={0} max={8} step={0.5} value={manualScorecard.v3DivAndPeScore} onChange={(e) => updateManualScorecard({ v3DivAndPeScore: Number(e.target.value) })} className="w-full accent-cyan-400" />
                      </label>
                      <label className="space-y-1">
                        <div className="flex justify-between">
                          <span>M1 價格動能 (10)</span>
                          <span className="font-mono">{manualScorecard.m1PriceMomScore}</span>
                        </div>
                        <input type="range" min={0} max={10} step={0.5} value={manualScorecard.m1PriceMomScore} onChange={(e) => updateManualScorecard({ m1PriceMomScore: Number(e.target.value) })} className="w-full accent-violet-400" />
                      </label>
                      <label className="space-y-1">
                        <div className="flex justify-between">
                          <span>M2 月營收動能 (10)</span>
                          <span className="font-mono">{manualScorecard.m2FundMomScore}</span>
                        </div>
                        <input type="range" min={0} max={10} step={0.5} value={manualScorecard.m2FundMomScore} onChange={(e) => updateManualScorecard({ m2FundMomScore: Number(e.target.value) })} className="w-full accent-violet-400" />
                      </label>
                      <label className="space-y-1">
                        <div className="flex justify-between">
                          <span>M3 均線趨勢 (5)</span>
                          <span className="font-mono">{manualScorecard.m3TrendFilterScore}</span>
                        </div>
                        <input type="range" min={0} max={5} step={0.5} value={manualScorecard.m3TrendFilterScore} onChange={(e) => updateManualScorecard({ m3TrendFilterScore: Number(e.target.value) })} className="w-full accent-violet-400" />
                      </label>
                    </div>
                  </section>
                </>
              ) : (
                <>
                  {/* Cyclical P/B Gauge + DIO vs GM Chart */}
                  <section className="p-4 rounded-xl bg-[#0f172a] border border-fuchsia-500/35 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-fuchsia-300 flex items-center gap-2">
                        <Flame className="w-4 h-4" />
                        5–7 年 P/B 河流位階儀表條（P/B Band Gauge）
                      </h2>
                      <span className="text-xs font-mono tabular-nums text-slate-200">
                        現況 P/B：{manualCyclicalMetrics.currentPB ?? '--'}x ｜ 百分位：
                        <strong className={(pbPct ?? 0) >= 80 ? 'text-rose-300 ml-1' : 'text-emerald-300 ml-1'}>
                          {pbPct !== null ? `${pbPct.toFixed(1)}%` : 'null'}
                        </strong>
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="relative h-5 rounded-full overflow-hidden border border-slate-700 bg-gradient-to-r from-emerald-500/70 via-amber-400/60 to-rose-600/80">
                        <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-white/70" style={{ left: '80%' }} />
                        {pbPct !== null && (
                          <div className="absolute top-0 bottom-0 w-2 bg-white shadow-[0_0_8px_#fff]" style={{ left: `calc(${Math.min(98, Math.max(1, pbPct))}% - 4px)` }} />
                        )}
                      </div>
                      <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-400">
                        <span>Min: {manualCyclicalMetrics.pbBand.min ?? '-'}x</span>
                        <span>P20: {manualCyclicalMetrics.pbBand.p20 ?? '-'}x</span>
                        <span>P50: {manualCyclicalMetrics.pbBand.p50 ?? '-'}x</span>
                        <span className="text-rose-300">P80: {manualCyclicalMetrics.pbBand.p80 ?? '-'}x</span>
                        <span>Max: {manualCyclicalMetrics.pbBand.max ?? '-'}x</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs pt-2 border-t border-slate-800">
                      <label className="space-y-1">
                        <span className="text-slate-400">P/B 百分位 (%)</span>
                        <input type="number" value={manualCyclicalMetrics.pbPercentile5to7Y ?? ''} onChange={(e) => updateManualCyclicalMetrics({ pbPercentile5to7Y: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-slate-400">常態化 EV/EBIT</span>
                        <input type="number" step="0.5" value={manualCyclicalMetrics.normalizedEvToEbit ?? ''} onChange={(e) => updateManualCyclicalMetrics({ normalizedEvToEbit: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-slate-400">總資產年增率 (%)</span>
                        <input type="number" value={manualCyclicalMetrics.assetGrowthYoY ?? ''} onChange={(e) => updateManualCyclicalMetrics({ assetGrowthYoY: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-slate-400">DIO 連升季數</span>
                        <input type="number" min={0} value={manualCyclicalMetrics.consecutiveDioRiseQuarters ?? ''} onChange={(e) => updateManualCyclicalMetrics({ consecutiveDioRiseQuarters: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
                      </label>
                    </div>
                  </section>

                  <section className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-2">
                    <h2 className="text-sm font-semibold text-slate-200">
                      近 8 季存貨週轉天數（DIO）vs 單季毛利率（GM%）雙軸拐點圖
                    </h2>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={dioVsGmData} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="quarter" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                          <YAxis yAxisId="left" tick={{ fill: '#38bdf8', fontSize: 11 }} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fill: '#10b981', fontSize: 11 }} unit="%" />
                          <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 12 }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar yAxisId="left" dataKey="dio" name="DIO (天)" fill="#0284c7" radius={[4, 4, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="grossMarginPct" name="毛利率 %" stroke="#10b981" strokeWidth={2.5} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>

        {/* Right Live Output Panel (5 cols) */}
        <div className="xl:col-span-5 space-y-4 xl:sticky xl:top-28">
          <section className="p-5 rounded-xl bg-[#0f172a] border border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-400">
                  {manualSymbol} {manualName} · {getProfileLabel(manualProfile)}
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-4xl font-bold font-mono tabular-nums text-slate-100">
                    {activeRating.finalScore.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-400">/ 100.0</span>
                </div>
              </div>
              <div className="text-right space-y-1">
                <GradeBadge grade={activeRating.finalGrade} size="lg" />
                {activeRating.baseGrade !== activeRating.finalGrade && (
                  <div className="text-[11px] font-mono text-amber-300">
                    原始 {activeRating.baseGrade} → {activeRating.finalGrade} 級
                  </div>
                )}
              </div>
            </div>

            {finRating?.hasUnverifiedRegulatoryFields && (
              <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/50 text-xs text-amber-200 font-semibold">
                未完成完整監理防雷驗證（尚有 null 監理欄位），系統禁止直接執行實盤買進。
              </div>
            )}

            {cycRating?.isPeakCircuitBreakerTriggered && (
              <div className="p-3 rounded-lg bg-rose-600/20 border border-rose-500/60 text-xs text-rose-200 flex items-start gap-2">
                <Flame className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>{cycRating.peakCircuitBreakerReasons.join('；')}</div>
              </div>
            )}

            {finRating?.isFinancialTrapCircuitBreakerTriggered && (
              <div className="p-3 rounded-lg bg-rose-600/20 border border-rose-500/60 text-xs text-rose-200 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  {finRating.financialTrapReasons.map((r, i) => (
                    <div key={i}>{r}</div>
                  ))}
                </div>
              </div>
            )}

            {activeRating.antiBiasDowngraded && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  {activeRating.antiBiasReasons.map((r, i) => (
                    <div key={i}>{r}</div>
                  ))}
                </div>
              </div>
            )}

            {!activeStageZero.passed && (
              <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/50 text-xs text-rose-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-rose-300">
                  <XCircle className="w-4 h-4" />
                  階段零紅燈 — 強制 F 級
                </div>
                {activeStageZero.redFlags.map((f) => (
                  <div key={f.code}>• {f.title}：{f.detail}</div>
                ))}
              </div>
            )}

            <div className="h-52 w-full border-t border-slate-800 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Radar name="得分率 %" dataKey="pct" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.3} />
                  <Radar name="40% 防偏科底線" dataKey="floor" stroke="#f59e0b" fill="none" strokeDasharray="4 4" />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="p-5 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">買賣決策 SOP 建議書</h3>
              <div className="inline-flex rounded-md bg-slate-950 p-0.5 border border-slate-800">
                <button
                  onClick={() => setDiagMode('ENTRY')}
                  className={`px-2.5 py-1 rounded ${diagMode === 'ENTRY' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400'}`}
                >
                  空手買進
                </button>
                <button
                  onClick={() => setDiagMode('HOLDING')}
                  className={`px-2.5 py-1 rounded ${diagMode === 'HOLDING' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400'}`}
                >
                  既有持股 P0–P4
                </button>
              </div>
            </div>

            {diagMode === 'ENTRY' ? (
              <div className="space-y-3">
                <div
                  className={`p-3 rounded-lg border font-semibold ${
                    entryPlan.allowEntry
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                  }`}
                >
                  {entryPlan.actionTitle}
                </div>

                {entryPlan.defensiveLeftSideEntryAllowed && entryPlan.defensiveLeftSideMessage && (
                  <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-cyan-200">
                    {entryPlan.defensiveLeftSideMessage}
                  </div>
                )}

                {entryPlan.allowEntry ? (
                  <>
                    <div className="grid grid-cols-2 gap-2.5 font-mono tabular-nums">
                      <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-400 font-sans">第一批建倉</div>
                        <div className="text-lg font-bold text-emerald-300">{entryPlan.firstTranchePct}%</div>
                      </div>
                      <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-400 font-sans">第二批加碼</div>
                        <div className="text-lg font-bold text-cyan-300">{entryPlan.secondTranchePct}%</div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {entryPlan.secondTrancheChecklist.map((c, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-slate-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{c}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-1 text-slate-300">
                    {entryPlan.blockedReasons.map((r, i) => (
                      <div key={i}>• {r}</div>
                    ))}
                  </div>
                )}
                <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
                  {entryPlan.twSpecificNotes.map((n, i) => (
                    <div key={i}>• {n}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1 text-slate-400">
                    成本價
                    <input type="number" value={simCost} onChange={(e) => setSimCost(Number(e.target.value) || 0)} className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums text-slate-100" />
                  </label>
                  <label className="space-y-1 text-slate-400">
                    股數
                    <input type="number" value={simShares} onChange={(e) => setSimShares(Number(e.target.value) || 0)} className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums text-slate-100" />
                  </label>
                  <label className="space-y-1 text-slate-400">
                    20日 ATR
                    <input type="number" value={simAtr20} onChange={(e) => setSimAtr20(Number(e.target.value) || 0)} className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums text-slate-100" />
                  </label>
                  <label className="space-y-1 text-slate-400">
                    60MA
                    <input type="number" value={simMa60} onChange={(e) => setSimMa60(Number(e.target.value) || 0)} className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums text-slate-100" />
                  </label>
                  <label className="space-y-1 text-slate-400">
                    破200MA天數
                    <input type="number" value={simDaysBelow200} onChange={(e) => setSimDaysBelow200(Number(e.target.value) || 0)} className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums text-slate-100" />
                  </label>
                  <label className="flex items-end pb-1.5 gap-1.5 text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={simMoatBroken} onChange={(e) => setSimMoatBroken(e.target.checked)} className="accent-rose-500" />
                    護城河證偽
                  </label>
                </div>

                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <PriorityBadge priority={exitDecision.primaryPriority} />
                    <span className="font-mono tabular-nums text-slate-300">
                      賣出 {exitDecision.recommendedSellPct}% · 摩擦稅費 {formatTwd(exitDecision.estimatedFrictionCost)}
                    </span>
                  </div>
                  <div className="font-bold text-slate-100">{exitDecision.actionLabel}</div>
                  <div className="text-slate-400 leading-relaxed">{exitDecision.actionDetail}</div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
