import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BarChart3,
  Check,
  CheckCircle2,
  ClipboardCopy,
  HelpCircle,
  Printer,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ensureStockHealthReport,
  formatHealthReportPlainText,
} from '../engine/healthReportGenerator';
import type {
  Grade,
  HealthDimensionMetric,
  HealthSafetyItem,
  TwStockCandidate,
} from '../engine/types';
import { useTwQuantStore } from '../store/useTwQuantStore';

function formatPriceTwd(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '待確認';
  return `NT$ ${val.toLocaleString('en-US', {
    minimumFractionDigits: val < 50 ? 2 : 1,
    maximumFractionDigits: 2,
  })}`;
}

function getGradeTheme(grade: Grade): {
  ring: string;
  bg: string;
  text: string;
  badgeBg: string;
} {
  switch (grade) {
    case 'A':
      return {
        ring: 'border-emerald-500/60',
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-300',
        badgeBg: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200',
      };
    case 'B':
      return {
        ring: 'border-cyan-500/60',
        bg: 'bg-cyan-500/15',
        text: 'text-cyan-300',
        badgeBg: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200',
      };
    case 'C':
      return {
        ring: 'border-amber-500/60',
        bg: 'bg-amber-500/15',
        text: 'text-amber-300',
        badgeBg: 'bg-amber-500/20 border-amber-500/50 text-amber-200',
      };
    case 'D':
      return {
        ring: 'border-orange-500/60',
        bg: 'bg-orange-500/15',
        text: 'text-orange-300',
        badgeBg: 'bg-orange-500/20 border-orange-500/50 text-orange-200',
      };
    case 'F':
    default:
      return {
        ring: 'border-rose-500/60',
        bg: 'bg-rose-500/15',
        text: 'text-rose-300',
        badgeBg: 'bg-rose-500/20 border-rose-500/50 text-rose-200',
      };
  }
}

const SafetyStatusBadge: React.FC<{ status: HealthSafetyItem['status'] }> = ({ status }) => {
  if (status === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 print-text-primary">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        綠燈｜通過
      </span>
    );
  }
  if (status === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 print-text-primary">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        黃燈｜留意
      </span>
    );
  }
  if (status === 'fail') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 print-text-primary">
        <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
        紅燈｜高危
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-700/60 text-slate-300 border border-slate-600 print-text-secondary">
      <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      灰燈｜待確認
    </span>
  );
};

