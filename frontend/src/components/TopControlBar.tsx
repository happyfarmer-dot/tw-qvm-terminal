import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Cloud,
  Database,
  Download,
  Menu,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { evaluateRegimeSuggestion, getRegimeWeights } from '../engine/ratingAndRegime';
import { getNextTwPitReviewDate } from '../engine/tradeAdvisor';
import { exportTwBackupJson, parseTwBackupJson } from '../services/storage';
import { useTwQuantStore } from '../store/useTwQuantStore';

export const TopControlBar: React.FC<{ onToggleSidebar: () => void }> = ({ onToggleSidebar }) => {
  const {
    dataSourceMode,
    backendUrl,
    regime,
    benchmark,
    setDataSourceMode,
    setBackendUrl,
    setRegime,
    updateBenchmark,
    getPersistedSnapshot,
    loadSnapshot,
    resetToDefaults,
    getProvider,
  } = useTwQuantStore();

  const [showRegimePanel, setShowRegimePanel] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const regimeEval = evaluateRegimeSuggestion(benchmark, regime);
  const weights = getRegimeWeights(regime);
  const pit = getNextTwPitReviewDate();

  const handleSyncLiveRegime = async () => {
    try {
      setLiveStatus('連線中...');
      const provider = getProvider();
      const health = await provider.checkHealth();
      const reg = await provider.fetchRegime();
      updateBenchmark({
        indexClose: reg.indexClose,
        ma200: reg.ma200,
        drawdown20dPct: reg.drawdown20dPct,
        annualizedVol20dPct: reg.annualizedVol20dPct,
      });
      setRegime(reg.regime);
      setDataSourceMode('live');
      setLiveStatus(
        `已連線 (${health.finmindTier.toUpperCase()} / 快取 ${health.cacheStats.validEntries} 筆)`
      );
    } catch (err) {
      setLiveStatus(`連線失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExportBackup = () => {
    const json = exportTwBackupJson(getPersistedSnapshot());
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tw-qvm-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback('已匯出 JSON 備份');
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTwBackupJson(String(reader.result ?? ''));
      if (parsed) {
        loadSnapshot(parsed);
        setFeedback('備份還原成功');
      } else {
        setFeedback('JSON 格式錯誤');
      }
      setTimeout(() => setFeedback(null), 3000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="sticky top-0 z-30 bg-[#0b111e]/95 backdrop-blur border-b border-slate-800">
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition"
            title="收合／展開側邊欄"
          >
            <Menu className="w-4 h-4" />
          </button>

          {/* Mock / Live FastAPI Switch */}
          <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
            <button
              onClick={() => setDataSourceMode('mock')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1 transition ${
                dataSourceMode === 'mock'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              Mock 模擬資料
            </button>
            <button
              onClick={() => setDataSourceMode('live')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1 transition ${
                dataSourceMode === 'live'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              Live FastAPI
            </button>
          </div>

          {/* Regime Switch */}
          <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
            <button
              onClick={() => setRegime('NORMAL')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1 transition ${
                regime === 'NORMAL'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              常態 (40/35/25)
            </button>
            <button
              onClick={() => setRegime('DEFENSIVE')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1 transition ${
                regime === 'DEFENSIVE'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              防禦 (50/40/10)
            </button>
          </div>

          <button
            onClick={() => setShowRegimePanel((v) => !v)}
            className={`px-2.5 py-1 text-xs rounded-md border flex items-center gap-1 transition ${
              regimeEval.shouldPromptSwitch && regimeEval.suggestedRegime === 'DEFENSIVE'
                ? 'bg-rose-500/20 border-rose-500/50 text-rose-200 animate-pulse'
                : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            大盤與連線設定
          </button>
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 tabular-nums">
            <CalendarClock className="w-3.5 h-3.5 text-cyan-400" />
            <span>{pit.label}</span>
          </div>

          <button
            onClick={handleExportBackup}
            className="px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" />
            匯出
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1"
          >
            <Upload className="w-3.5 h-3.5" />
            還原
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportBackup}
            className="hidden"
          />
          <button
            onClick={resetToDefaults}
            className="px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-200 flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            重置
          </button>
          {feedback && <span className="text-emerald-300 font-medium">{feedback}</span>}
        </div>
      </div>

      {/* Expandable Regime + Backend Sync Panel */}
      {showRegimePanel && (
        <div className="px-4 py-3 bg-slate-900/95 border-t border-slate-800 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-cyan-300">FastAPI 後端位址：</span>
              <input
                type="text"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                className="w-56 px-2.5 py-1 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
              />
              <button
                onClick={handleSyncLiveRegime}
                className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-semibold flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                測試連線並同步 TAIEX 體制
              </button>
              {liveStatus && <span className="text-slate-300">{liveStatus}</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-slate-300">TAIEX 加權指數指標：</span>
              <label className="flex items-center gap-1 text-slate-400">
                收盤
                <input
                  type="number"
                  value={benchmark.indexClose}
                  onChange={(e) => updateBenchmark({ indexClose: Number(e.target.value) || 0 })}
                  className="w-24 px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums text-slate-100"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-400">
                200MA
                <input
                  type="number"
                  value={benchmark.ma200}
                  onChange={(e) => updateBenchmark({ ma200: Number(e.target.value) || 1 })}
                  className="w-24 px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums text-slate-100"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-400">
                20日回撤 (%)
                <input
                  type="number"
                  step="0.1"
                  value={benchmark.drawdown20dPct}
                  onChange={(e) =>
                    updateBenchmark({ drawdown20dPct: Number(e.target.value) || 0 })
                  }
                  className="w-20 px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums text-slate-100"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-400">
                20日年化波動 (%)
                <input
                  type="number"
                  step="0.1"
                  value={benchmark.annualizedVol20dPct}
                  onChange={(e) =>
                    updateBenchmark({ annualizedVol20dPct: Number(e.target.value) || 0 })
                  }
                  className="w-20 px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums text-slate-100"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-300">
                系統建議：
                <strong
                  className={
                    regimeEval.suggestedRegime === 'DEFENSIVE'
                      ? 'text-amber-300 ml-1'
                      : 'text-emerald-300 ml-1'
                  }
                >
                  {regimeEval.suggestedRegime === 'DEFENSIVE' ? '防禦模式' : '常態模式'}
                </strong>
              </span>
              {regimeEval.shouldPromptSwitch && (
                <button
                  onClick={() => setRegime(regimeEval.suggestedRegime)}
                  className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold hover:bg-amber-400"
                >
                  一鍵切換
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Persistent Taiwan Boundary Disclaimer */}
      <div className="px-4 py-1.5 bg-amber-950/35 border-t border-amber-500/20 flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-200/90">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>
            <strong>台股模型切換指引：</strong>
            金融業請切換至專屬 Fin-QVM 模型，並務必於每季核對 MOPS 資本適足性與資產品質監理數據；強景氣循環股（航運／記憶體／面板／設備／IC設計）請切換至 Cyclical-QVM 模式；嚴禁使用融資或質押槓桿。
          </span>
        </div>
        <span className="font-mono tabular-nums text-amber-300">
          標準權重 Q:{weights.wQ}/V:{weights.wV}/M:{weights.wM} ｜ 首倉 {regime === 'DEFENSIVE' ? '30%' : '50%'}
        </span>
      </div>
    </div>
  );
};
