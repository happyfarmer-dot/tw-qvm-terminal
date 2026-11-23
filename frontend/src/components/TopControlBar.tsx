import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
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
    manifest,
    dataLoading,
    dataError,
    regime,
    benchmark,
    universe,
    loadStaticData,
    setRegime,
    updateBenchmark,
    getPersistedSnapshot,
    loadSnapshot,
    resetPersonalData,
  } = useTwQuantStore();

  const [showRegimePanel, setShowRegimePanel] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const regimeEval = evaluateRegimeSuggestion(benchmark, regime);
  const weights = getRegimeWeights(regime);
  const pit = getNextTwPitReviewDate();

  const handleExportBackup = () => {
    const json = exportTwBackupJson(getPersistedSnapshot());
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tw-qvm-personal-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback('已匯出個人帳本與監理覆寫 JSON');
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTwBackupJson(String(reader.result ?? ''));
      if (parsed) {
        loadSnapshot(parsed);
        setFeedback('個人帳本與監理覆寫還原成功');
      } else {
        setFeedback('JSON 格式錯誤');
      }
      setTimeout(() => setFeedback(null), 3000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const taiexText =
    manifest?.regime.indexClose != null
      ? `加權指數 ${manifest.regime.indexClose.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      : '加權指數待同步';

  return (
    <div className="sticky top-0 z-30 bg-[#0b111e]/95 backdrop-blur border-b border-slate-800 no-print">
      <div className="px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onToggleSidebar}
            className="hidden md:inline-flex p-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition"
            title="收合／展開側邊欄"
          >
            <Menu className="w-4 h-4" />
          </button>

          {/* Static Real Data Status Pill */}
          <div
            className={`px-2.5 py-1 rounded-lg border text-xs flex items-center gap-1.5 tabular-nums ${
              dataError
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
                : manifest?.status === 'awaiting_first_run'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                  : 'bg-emerald-500/15 border-emerald-500/35 text-emerald-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              {dataLoading
                ? '載入真實數據中...'
                : dataError
                  ? `數據載入異常：${dataError}`
                  : `真實數據更新：${manifest?.updatedAtTaipei ?? '讀取中'}（${taiexText}｜${universe.length} 檔）`}
            </span>
            <button
              onClick={() => void loadStaticData()}
              disabled={dataLoading}
              className="ml-1 p-0.5 rounded hover:bg-white/10 transition"
              title="重新載入最新靜態真實數據"
            >
              <RefreshCw className={`w-3 h-3 ${dataLoading ? 'animate-spin' : ''}`} />
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
            大盤體制明細
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
            title="匯出個人持倉帳本與金融監理覆寫 JSON（供跨裝置同步或備份）"
          >
            <Download className="w-3.5 h-3.5" />
            匯出備份
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1"
            title="匯入個人持倉與監理覆寫 JSON 備份"
          >
            <Upload className="w-3.5 h-3.5" />
            匯入還原
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportBackup}
            className="hidden"
          />
          <button
            onClick={resetPersonalData}
            className="px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-200 flex items-center gap-1"
            title="清除本機瀏覽器儲存的個人持倉與監理覆寫"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            清除個人資料
          </button>
          {feedback && <span className="text-emerald-300 font-medium">{feedback}</span>}
        </div>
      </div>

      {/* Expandable Dual-Market Regime Panel (Taiwan TAIEX + US Macro) */}
      {showRegimePanel && (
        <div className="px-4 py-3 bg-slate-900/95 border-t border-slate-800 space-y-3 text-xs">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* 左欄：台股 TAIEX */}
            <div className="p-3 rounded-xl bg-slate-950/75 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-cyan-300">🇹🇼 台股加權指數（TAIEX）</span>
                <span className="font-mono tabular-nums text-[11px] text-slate-400">
                  收盤 {benchmark.indexClose > 0 ? benchmark.indexClose.toLocaleString() : '-'} ｜ 200MA {benchmark.ma200 > 0 ? benchmark.ma200.toLocaleString() : '-'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="flex items-center gap-1 text-slate-400">
                  收盤
                  <input
                    type="number"
                    value={benchmark.indexClose}
                    onChange={(e) => updateBenchmark({ indexClose: Number(e.target.value) || 0 })}
                    className="w-20 px-2 py-1 rounded bg-slate-900 border border-slate-700 font-mono tabular-nums text-slate-100"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400">
                  200MA
                  <input
                    type="number"
                    value={benchmark.ma200}
                    onChange={(e) => updateBenchmark({ ma200: Number(e.target.value) || 1 })}
                    className="w-20 px-2 py-1 rounded bg-slate-900 border border-slate-700 font-mono tabular-nums text-slate-100"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400">
                  20日回撤(%)
                  <input
                    type="number"
                    step="0.1"
                    value={benchmark.drawdown20dPct}
                    onChange={(e) =>
                      updateBenchmark({ drawdown20dPct: Number(e.target.value) || 0 })
                    }
                    className="w-16 px-2 py-1 rounded bg-slate-900 border border-slate-700 font-mono tabular-nums text-slate-100"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400">
                  20日波動(%)
                  <input
                    type="number"
                    step="0.1"
                    value={benchmark.annualizedVol20dPct}
                    onChange={(e) =>
                      updateBenchmark({ annualizedVol20dPct: Number(e.target.value) || 0 })
                    }
                    className="w-16 px-2 py-1 rounded bg-slate-900 border border-slate-700 font-mono tabular-nums text-slate-100"
                  />
                </label>
              </div>
            </div>

            {/* 右欄：美股 S&P 500 / VIX / SOXX / 10Y 美債 */}
            <div className="p-3 rounded-xl bg-slate-950/75 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-300">🇺🇸 美股四大量化風向球</span>
                <span className="font-mono tabular-nums text-[11px] text-slate-400">
                  {manifest?.regime.usMacro?.asOfDate ? `基準日：${manifest.regime.usMacro.asOfDate}` : '待同步'}
                  {manifest?.regime.usMacro?.fromCache ? '（快取沿用）' : ''}
                </span>
              </div>
              {manifest?.regime.usMacro ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums text-[11px]">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">S&P 500</div>
                    <div className={`font-bold ${manifest.regime.usMacro.sp500.belowMa200 ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {manifest.regime.usMacro.sp500.close?.toLocaleString() ?? '-'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      年線 {manifest.regime.usMacro.sp500.ma200?.toLocaleString() ?? '-'}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">VIX 恐慌</div>
                    <div className={`font-bold ${(manifest.regime.usMacro.vixClose ?? 0) >= 25 ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {manifest.regime.usMacro.vixClose?.toFixed(2) ?? '-'}
                    </div>
                    <div className="text-[10px] text-slate-500">警戒線 ≥ 25</div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">費半 SOXX</div>
                    <div className={`font-bold ${manifest.regime.usMacro.soxx.belowMa200 ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {manifest.regime.usMacro.soxx.close?.toFixed(2) ?? '-'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      20日 {manifest.regime.usMacro.soxx.return20dPct !== null ? `${manifest.regime.usMacro.soxx.return20dPct >= 0 ? '+' : ''}${manifest.regime.usMacro.soxx.return20dPct}%` : '-'}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">10年美債</div>
                    <div className="font-bold text-cyan-300">
                      {manifest.regime.usMacro.tnxYieldPct !== null ? `${manifest.regime.usMacro.tnxYieldPct.toFixed(2)}%` : '-'}
                    </div>
                    <div className="text-[10px] text-slate-500">無風險基準</div>
                  </div>
                </div>
              ) : (
                <div className="text-slate-400 text-xs">美股四大量化風向球數據將於下次排程自動更新。</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="text-[11px] text-slate-400">
              {manifest?.regime.reasons && manifest.regime.reasons.length > 0
                ? `台美雙重體制判定依據：${manifest.regime.reasons.join(' ｜ ')}`
                : '台美大盤處於安全區間'}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-300">
                系統建議：
                <strong
                  className={
                    regimeEval.suggestedRegime === 'DEFENSIVE' || manifest?.regime.regime === 'DEFENSIVE'
                      ? 'text-amber-300 ml-1'
                      : 'text-emerald-300 ml-1'
                  }
                >
                  {regimeEval.suggestedRegime === 'DEFENSIVE' || manifest?.regime.regime === 'DEFENSIVE'
                    ? '防禦模式（首筆 30%）'
                    : '常態模式（首筆 50%）'}
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
            <strong>台股自動化真實數據平台：</strong>
            所有財報與收盤價皆於每日收盤後自動更新；個人自選持倉僅安全儲存於您的本機瀏覽器中。
          </span>
        </div>
        <span className="font-mono tabular-nums text-amber-300">
          權重配置 品質:{weights.wQ}% / 價值:{weights.wV}% / 動能:{weights.wM}% ｜ 建議首筆資金 {regime === 'DEFENSIVE' ? '30%' : '50%'}
        </span>
      </div>
    </div>
  );
};