const MetricStatusTag: React.FC<{ status: HealthDimensionMetric['status'] }> = ({ status }) => {
  const styles: Record<HealthDimensionMetric['status'], string> = {
    優秀: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    穩健: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    偏貴: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    警訊: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    待確認: 'bg-slate-800 text-slate-300 border-slate-700',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${styles[status]} print-text-primary`}
    >
      {status}
    </span>
  );
};

export interface StockHealthReportViewProps {
  stock?: TwStockCandidate;
  onBackToSearch?: () => void;
}

export const StockHealthReportView: React.FC<StockHealthReportViewProps> = ({
  stock: propStock,
  onBackToSearch,
}) => {
  const {
    universe,
    regime,
    manualSymbol,
    manifest,
    loadCandidateIntoScorecard,
    setActiveTab,
  } = useTwQuantStore();

  const [copied, setCopied] = useState(false);

  const activeStock = useMemo(() => {
    if (propStock) return propStock;
    if (universe.length === 0) return null;
    return (
      universe.find((s) => s.symbol === manualSymbol) ??
      universe.find((s) => s.symbol === '2330') ??
      universe[0]
    );
  }, [propStock, universe, manualSymbol]);

  const report = useMemo(() => {
    if (!activeStock) return null;
    const fallbackDate = manifest?.updatedAtTaipei?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    return ensureStockHealthReport(activeStock, regime, fallbackDate);
  }, [activeStock, regime, manifest]);

  const handleBack = () => {
    if (onBackToSearch) {
      onBackToSearch();
    } else {
      setActiveTab('screener');
    }
  };

  const handleCopySummary = async () => {
    if (!activeStock || !report) return;
    const text = formatHealthReportPlainText(activeStock, report);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handlePrintPdf = () => {
    window.print();
  };

  if (!activeStock || !report) {
    return (
      <div className="max-w-4xl mx-auto p-6 rounded-2xl bg-[#0f172a] border border-slate-800 text-center space-y-3">
        <div className="text-base font-bold text-amber-300">
          ⚡ 首批真實台股數據正在背景自動建庫中
        </div>
        <p className="text-sm text-slate-300">
          系統正在透過 GitHub Actions 自動抓取台股 7 年財報與最新收盤數據，約 2–3 分鐘後重新整理頁面即可查看完整《個股深度健檢報告書》。
        </p>
      </div>
    );
  }

  const { executiveSummary: ex, safetyCheckup, dimensions, actionPlan, chartSeries } = report;
  const theme = getGradeTheme(ex.grade);
  const hasDioSeries = chartSeries.quarterlyTrend.some((pt) => pt.dio !== null);
  const hasRevSeries = chartSeries.quarterlyTrend.some((pt) => pt.revenueYi !== null);
  const valBand = chartSeries.valuationBand;

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-10 print-report-container">
      {/* 頂部固定導覽與操作列（列印時自動隱藏） */}
      <div className="sticky top-14 z-20 bg-[#0b111e]/95 backdrop-blur border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5 shadow-lg no-print">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleBack}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            ← 返回選股搜尋
          </button>

          {universe.length > 1 && (
            <select
              value={activeStock.symbol}
              onChange={(e) => {
                const match = universe.find((u) => u.symbol === e.target.value);
                if (match) loadCandidateIntoScorecard(match);
              }}
              aria-label="切換健檢個股"
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 max-w-[190px] sm:max-w-[240px]"
            >
              {universe.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.symbol} {s.name}（{s.sector}）
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void handleCopySummary()}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
              copied
                ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200'
                : 'bg-cyan-500/15 hover:bg-cyan-500/25 border-cyan-500/40 text-cyan-200'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
            {copied ? '已複製戰報文字！' : '📋 複製報告摘要'}
          </button>

          <button
            onClick={handlePrintPdf}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Printer className="w-3.5 h-3.5" />
            🖨️ 列印 / 存 PDF
          </button>
        </div>
      </div>

      {/* 1. 報告抬頭與總體診斷卡 (Executive Summary Card) */}
      <section className="rounded-2xl bg-[#0f172a] border border-slate-800 p-5 sm:p-6 space-y-5 print-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 print-text-secondary">
                個股深度健檢報告書
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-xs bg-slate-800 text-slate-300 border border-slate-700 print-text-secondary">
                {activeStock.marketType === 'tpex' ? '上櫃' : '上市'} · {activeStock.sector}
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-xs bg-violet-500/15 text-violet-300 border border-violet-500/30 print-text-secondary">
                適配策略：{ex.profileLabel}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-3 pt-1">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-100 print-text-primary">
                {activeStock.symbol} {activeStock.name}
              </h1>
              <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-cyan-300 print-text-primary">
                {formatPriceTwd(activeStock.price)}
              </span>
            </div>

            <div className="text-xs text-slate-400 print-text-muted">
              報告數據基準日：<span className="font-mono tabular-nums">{ex.reportDate}</span>
              {' ｜ '}適合投資屬性：<strong className="text-slate-200 print-text-primary">{ex.suitableFor}</strong>
            </div>
          </div>

          {/* 綜合健檢總分與評級徽章 */}
          <div className="flex items-center gap-4 self-start sm:self-center">
            <div
              className={`w-24 h-24 rounded-2xl border-2 ${theme.ring} ${theme.bg} flex flex-col items-center justify-center shrink-0 print-subcard`}
            >
              <span className="text-[11px] text-slate-300 font-medium print-text-muted">綜合健檢總分</span>
              <span className={`text-3xl font-black font-mono tabular-nums ${theme.text} print-text-primary`}>
                {ex.totalScore.toFixed(0)}
              </span>
              <span className="text-[11px] text-slate-400 print-text-muted">/ 100 分</span>
            </div>

            <div className="space-y-1.5">
              <div
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-sm font-extrabold ${theme.badgeBg} print-subcard print-text-primary`}
              >
                <Award className="w-4 h-4 shrink-0" />
                {ex.verdictBadge}
              </div>
              <div className="text-xs text-slate-400 print-text-muted">
                操作立場：<strong className="text-slate-200 print-text-primary">{actionPlan.stanceLabel}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* 白話總評框 */}
        <div className="rounded-xl bg-slate-900/90 border border-slate-700/80 p-4 space-y-1.5 print-subcard">
          <div className="text-xs font-bold text-cyan-300 flex items-center gap-1.5 print-text-primary">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
            白話總體診斷結論
          </div>
          <p className="text-sm sm:text-base text-slate-100 leading-relaxed font-medium print-text-primary">
            {ex.oneLineDiagnosis}
          </p>
        </div>
      </section>

      {/* 2. 第一節：體質與防雷安全檢查表 */}
      <section className="rounded-2xl bg-[#0f172a] border border-slate-800 p-5 sm:p-6 space-y-4 print-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2 print-text-primary">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              第一節：防雷與體質安全檢查表
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 print-text-muted">
              買進前先確認不會踩雷：檢視市場流動性、大股東質押籌碼、真實現金流與帳務健康度
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-800/80">
          {safetyCheckup.map((item, idx) => (
            <div
              key={idx}
              className="py-3.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-100 print-text-primary">
                    {idx + 1}. {item.itemName}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-xs font-mono tabular-nums text-cyan-300 print-subcard print-text-primary">
                    {item.displayValue}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed print-text-secondary">
                  {item.plainExplanation}
                </p>
              </div>

              <div className="shrink-0 self-start sm:self-center">
                <SafetyStatusBadge status={item.status} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. 第二節：三大核心維度健檢明細（品質 / 價值 / 動能） */}
      <section className="space-y-4">
        <div className="px-1">
          <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2 print-text-primary">
            <TrendingUp className="w-5 h-5 text-cyan-400 shrink-0" />
            第二節：三大核心維度深度健檢（賺錢實力 ／ 價格合理度 ／ 成長動能）
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 print-text-muted">
            逐項拆解每一分是如何獲得、哪些指標表現優異或需要留意
          </p>
        </div>

        <div className="space-y-4">
          {dimensions.map((dim, dIdx) => {
            const barColor =
              dim.scorePct >= 75
                ? 'bg-emerald-500'
                : dim.scorePct >= 55
                  ? 'bg-cyan-500'
                  : dim.scorePct >= 40
                    ? 'bg-amber-500'
                    : 'bg-rose-500';

            return (
              <div
                key={dim.key}
                className="rounded-2xl bg-[#0f172a] border border-slate-800 p-5 sm:p-6 space-y-4 print-card"
              >
                {/* 維度標題與得分進度條 */}
                <div className="space-y-2 border-b border-slate-800 pb-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-100 print-text-primary">
                      維度 {dIdx + 1}：{dim.title}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-200 border border-slate-700 print-subcard print-text-primary">
                        {dim.gradeText}
                      </span>
                      <span className="text-lg font-black font-mono tabular-nums text-cyan-300 print-text-primary">
                        {dim.scorePct.toFixed(0)} <span className="text-xs font-normal text-slate-400">/ 100 分</span>
                      </span>
                    </div>
                  </div>

                  <div className="w-full h-2.5 rounded-full bg-slate-900 overflow-hidden border border-slate-800">
                    <div
                      className={`h-full ${barColor} transition-all duration-300`}
                      style={{ width: `${Math.min(100, Math.max(5, dim.scorePct))}%` }}
                    />
                  </div>

                  <p className="text-xs sm:text-sm text-slate-300 print-text-secondary">
                    {dim.summaryComment}
                  </p>
                </div>

                {/* 該維度 3–4 個具體指標明細 */}
                <div className="grid grid-cols-1 gap-3">
                  {dim.metrics.map((m, mIdx) => (
                    <div
                      key={mIdx}
                      className="rounded-xl bg-slate-900/75 border border-slate-800/90 p-3.5 space-y-1.5 print-subcard"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-100 print-text-primary">
                          {m.label}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold font-mono tabular-nums text-cyan-300 print-text-primary">
                            實際值：{m.valueText}
                          </span>
                          <MetricStatusTag status={m.status} />
                        </div>
                      </div>

                      <div className="text-xs text-slate-400 print-text-muted">
                        參考標準：<span className="text-slate-300 print-text-secondary">{m.benchmarkText}</span>
                      </div>

                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed pt-0.5 print-text-secondary">
                        白話解讀：{m.comment}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. 第三節：近 8 季營運趨勢微圖表與歷史估值區間 */}
      <section className="rounded-2xl bg-[#0f172a] border border-slate-800 p-5 sm:p-6 space-y-4 print-card">
        <div className="border-b border-slate-800 pb-3">
          <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2 print-text-primary">
            <BarChart3 className="w-5 h-5 text-violet-400 shrink-0" />
            第三節：近 8 季營運趨勢與歷史估值位置
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 print-text-muted">
            直觀驗證公司單季毛利率與營收／存貨週轉變化，確認基本面正在轉強還是走下坡
          </p>
        </div>

        {chartSeries.quarterlyTrend.length > 0 ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartSeries.quarterlyTrend}
                margin={{ top: 12, right: 12, left: -10, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="quarter" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: '#38bdf8', fontSize: 12 }}
                  unit="%"
                  domain={['auto', 'auto']}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: '#a78bfa', fontSize: 12 }}
                  unit={hasDioSeries ? '天' : '億'}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {hasRevSeries && !hasDioSeries && (
                  <Bar
                    yAxisId="right"
                    dataKey="revenueYi"
                    name="單季營收 (億元)"
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                    barSize={24}
                  />
                )}
                {hasDioSeries && (
                  <Bar
                    yAxisId="right"
                    dataKey="dio"
                    name="存貨週轉天數 (天)"
                    fill="#a855f7"
                    radius={[4, 4, 0, 0]}
                    barSize={24}
                  />
                )}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="grossMarginPct"
                  name="單季毛利率 (%)"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  dot={{ r: 3.5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
            此標的適用金融業損益結構（無製造業毛利率與存貨週轉天數），請重點參考下方近 5–7 年股價淨值比歷史區間位置。
          </div>
        )}

        {/* 歷史股價淨值比區間摘要尺 */}
        <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-4 space-y-2.5 print-subcard">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-slate-100 print-text-primary">
              {valBand.metricLabel}
            </span>
            <span className="text-xs font-mono tabular-nums text-cyan-300 print-text-primary">
              目前淨值比：{valBand.currentValue !== null ? `${valBand.currentValue.toFixed(2)} 倍` : '待確認'}
              {valBand.percentile5to7Y !== null && `（歷史 ${valBand.percentile5to7Y.toFixed(0)}% 分位）`}
            </span>
          </div>

          {valBand.minVal !== null && valBand.maxVal !== null && (
            <div className="grid grid-cols-5 gap-2 text-center text-xs font-mono tabular-nums pt-1">
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800 print-subcard">
                <div className="text-[11px] text-slate-400 print-text-muted">歷史最低</div>
                <div className="text-emerald-300 font-bold print-text-primary">{valBand.minVal.toFixed(2)}x</div>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800 print-subcard">
                <div className="text-[11px] text-slate-400 print-text-muted">便宜線 (20%)</div>
                <div className="text-emerald-200 font-bold print-text-primary">
                  {valBand.p20Val !== null ? `${valBand.p20Val.toFixed(2)}x` : '-'}
                </div>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800 print-subcard">
                <div className="text-[11px] text-slate-400 print-text-muted">歷史中位 (50%)</div>
                <div className="text-cyan-300 font-bold print-text-primary">
                  {valBand.p50Val !== null ? `${valBand.p50Val.toFixed(2)}x` : '-'}
                </div>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800 print-subcard">
                <div className="text-[11px] text-slate-400 print-text-muted">偏貴線 (80%)</div>
                <div className="text-amber-300 font-bold print-text-primary">
                  {valBand.p80Val !== null ? `${valBand.p80Val.toFixed(2)}x` : '-'}
                </div>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800 print-subcard">
                <div className="text-[11px] text-slate-400 print-text-muted">歷史最高</div>
                <div className="text-rose-300 font-bold print-text-primary">{valBand.maxVal.toFixed(2)}x</div>
              </div>
            </div>
          )}

          <p className="text-xs sm:text-sm text-slate-300 print-text-secondary">
            {valBand.positionComment}
          </p>
        </div>
      </section>

      {/* 5. 第四節：專屬買賣操作與風控價位書（核心決策區） */}
      <section className="rounded-2xl bg-[#0f172a] border border-slate-800 p-5 sm:p-6 space-y-5 print-card">
        <div className="border-b border-slate-800 pb-3">
          <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2 print-text-primary">
            <Target className="w-5 h-5 text-emerald-400 shrink-0" />
            第四節：專屬買賣操作與風控價位書（核心決策區）
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 print-text-muted">
            進場前先想好退路：明確規劃分批買進比例、加碼條件與三道具體台幣防守價位
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 左欄：【買進策略】 */}
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-4 sm:p-5 space-y-3.5 print-subcard">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-bold text-emerald-300 flex items-center gap-1.5 print-text-primary">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                【買進策略與分批建倉計畫】
              </h3>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                  actionPlan.buyStrategy.canBuyNow
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                } print-text-primary`}
              >
                首筆建議投入：{actionPlan.buyStrategy.firstTranchePct}%
              </span>
            </div>

            <div className="space-y-2.5 text-xs sm:text-sm">
              <div className="p-3 rounded-lg bg-slate-950/75 border border-slate-800/90 space-y-1 print-card">
                <div className="text-xs font-bold text-cyan-300 print-text-primary">
                  1. 具體進場參考區間與掛單紀律
                </div>
                <p className="text-slate-200 leading-relaxed print-text-secondary">
                  {actionPlan.buyStrategy.entryZoneText}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/75 border border-slate-800/90 space-y-1 print-card">
                <div className="text-xs font-bold text-emerald-300 print-text-primary">
                  2. 第二批加碼確認條件
                </div>
                <p className="text-slate-200 leading-relaxed print-text-secondary">
                  {actionPlan.buyStrategy.secondTrancheCondition}
                </p>
              </div>
            </div>
          </div>

          {/* 右欄：【賣出與防守價位】 */}
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-4 sm:p-5 space-y-3.5 print-subcard">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-bold text-rose-300 flex items-center gap-1.5 print-text-primary">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                【賣出與三道風控防守價位】
              </h3>
              <span className="text-xs text-slate-400 print-text-muted">波動度自適應防線</span>
            </div>

            {/* 3 張高對比數字小卡 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-1 print-card">
                <div className="text-[11px] font-semibold text-rose-300 print-text-secondary">
                  看錯停損價
                </div>
                <div className="text-lg font-black font-mono tabular-nums text-rose-200 print-text-primary">
                  {formatPriceTwd(actionPlan.sellAndDefenseStrategy.stopLossPrice)}
                </div>
                <div className="text-[11px] text-rose-300/80 print-text-muted">
                  收盤跌破無條件停損
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-1 print-card">
                <div className="text-[11px] font-semibold text-amber-300 print-text-secondary">
                  200日均線防線
                </div>
                <div className="text-lg font-black font-mono tabular-nums text-amber-200 print-text-primary">
                  {formatPriceTwd(actionPlan.sellAndDefenseStrategy.ma200Price)}
                </div>
                <div className="text-[11px] text-amber-300/80 print-text-muted">
                  長線牛熊多空生命線
                </div>
              </div>

              <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/40 space-y-1 print-card">
                <div className="text-[11px] font-semibold text-cyan-300 print-text-secondary">
                  移動停利防守價
                </div>
                <div className="text-lg font-black font-mono tabular-nums text-cyan-200 print-text-primary">
                  {formatPriceTwd(actionPlan.sellAndDefenseStrategy.trailingStopPrice)}
                </div>
                <div className="text-[11px] text-cyan-300/80 print-text-muted">
                  波段創高後鎖住獲利
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/75 border border-slate-800/90 space-y-1 text-xs sm:text-sm print-card">
              <div className="text-xs font-bold text-amber-300 print-text-primary">
                基本面轉弱出場紀律
              </div>
              <p className="text-slate-200 leading-relaxed print-text-secondary">
                {actionPlan.sellAndDefenseStrategy.fundamentalExitRule}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
