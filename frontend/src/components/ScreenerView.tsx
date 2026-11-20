import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  FileUp,
  Plus,
  Search,
  Square,
  Stethoscope,
} from 'lucide-react';
import { evaluateCyclicalRating } from '../engine/cyclicalScoring';
import { evaluateFinancialRating } from '../engine/financialScoring';
import { rankBatchWithZScore } from '../engine/scoringBatchZ';
import type { BatchRankedStock, Grade } from '../engine/types';
import {
  generateTwCsvTemplate,
  parseTwCsvUniverse,
} from '../services/staticDataService';
import { useTwQuantStore } from '../store/useTwQuantStore';
import { formatTwd, GradeBadge } from './GradeBadge';

export const ScreenerView: React.FC = () => {
  const {
    regime,
    universe,
    selectedSizingIds,
    upsertUniverseStocks,
    toggleSizingSelection,
    loadCandidateIntoScorecard,
    addHolding,
    setActiveTab,
  } = useTwQuantStore();

  const [profileFilter, setProfileFilter] = useState<'ALL' | 'standard' | 'cyclical' | 'financial'>('ALL');
  const [gradeFilter, setGradeFilter] = useState<Grade | 'ALL'>('ALL');
  const [sectorFilter, setSectorFilter] = useState<string>('ALL');
  const [stageZeroFilter, setStageZeroFilter] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ ok: string[]; errors: string[] } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const ranked = useMemo(() => rankBatchWithZScore(universe, regime), [universe, regime]);
  const sectors = useMemo(
    () => Array.from(new Set(universe.map((s) => s.sector))).sort(),
    [universe]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ranked.filter((item) => {
      if (profileFilter === 'standard' && item.stock.recommendedProfile !== 'standard') return false;
      if (
        profileFilter === 'cyclical' &&
        item.stock.recommendedProfile !== 'cyclical_heavy_asset' &&
        item.stock.recommendedProfile !== 'cyclical_inventory_order'
      ) {
        return false;
      }
      if (
        profileFilter === 'financial' &&
        item.stock.recommendedProfile !== 'financial_bank' &&
        item.stock.recommendedProfile !== 'financial_life_fhc'
      ) {
        return false;
      }
      if (gradeFilter !== 'ALL' && item.rating.finalGrade !== gradeFilter) return false;
      if (sectorFilter !== 'ALL' && item.stock.sector !== sectorFilter) return false;
      if (stageZeroFilter === 'PASS' && !item.stageZero.passed) return false;
      if (stageZeroFilter === 'FAIL' && item.stageZero.passed) return false;
      if (
        q &&
        !item.stock.symbol.toLowerCase().includes(q) &&
        !item.stock.name.toLowerCase().includes(q) &&
        !item.stock.sector.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [ranked, profileFilter, gradeFilter, sectorFilter, stageZeroFilter, searchQuery]);

  const handleDownloadCsvTemplate = () => {
    const csv = generateTwCsvTemplate();
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tw_qvm_universe_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseTwCsvUniverse(String(reader.result ?? ''));
      if (res.stocks.length > 0) upsertUniverseStocks(res.stocks);
      setStatusMsg({
        ok: res.stocks.length > 0 ? [`成功匯入 ${res.stocks.length} 檔台股`] : [],
        errors: res.errors,
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAddHolding = (item: BatchRankedStock) => {
    const prof = item.stock.recommendedProfile;
    const isCyc = prof === 'cyclical_heavy_asset' || prof === 'cyclical_inventory_order';
    const isFin = prof === 'financial_bank' || prof === 'financial_life_fhc';
    const cycRating = isCyc
      ? evaluateCyclicalRating({
          profile: prof,
          regime,
          stageZero: item.stageZero,
          metrics: item.stock.cyclicalMetrics,
          price: item.stock.price,
          ma120: item.stock.ma120,
          ma200: item.stock.ma200,
          rev3mCumYoYPct: item.stock.rev3mCumYoYPct,
          rev12mCumYoYPct: item.stock.rev12mCumYoYPct,
        })
      : undefined;
    const finRating =
      isFin && item.stock.financialMetrics
        ? evaluateFinancialRating({
            profile: prof,
            regime,
            commonStageZeroInput: item.stock.stageZeroInput,
            metrics: item.stock.financialMetrics,
            price: item.stock.price,
            ma200: item.stock.ma200,
          })
        : undefined;

    addHolding({
      id: `HOLD-TW-${item.stock.symbol}-${Date.now()}`,
      symbol: item.stock.symbol,
      name: item.stock.name,
      sector: item.stock.sector,
      valuationProfile: prof,
      shares: 1000,
      costPrice: item.stock.price,
      currentPrice: item.stock.price,
      highestPriceSinceEntry: item.stock.price,
      atr20: item.stock.atr20,
      ma60: item.stock.ma50,
      ma120: item.stock.ma120,
      ma200: item.stock.ma200,
      daysBelow200Ma: item.stock.daysBelow200Ma,
      moatPermanentlyBroken: false,
      stopDrawdownThresholdPct: 15,
      currentRating: item.rating,
      currentBreakdown: item.breakdown,
      cyclicalMetrics: item.stock.cyclicalMetrics,
      cyclicalRating: cycRating,
      financialMetrics: item.stock.financialMetrics,
      financialRating: finRating,
    });
    setActiveTab('portfolio');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">
            台股多股批次篩選與同產業 Winsorize Z-Score 排名表
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            自動排除階段零紅燈後分產業 ±3σ 截尾標準化；若同產業樣本 &lt; 3 則回退至全批次母體
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={handleDownloadCsvTemplate}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            下載 CSV 範本
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-semibold flex items-center gap-1.5"
          >
            <FileUp className="w-3.5 h-3.5" />
            匯入 CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleUploadCsv}
            className="hidden"
          />
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs space-y-1">
          {statusMsg.ok.map((m, i) => (
            <div key={i} className="text-emerald-300">✓ {m}</div>
          ))}
          {statusMsg.errors.map((e, i) => (
            <div key={i} className="text-rose-300">✗ {e}</div>
          ))}
        </div>
      )}

      {/* Filter Bar */}
      <div className="p-3 rounded-xl bg-[#0f172a] border border-slate-800 flex flex-wrap items-center gap-3 text-xs">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          <input
            type="text"
            placeholder="搜尋代號、名稱或產業..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-slate-100"
          />
        </div>
        <select
          value={profileFilter}
          onChange={(e) =>
            setProfileFilter(e.target.value as 'ALL' | 'standard' | 'cyclical' | 'financial')
          }
          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700"
        >
          <option value="ALL">全部模型 (標準/循環/金融)</option>
          <option value="standard">標準非金融 (QVM)</option>
          <option value="cyclical">強景氣循環 (Cyclical-QVM)</option>
          <option value="financial">銀行與金控 (Fin-QVM)</option>
        </select>
        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value as Grade | 'ALL')}
          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700"
        >
          <option value="ALL">全部評級</option>
          <option value="A">僅 A 級</option>
          <option value="B">僅 B 級</option>
          <option value="C">僅 C 級</option>
          <option value="D">僅 D 級</option>
          <option value="F">僅 F 級</option>
        </select>
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700"
        >
          <option value="ALL">全部產業</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={stageZeroFilter}
          onChange={(e) => setStageZeroFilter(e.target.value as 'ALL' | 'PASS' | 'FAIL')}
          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700"
        >
          <option value="ALL">階段零：全部</option>
          <option value="PASS">僅通過防雷</option>
          <option value="FAIL">僅觸發紅燈</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-[#0f172a] border border-slate-800 overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
              <th className="py-2.5 px-3 w-8">配倉</th>
              <th className="py-2.5 px-3">代號 / 名稱</th>
              <th className="py-2.5 px-3">產業 / 推薦模型</th>
              <th className="py-2.5 px-3 text-right">現價</th>
              <th className="py-2.5 px-3 text-right">波動 σ</th>
              <th className="py-2.5 px-3 text-right">Q(40)</th>
              <th className="py-2.5 px-3 text-right">V(35)</th>
              <th className="py-2.5 px-3 text-right">M(25)</th>
              <th className="py-2.5 px-3 text-right">總分</th>
              <th className="py-2.5 px-3 text-center">標準 / 循環評級</th>
              <th className="py-2.5 px-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {filtered.map((item) => {
              const isExp = expandedId === item.stock.id;
              const isSel = selectedSizingIds.includes(item.stock.id);
              const prof = item.stock.recommendedProfile;
              const cycBadge =
                prof === 'cyclical_heavy_asset' || prof === 'cyclical_inventory_order'
                  ? evaluateCyclicalRating({
                      profile: prof,
                      regime,
                      stageZero: item.stageZero,
                      metrics: item.stock.cyclicalMetrics,
                      price: item.stock.price,
                      ma120: item.stock.ma120,
                      ma200: item.stock.ma200,
                      rev3mCumYoYPct: item.stock.rev3mCumYoYPct,
                      rev12mCumYoYPct: item.stock.rev12mCumYoYPct,
                    })
                  : null;
              const finBadge =
                (prof === 'financial_bank' || prof === 'financial_life_fhc') &&
                item.stock.financialMetrics
                  ? evaluateFinancialRating({
                      profile: prof,
                      regime,
                      commonStageZeroInput: item.stock.stageZeroInput,
                      metrics: item.stock.financialMetrics,
                      price: item.stock.price,
                      ma200: item.stock.ma200,
                    })
                  : null;

              return (
                <React.Fragment key={item.stock.id}>
                  <tr
                    className={`hover:bg-slate-800/40 cursor-pointer ${
                      !item.stageZero.passed ? 'bg-rose-950/15' : ''
                    }`}
                    onClick={() => setExpandedId(isExp ? null : item.stock.id)}
                  >
                    <td
                      className="py-2.5 px-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.stageZero.passed) toggleSizingSelection(item.stock.id);
                      }}
                    >
                      <button disabled={!item.stageZero.passed} className="disabled:opacity-30">
                        {isSel ? (
                          <CheckSquare className="w-4 h-4 text-cyan-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500" />
                        )}
                      </button>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        {isExp ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-300 uppercase">
                          {item.stock.marketType}
                        </span>
                        <span className="font-mono font-bold text-slate-100">{item.stock.symbol}</span>
                        <span className="text-slate-300">{item.stock.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">
                      <div>
                        {item.stock.sector}
                        {item.stageZero.passed && (
                          <span className="ml-1 text-[10px] text-slate-500">
                            ({item.fallbackToMarketPool ? '回退母體' : `n=${item.sectorSampleCount}`})
                          </span>
                        )}
                      </div>
                      {item.stock.recommendedProfile !== 'standard' && (
                        <span
                          className={`text-[10px] ${
                            prof.startsWith('financial') ? 'text-emerald-300' : 'text-fuchsia-300'
                          }`}
                        >
                          推薦：
                          {prof === 'cyclical_heavy_asset'
                            ? '重資產循環'
                            : prof === 'cyclical_inventory_order'
                              ? '存貨訂單循環'
                              : prof === 'financial_bank'
                                ? '金融銀行型'
                                : '壽險雙引擎'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200">
                      {formatTwd(item.stock.price)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                      {item.stock.annualizedVolPct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-300">
                      {item.breakdown.sQ.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-cyan-300">
                      {item.breakdown.sV.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-violet-300">
                      {item.breakdown.sM.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-100">
                      {item.rating.finalScore.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        <GradeBadge grade={item.rating.finalGrade} />
                        {cycBadge && (
                          <span className="text-[10px] text-fuchsia-300 font-mono">
                            / 循環 {cycBadge.finalGrade}
                          </span>
                        )}
                        {finBadge && (
                          <span className="text-[10px] text-emerald-300 font-mono">
                            / Fin {finBadge.finalGrade}
                          </span>
                        )}
                        {item.rating.antiBiasDowngraded && (
                          <span title={item.rating.antiBiasReasons.join('；')}>
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => loadCandidateIntoScorecard(item.stock)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1"
                        >
                          <Stethoscope className="w-3 h-3" />
                          健檢
                        </button>
                        <button
                          onClick={() => handleAddHolding(item)}
                          className="px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          持倉
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isExp && (
                    <tr className="bg-slate-950/75">
                      <td colSpan={11} className="p-4 space-y-2.5">
                        {item.stock.notes && (
                          <div className="text-slate-300">
                            <strong>解析說明：</strong>{item.stock.notes}
                          </div>
                        )}
                        {!item.stageZero.passed ? (
                          <div className="p-3 rounded bg-rose-500/10 border border-rose-500/40 text-rose-200 space-y-1">
                            {item.stageZero.redFlags.map((f) => (
                              <div key={f.code}>• <strong>{f.title}</strong>：{f.detail}</div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[11px] font-mono tabular-nums">
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <div className="text-slate-400">ROIC (百分位)</div>
                              <div>{item.stock.roicPct.toFixed(1)}% ({item.subScoresPct.roic.toFixed(0)}分)</div>
                            </div>
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <div className="text-slate-400">EV/EBITDA</div>
                              <div>{item.stock.evToEbitda.toFixed(1)}x ({item.subScoresPct.evMultiple.toFixed(0)}分)</div>
                            </div>
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <div className="text-slate-400">P/B 5-7Y位階</div>
                              <div>{item.stock.cyclicalMetrics.pbPercentile5to7Y ?? '-'}%</div>
                            </div>
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <div className="text-slate-400">3M累計營收YoY</div>
                              <div>{item.stock.rev3mCumYoYPct.toFixed(1)}%</div>
                            </div>
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <div className="text-slate-400">最新 DIO</div>
                              <div>{item.stock.cyclicalMetrics.latestDio ?? '-'} 天</div>
                            </div>
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <div className="text-slate-400">毛利率 QoQ</div>
                              <div>{item.stock.cyclicalMetrics.grossMarginQoQ ?? '-'}%</div>
                            </div>
                          </div>
                        )}
                        {cycBadge?.isPeakCircuitBreakerTriggered && (
                          <div className="p-2.5 rounded bg-rose-600/20 border border-rose-500/50 text-rose-200">
                            {cycBadge.peakCircuitBreakerReasons.join('；')}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
