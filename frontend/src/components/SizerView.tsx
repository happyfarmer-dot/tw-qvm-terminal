import React, { useMemo } from 'react';
import { AlertTriangle, Sparkles, Wand2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  calculatePortfolioSizing,
  suggestWeightBoundsForCount,
} from '../engine/portfolioSizing';
import { rankBatchWithZScore } from '../engine/scoringBatchZ';
import { useTwQuantStore } from '../store/useTwQuantStore';
import { formatTwd, formatTwLots, GradeBadge } from './GradeBadge';

export const SizerView: React.FC = () => {
  const {
    regime,
    universe,
    selectedSizingIds,
    sizingConfig,
    setSelectedSizingIds,
    toggleSizingSelection,
    updateSizingConfig,
  } = useTwQuantStore();

  const ranked = useMemo(() => rankBatchWithZScore(universe, regime), [universe, regime]);
  const passedRanked = useMemo(() => ranked.filter((r) => r.stageZero.passed), [ranked]);

  const selectedCandidates = useMemo(
    () =>
      passedRanked
        .filter((r) => selectedSizingIds.includes(r.stock.id))
        .map((r) => ({
          id: r.stock.id,
          symbol: r.stock.symbol,
          name: r.stock.name,
          sector: r.stock.sector,
          price: r.stock.price,
          annualizedVolPct: r.stock.annualizedVolPct,
          finalScore: r.rating.finalScore,
          grade: r.rating.finalGrade,
        })),
    [passedRanked, selectedSizingIds]
  );

  const sizingResult = useMemo(
    () => calculatePortfolioSizing(selectedCandidates, sizingConfig),
    [selectedCandidates, sizingConfig]
  );

  const handleSelectAGrade = () => {
    setSelectedSizingIds(
      passedRanked.filter((r) => r.rating.finalGrade === 'A').map((r) => r.stock.id)
    );
  };

  const handleAutoTuneBounds = () => {
    updateSizingConfig(
      suggestWeightBoundsForCount(selectedCandidates.length, sizingConfig.portfolioMode)
    );
  };

  const stockChartData = sizingResult.allocations.map((a) => ({
    symbol: a.candidate.symbol,
    weight: Number(a.finalWeightPct.toFixed(2)),
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">
            台股反波動率倉位配置機（自動換算張／零股與電子股集中度鎖定）
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            依 1/σᵢ 計算權重並執行迭代截斷上下限，檢查單一產業（電子／半導體）25%–30% 上限紅線
          </p>
        </div>
        <button
          onClick={handleSelectAGrade}
          className="px-3 py-1.5 text-xs rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-semibold flex items-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          自動選取 A 級候選股
        </button>
      </div>

      {/* Config */}
      <section className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <label className="space-y-1">
            <span className="text-slate-400">總主動資金 (TWD)</span>
            <input
              type="number"
              step={100000}
              value={sizingConfig.totalActiveCapital}
              onChange={(e) =>
                updateSizingConfig({ totalActiveCapital: Number(e.target.value) || 0 })
              }
              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">組合模式</span>
            <select
              value={sizingConfig.portfolioMode}
              onChange={(e) =>
                updateSizingConfig({ portfolioMode: e.target.value as 'SATELLITE' | 'FULL' })
              }
              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700"
            >
              <option value="SATELLITE">衛星精簡 (8–12 檔)</option>
              <option value="FULL">獨立全倉 (15–25 檔)</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">單股下限 (%)</span>
            <input
              type="number"
              step="0.5"
              value={sizingConfig.minWeightPct}
              onChange={(e) => updateSizingConfig({ minWeightPct: Number(e.target.value) || 0 })}
              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">單股上限 (%)</span>
            <input
              type="number"
              step="0.5"
              value={sizingConfig.maxWeightPct}
              onChange={(e) => updateSizingConfig({ maxWeightPct: Number(e.target.value) || 6 })}
              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">產業集中上限 (25–30%)</span>
            <input
              type="number"
              step="1"
              value={sizingConfig.sectorCapPct}
              onChange={(e) => updateSizingConfig({ sectorCapPct: Number(e.target.value) || 25 })}
              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
            />
          </label>
          <div className="flex items-end">
            <button
              onClick={handleAutoTuneBounds}
              className="w-full px-2.5 py-1.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 font-medium flex items-center justify-center gap-1"
            >
              <Wand2 className="w-3.5 h-3.5" />
              依檔數微調上限
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={sizingConfig.applySectorScaling}
              onChange={(e) => updateSizingConfig({ applySectorScaling: e.target.checked })}
              className="accent-cyan-400"
            />
            超過產業上限 {sizingConfig.sectorCapPct}% 自動等比例縮減
          </label>
          <div className="flex items-center gap-4 font-mono tabular-nums">
            <span>已配置：<strong className="text-emerald-300">{sizingResult.totalWeightPct.toFixed(2)}%</strong></span>
            <span>現金保留：<strong className="text-amber-300">{sizingResult.cashReservePct.toFixed(2)}%</strong></span>
          </div>
        </div>
      </section>

      {sizingResult.warnings.length > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200 space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-amber-300">
            <AlertTriangle className="w-4 h-4" />
            倉位與產業集中度風控提示
          </div>
          {sizingResult.warnings.map((w, i) => (
            <div key={i}>• {w}</div>
          ))}
        </div>
      )}

      {/* Candidate Picker */}
      <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 flex flex-wrap gap-2">
        {passedRanked.map((item) => {
          const active = selectedSizingIds.includes(item.stock.id);
          return (
            <button
              key={item.stock.id}
              onClick={() => toggleSizingSelection(item.stock.id)}
              className={`px-2.5 py-1 rounded-lg text-xs border flex items-center gap-1.5 ${
                active
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="font-mono font-bold">{item.stock.symbol}</span>
              <span>{item.stock.name}</span>
              <GradeBadge grade={item.rating.finalGrade} />
            </button>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">個股配置權重 (%)</h2>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stockChartData} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="symbol" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="%" />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={sizingConfig.maxWeightPct} stroke="#f59e0b" strokeDasharray="4 4" />
                <Bar dataKey="weight" name="最終權重 %" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">
            單一產業曝險 vs {sizingConfig.sectorCapPct}% 紅線
          </h2>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sizingResult.sectorExposures} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="sector" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="%" />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={sizingConfig.sectorCapPct} stroke="#f43f5e" strokeWidth={2} strokeDasharray="4 4" />
                <Bar dataKey="unscaledWeightPct" name="縮減前 %" fill="#475569" radius={[4, 4, 0, 0]} />
                <Bar dataKey="finalWeightPct" name="最終權重 %" radius={[4, 4, 0, 0]}>
                  {sizingResult.sectorExposures.map((s, idx) => (
                    <Cell
                      key={idx}
                      fill={s.exceedsCap && !sizingConfig.applySectorScaling ? '#f43f5e' : '#06b6d4'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-[#0f172a] border border-slate-800 overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
              <th className="py-2.5 px-3">代號 / 名稱</th>
              <th className="py-2.5 px-3">產業</th>
              <th className="py-2.5 px-3 text-center">評級</th>
              <th className="py-2.5 px-3 text-right">波動 σ</th>
              <th className="py-2.5 px-3 text-right">原始反波動</th>
              <th className="py-2.5 px-3 text-right">最終權重</th>
              <th className="py-2.5 px-3 text-right">配置金額 (TWD)</th>
              <th className="py-2.5 px-3 text-right">建議買進（張／零股）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {sizingResult.allocations.map((a) => (
              <tr key={a.candidate.id} className="hover:bg-slate-800/30">
                <td className="py-2.5 px-3">
                  <span className="font-mono font-bold text-slate-100 mr-1.5">{a.candidate.symbol}</span>
                  <span className="text-slate-300">{a.candidate.name}</span>
                </td>
                <td className="py-2.5 px-3 text-slate-300">
                  {a.candidate.sector}
                  {a.sectorScaledDown && (
                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                      產業縮減
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-center">
                  <GradeBadge grade={a.candidate.grade} />
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                  {a.candidate.annualizedVolPct.toFixed(1)}%
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                  {a.rawInverseVolWeightPct.toFixed(2)}%
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-300">
                  {a.finalWeightPct.toFixed(2)}%
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200">
                  {formatTwd(a.allocatedAmount)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-cyan-300">
                  {formatTwLots(a.suggestedShares)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
