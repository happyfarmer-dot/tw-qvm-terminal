import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  Award,
  Flame,
  Layers,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
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
import { evaluateCyclicalRating } from '../engine/cyclicalScoring';
import { evaluateFinancialRating } from '../engine/financialScoring';
import { calculatePortfolioSizing } from '../engine/portfolioSizing';
import { rankBatchWithZScore } from '../engine/scoringBatchZ';
import { evaluateStageZero } from '../engine/stageZero';
import { adviseHoldingExit, getNextTwPitReviewDate } from '../engine/tradeAdvisor';
import { useTwQuantStore } from '../store/useTwQuantStore';
import { formatTwd, GradeBadge, PriorityBadge } from './GradeBadge';

export const DashboardView: React.FC = () => {
  const {
    regime,
    universe,
    holdings,
    selectedSizingIds,
    sizingConfig,
    frictionConfig,
    setActiveTab,
    loadCandidateIntoScorecard,
  } = useTwQuantStore();

  const [quickSearch, setQuickSearch] = useState('');

  const ranked = useMemo(() => rankBatchWithZScore(universe, regime), [universe, regime]);

  const quickCards = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    const list = ranked.map((r) => r.stock);
    if (!q) return list.slice(0, 9);
    return list
      .filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.sector.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [ranked, quickSearch]);

  const cyclicalAlerts = useMemo(() => {
    return universe
      .filter(
        (s) =>
          s.recommendedProfile === 'cyclical_heavy_asset' ||
          s.recommendedProfile === 'cyclical_inventory_order'
      )
      .map((s) => {
        const sz = evaluateStageZero(s.stageZeroInput, s.recommendedProfile);
        const cyc = evaluateCyclicalRating({
          profile: s.recommendedProfile as 'cyclical_heavy_asset' | 'cyclical_inventory_order',
          regime,
          stageZero: sz,
          metrics: s.cyclicalMetrics,
          price: s.price,
          ma120: s.ma120,
          ma200: s.ma200,
          rev3mCumYoYPct: s.rev3mCumYoYPct,
          rev12mCumYoYPct: s.rev12mCumYoYPct,
        });
        return { stock: s, cyc };
      });
  }, [universe, regime]);

  const financialAlerts = useMemo(() => {
    return universe
      .filter(
        (s) =>
          (s.recommendedProfile === 'financial_bank' ||
            s.recommendedProfile === 'financial_life_fhc') &&
          s.financialMetrics
      )
      .map((s) => {
        const fin = evaluateFinancialRating({
          profile: s.recommendedProfile as 'financial_bank' | 'financial_life_fhc',
          regime,
          commonStageZeroInput: s.stageZeroInput,
          metrics: s.financialMetrics!,
          price: s.price,
          ma200: s.ma200,
        });
        return { stock: s, fin };
      });
  }, [universe, regime]);

  const aCandidates = ranked.filter((r) => r.rating.finalGrade === 'A');
  const fBlocked = ranked.filter((r) => r.rating.finalGrade === 'F');
  const peakBreakers = cyclicalAlerts.filter((c) => c.cyc.isPeakCircuitBreakerTriggered);

  const totalHoldingVal = useMemo(
    () => holdings.reduce((acc, h) => acc + h.currentPrice * h.shares, 0),
    [holdings]
  );

  const holdingDecisions = useMemo(() => {
    const lowest = holdings.reduce((m, h) => Math.min(m, h.currentRating.finalScore), 100);
    const bestA = aCandidates.find((a) => !holdings.some((h) => h.symbol === a.stock.symbol));
    return holdings.map((h) =>
      adviseHoldingExit({
        holding: h,
        totalActivePortfolioValue: totalHoldingVal,
        isFullInvested: true,
        isLowestScoringHolding: h.currentRating.finalScore === lowest,
        bestNewACandidate: bestA
          ? { symbol: bestA.stock.symbol, name: bestA.stock.name, finalScore: bestA.rating.finalScore }
          : null,
        frictionConfig,
      })
    );
  }, [holdings, totalHoldingVal, aCandidates, frictionConfig]);

  const alertHoldings = holdingDecisions.filter((d) => d.primaryPriority !== 'HOLD');

  const sizingPreview = useMemo(() => {
    const picked = ranked.filter((r) => selectedSizingIds.includes(r.stock.id));
    return calculatePortfolioSizing(
      picked.map((r) => ({
        id: r.stock.id,
        symbol: r.stock.symbol,
        name: r.stock.name,
        sector: r.stock.sector,
        price: r.stock.price,
        annualizedVolPct: r.stock.annualizedVolPct,
        finalScore: r.rating.finalScore,
        grade: r.rating.finalGrade,
      })),
      sizingConfig
    );
  }, [ranked, selectedSizingIds, sizingConfig]);

  const gradeDistribution = useMemo(() => {
    const c: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    ranked.forEach((r) => {
      c[r.rating.finalGrade] = (c[r.rating.finalGrade] ?? 0) + 1;
    });
    return [
      { grade: 'A 級', count: c.A, fill: '#10b981' },
      { grade: 'B 級', count: c.B, fill: '#06b6d4' },
      { grade: 'C 級', count: c.C, fill: '#f59e0b' },
      { grade: 'D 級', count: c.D, fill: '#f97316' },
      { grade: 'F 級(雷)', count: c.F, fill: '#f43f5e' },
    ];
  }, [ranked]);

  const pit = getNextTwPitReviewDate();
  const maxSec = sizingPreview.sectorExposures[0];

  return (
    <div className="space-y-5">
      {universe.length === 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-amber-200 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-amber-300 text-sm flex items-center gap-1.5">
              ⚡ 首批真實台股數據建庫中
            </span>
            <a
              href="https://github.com/happyfarmer-dot/tw-qvm-terminal/actions"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:underline font-semibold"
            >
              查看 GitHub Actions 執行進度 ↗
            </a>
          </div>
          <p className="text-slate-300 leading-relaxed">
            系統正在透過 GitHub Actions 在背景自動抓取台股真實 7 年財報與大盤日線數據（約需 2–3 分鐘）。無須任何人工操作，完成後重新整理此頁面即可自動呈現最新全套戰報！
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">
            台股穩健選股與買賣建議搜尋平台
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {regime === 'DEFENSIVE' ? '大盤防禦模式（首筆建議 30%）' : '大盤常態模式（首筆建議 50%）'} ｜ {pit.label}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('screener')}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 flex items-center gap-1.5"
          >
            全清單篩選比較
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('scorecard')}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
          >
            查看個股深度健檢書
          </button>
        </div>
      </div>

      {/* 主搜尋畫面：快速搜尋與精選個股卡片（點擊任一卡片直接開啟《個股深度健檢報告書》） */}
      {universe.length > 0 && (
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0f172a] border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-100">
                  🔍 點擊任一股票卡片，立即開啟《個股深度健檢報告書》
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 tabular-nums">
                  已收錄 {universe.length} 檔高流動性體質台股
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                全市場動態漏斗自動篩選（日成交額 ≥ 5,000 萬、股價 ≥ 15 元），自動適配標準／循環／金融三大診斷模型
              </p>
            </div>
            <input
              type="text"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              placeholder="輸入代號、名稱或產業搜尋 (如 2330, 台積電, 金控)..."
              className="w-full sm:w-72 px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-700 text-slate-100"
            />
          </div>

          {quickCards.length === 0 && quickSearch.trim() !== '' ? (
            <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/35 text-xs sm:text-sm text-amber-200 leading-relaxed">
              找不到「<strong className="font-mono">{quickSearch.trim()}</strong>」：此代號未通過「日成交額 ≥ 5,000 萬、股價 ≥ 15 元與基本獲利」初篩（或尚在排程建庫中）；如需強制追蹤，可加入 <code className="px-1.5 py-0.5 rounded bg-slate-900 text-cyan-300">pipeline/custom_watchlist.json</code>。
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {quickCards.map((stock) => {
                const hr = stock.healthReport;
                const grade = hr?.executiveSummary.grade ?? 'B';
                const score = hr?.executiveSummary.totalScore ?? 75;
                const verdict = hr?.executiveSummary.verdictBadge ?? `${grade} 級｜穩健觀察`;
                const stance = hr?.actionPlan.stanceLabel ?? '逢低分批布局';
                const stopPrice = hr?.actionPlan.sellAndDefenseStrategy.stopLossPrice;

                return (
                  <div
                    key={stock.id}
                    onClick={() => loadCandidateIntoScorecard(stock, stock.recommendedProfile)}
                    className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-cyan-500/50 cursor-pointer transition-all flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-extrabold text-base text-slate-100 group-hover:text-cyan-300 transition">
                            {stock.symbol}
                          </span>
                          <span className="font-bold text-sm text-slate-100 truncate">
                            {stock.name}
                          </span>
                        </div>
                        <GradeBadge grade={grade} />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-slate-400">{stock.sector}</span>
                        <span className="font-mono font-bold tabular-nums text-cyan-300">
                          {formatTwd(stock.price)}
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed pt-1">
                        {hr?.executiveSummary.oneLineDiagnosis ?? `${stock.name}基本面與現金流穩健，點擊查看完整五章節深度健檢報告。`}
                      </p>
                    </div>

                    <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                      <span className="text-emerald-300 font-semibold">
                        {verdict}（{score.toFixed(0)}分）
                      </span>
                      <span className="text-slate-400 group-hover:text-cyan-300 font-medium flex items-center gap-1">
                        {stopPrice ? `停損 NT$${stopPrice}` : stance} →
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>標準 Z-Score A 級候選</span>
            <Award className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-emerald-300">
            {aCandidates.length}
            <span className="text-sm font-normal text-slate-400 ml-1.5">/ {ranked.length} 檔</span>
          </div>
          <div className="text-xs text-slate-400">
            首倉比例：<span className="font-mono text-slate-200">{regime === 'DEFENSIVE' ? '30%' : '50%'}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>防雷／過熱熔斷攔截</span>
            <AlertOctagon className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-rose-300">
            {fBlocked.length + peakBreakers.length}
            <span className="text-sm font-normal text-slate-400 ml-1.5">檔高危</span>
          </div>
          <div className="text-xs text-slate-400">
            階段零 F 級 {fBlocked.length} 檔 ｜ 過熱熔斷 {peakBreakers.length} 檔
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>持倉觸發 P0–P4 警訊</span>
            <ShieldAlert className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-amber-300">
            {alertHoldings.length}
            <span className="text-sm font-normal text-slate-400 ml-1.5">/ {holdings.length} 檔</span>
          </div>
          <div className="text-xs text-slate-400 font-mono tabular-nums">
            持倉總值：{formatTwd(totalHoldingVal)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>最大單一產業曝險</span>
            <Layers className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-cyan-300">
            {maxSec ? `${maxSec.finalWeightPct.toFixed(1)}%` : '0.0%'}
            <span className="text-sm font-normal text-slate-400 ml-1.5">/ 上限 {sizingConfig.sectorCapPct}%</span>
          </div>
          <div className="text-xs text-slate-400">
            {maxSec ? maxSec.sector : '尚未配置'}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
            台股池評級分佈
          </h2>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gradeDistribution} margin={{ top: 10, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="grade" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="count" name="檔數" radius={[6, 6, 0, 0]}>
                  {gradeDistribution.map((e, i) => (
                    <Cell key={i} fill={e.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-200">
              電子／產業曝險 vs {sizingConfig.sectorCapPct}% 紅線
            </h2>
            <button onClick={() => setActiveTab('sizer')} className="text-xs text-cyan-400 hover:underline">
              開啟倉位配置機 →
            </button>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sizingPreview.sectorExposures} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="sector" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 12 }}
                />
                <ReferenceLine y={sizingConfig.sectorCapPct} stroke="#f43f5e" strokeDasharray="4 4" />
                <Bar dataKey="finalWeightPct" name="調整後權重 %" fill="#06b6d4" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Cyclical Spotlight & Holdings Decisions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Flame className="w-4 h-4 text-fuchsia-400" />
            特化模型診斷焦點（Cyclical-QVM ＋ Fin-QVM）
          </h2>
          <div className="divide-y divide-slate-800">
            {cyclicalAlerts.map(({ stock, cyc }) => {
              const stdItem = ranked.find((r) => r.stock.id === stock.id);
              return (
                <div key={stock.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-100">{stock.symbol}</span>
                      <span className="text-slate-200 truncate">{stock.name}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      標準：<strong className="text-slate-200">{stdItem?.rating.finalGrade} 級</strong> →
                      循環：<strong className="text-fuchsia-300">{cyc.finalGrade} 級 ({cyc.finalScore.toFixed(1)}分)</strong>
                      {cyc.isPeakCircuitBreakerTriggered && ' · 過熱熔斷'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <GradeBadge grade={cyc.finalGrade} />
                    <button
                      onClick={() => loadCandidateIntoScorecard(stock, stock.recommendedProfile)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
                    >
                      健檢
                    </button>
                  </div>
                </div>
              );
            })}
            {financialAlerts.map(({ stock, fin }) => (
              <div key={stock.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-100">{stock.symbol}</span>
                    <span className="text-slate-200 truncate">{stock.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Fin-QVM：<strong className="text-emerald-300">{fin.finalGrade} 級 ({fin.finalScore.toFixed(1)}分)</strong>
                    {' · '}合理 P/B {fin.recalculatedJustifiedPB ?? '-'}x
                    {fin.isFinancialTrapCircuitBreakerTriggered && ' · 高息陷阱熔斷'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <GradeBadge grade={fin.finalGrade} />
                  <button
                    onClick={() => loadCandidateIntoScorecard(stock, stock.recommendedProfile)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
                  >
                    健檢
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">既有持倉出場矩陣即時預警</h2>
            <button onClick={() => setActiveTab('portfolio')} className="text-xs text-cyan-400 hover:underline">
              管理持倉 →
            </button>
          </div>
          <div className="divide-y divide-slate-800">
            {holdingDecisions.map((d) => (
              <div key={d.holdingId} className="py-2.5 space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={d.primaryPriority} />
                    <span className="font-mono font-bold text-slate-100">{d.symbol}</span>
                    <span className="text-slate-300">{d.name}</span>
                  </div>
                  <span className="font-mono tabular-nums text-slate-400">
                    權重 {d.positionWeightPct.toFixed(1)}%
                  </span>
                </div>
                <div className="text-slate-400">{d.actionDetail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
