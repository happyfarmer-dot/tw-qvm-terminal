import React, { useMemo, useState } from 'react';
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { MOCK_TW_STOCKS } from '../data/mockTwStocks';
import { evaluateCyclicalRating } from '../engine/cyclicalScoring';
import { evaluateFinancialRating } from '../engine/financialScoring';
import { evaluateRating } from '../engine/ratingAndRegime';
import { rankBatchWithZScore } from '../engine/scoringBatchZ';
import { evaluateStageZero } from '../engine/stageZero';
import { adviseHoldingExit } from '../engine/tradeAdvisor';
import type { ValuationProfile } from '../engine/types';
import { useTwQuantStore } from '../store/useTwQuantStore';
import {
  formatTwd,
  formatTwLots,
  getProfileLabel,
  GradeBadge,
  PriorityBadge,
} from './GradeBadge';

export const PortfolioView: React.FC = () => {
  const {
    regime,
    holdings,
    universe,
    frictionConfig,
    updateFrictionConfig,
    updateHolding,
    removeHolding,
    addHolding,
  } = useTwQuantStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newSym, setNewSym] = useState('2317');
  const [newName, setNewName] = useState('鴻海');
  const [newSector, setNewSector] = useState('其他電子業');
  const [newProfile, setNewProfile] = useState<ValuationProfile>('standard');
  const [newCost, setNewCost] = useState(200);
  const [newPrice, setNewPrice] = useState(212);
  const [newShares, setNewShares] = useState(2000);
  const [newQ, setNewQ] = useState(32);
  const [newV, setNewV] = useState(26);
  const [newM, setNewM] = useState(20);

  const totalValue = useMemo(
    () => holdings.reduce((acc, h) => acc + h.currentPrice * h.shares, 0),
    [holdings]
  );

  const bestNewA = useMemo(() => {
    const ranked = rankBatchWithZScore(universe, regime);
    return ranked.find(
      (r) =>
        r.rating.finalGrade === 'A' &&
        !holdings.some((h) => h.symbol === r.stock.symbol)
    );
  }, [universe, regime, holdings]);

  const lowestScore = useMemo(
    () => holdings.reduce((m, h) => Math.min(m, h.currentRating.finalScore), 100),
    [holdings]
  );

  const decisions = useMemo(
    () =>
      holdings.map((h) => ({
        holding: h,
        decision: adviseHoldingExit({
          holding: h,
          totalActivePortfolioValue: totalValue,
          isFullInvested: holdings.length >= 3,
          isLowestScoringHolding: h.currentRating.finalScore === lowestScore,
          bestNewACandidate: bestNewA
            ? {
                symbol: bestNewA.stock.symbol,
                name: bestNewA.stock.name,
                finalScore: bestNewA.rating.finalScore,
              }
            : null,
          frictionConfig,
        }),
      })),
    [holdings, totalValue, lowestScore, bestNewA, frictionConfig]
  );

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const base = MOCK_TW_STOCKS[0];
    const finBase = MOCK_TW_STOCKS[8].financialMetrics!;
    const sz = evaluateStageZero(
      { ...base.stageZeroInput, price: newPrice },
      newProfile
    );
    const bd = { sQ: newQ, sV: newV, sM: newM };
    const rating = evaluateRating({ breakdown: bd, regime, stageZero: sz });
    const isCyc =
      newProfile === 'cyclical_heavy_asset' || newProfile === 'cyclical_inventory_order';
    const isFin = newProfile === 'financial_bank' || newProfile === 'financial_life_fhc';
    const cycRating = isCyc
      ? evaluateCyclicalRating({
          profile: newProfile,
          regime,
          stageZero: sz,
          metrics: base.cyclicalMetrics,
          price: newPrice,
          ma120: newPrice * 0.94,
          ma200: newPrice * 0.9,
          rev3mCumYoYPct: 12,
          rev12mCumYoYPct: 8,
        })
      : undefined;
    const finRating = isFin
      ? evaluateFinancialRating({
          profile: newProfile,
          regime,
          commonStageZeroInput: { ...base.stageZeroInput, price: newPrice },
          metrics: finBase,
          price: newPrice,
          ma200: newPrice * 0.9,
        })
      : undefined;

    addHolding({
      id: `HOLD-TW-${newSym}-${Date.now()}`,
      symbol: newSym.trim().toUpperCase(),
      name: newName.trim(),
      sector: newSector.trim(),
      valuationProfile: newProfile,
      shares: newShares,
      costPrice: newCost,
      currentPrice: newPrice,
      highestPriceSinceEntry: Math.max(newCost, newPrice),
      atr20: Math.max(1, Number((newPrice * 0.025).toFixed(2))),
      ma60: Number((newPrice * 0.96).toFixed(2)),
      ma120: Number((newPrice * 0.93).toFixed(2)),
      ma200: Number((newPrice * 0.9).toFixed(2)),
      daysBelow200Ma: 0,
      moatPermanentlyBroken: false,
      stopDrawdownThresholdPct: 15,
      currentRating: rating,
      currentBreakdown: bd,
      cyclicalMetrics: base.cyclicalMetrics,
      cyclicalRating: cycRating,
      financialMetrics: isFin ? finBase : undefined,
      financialRating: finRating,
    });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">
            台股持倉監控與 P0–P4 / P1-C 出場決策台
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            優先序：P0 &gt; P1-C（週期見頂提前減碼）&gt; P1 &gt; P2 &gt; P3 &gt; P4；內建 65 分緩衝區保護與台股 0.3% 證交稅試算
          </p>
        </div>

        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="px-3 py-1.5 text-xs rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-semibold flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          新增台股持倉
        </button>
      </div>

      {/* Taiwan Fee & Tax Controls */}
      <div className="p-3.5 rounded-xl bg-[#0f172a] border border-slate-800 flex flex-wrap items-center gap-4 text-xs">
        <span className="font-semibold text-slate-200">台股交易成本參數：</span>
        <label className="flex items-center gap-1.5 text-slate-300">
          券商手續費折數 (0.1425%×)
          <select
            value={frictionConfig.feeDiscount}
            onChange={(e) => updateFrictionConfig({ feeDiscount: Number(e.target.value) })}
            className="px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono text-cyan-300"
          >
            <option value={1}>10 折 (無折)</option>
            <option value={0.6}>6 折</option>
            <option value={0.5}>5 折</option>
            <option value={0.28}>2.8 折</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={frictionConfig.applyMinFee20}
            onChange={(e) => updateFrictionConfig({ applyMinFee20: e.target.checked })}
            className="accent-cyan-400"
          />
          單筆最低手續費 NT$ 20
        </label>
        <label className="flex items-center gap-1.5 text-slate-300">
          預估雙邊滑價 (%)
          <input
            type="number"
            step="0.05"
            min={0}
            value={frictionConfig.slippageRoundTripPct}
            onChange={(e) =>
              updateFrictionConfig({ slippageRoundTripPct: Number(e.target.value) || 0 })
            }
            className="w-16 px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
          />
        </label>
        <span className="text-slate-400 ml-auto">賣出固定含 0.3% 證交稅</span>
      </div>

      {showAddForm && (
        <form
          onSubmit={handleAdd}
          className="p-4 rounded-xl bg-[#0f172a] border border-cyan-500/40 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs"
        >
          <label className="space-y-1">
            <span className="text-slate-400">代號</span>
            <input value={newSym} onChange={(e) => setNewSym(e.target.value)} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">名稱</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">產業</span>
            <input value={newSector} onChange={(e) => setNewSector(e.target.value)} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">評估模型</span>
            <select
              value={newProfile}
              onChange={(e) => setNewProfile(e.target.value as ValuationProfile)}
              className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700"
            >
              <option value="standard">標準品質型</option>
              <option value="cyclical_heavy_asset">循環－重資產型</option>
              <option value="cyclical_inventory_order">循環－存貨訂單型</option>
              <option value="financial_bank">金融－銀行／官股型</option>
              <option value="financial_life_fhc">金融－壽險雙引擎型</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">持有股數 (1000=1張)</span>
            <input type="number" value={newShares} onChange={(e) => setNewShares(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">成本價</span>
            <input type="number" step="0.5" value={newCost} onChange={(e) => setNewCost(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">現價</span>
            <input type="number" step="0.5" value={newPrice} onChange={(e) => setNewPrice(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">Q (0-40)</span>
            <input type="number" value={newQ} onChange={(e) => setNewQ(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">V (0-35)</span>
            <input type="number" value={newV} onChange={(e) => setNewV(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
          </label>
          <div className="flex items-end gap-2">
            <label className="space-y-1 flex-1">
              <span className="text-slate-400">M (0-25)</span>
              <input type="number" value={newM} onChange={(e) => setNewM(Number(e.target.value))} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums" />
            </label>
            <button type="submit" className="px-3 py-1.5 rounded bg-emerald-500 text-slate-950 font-bold">
              新增
            </button>
          </div>
        </form>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div className="p-3.5 rounded-xl bg-[#0f172a] border border-slate-800">
          <div className="text-slate-400">台股主動持倉總市值</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mt-1">
            {formatTwd(totalValue)}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#0f172a] border border-slate-800">
          <div className="text-slate-400">建議賣出／減碼總金額</div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-300 mt-1">
            {formatTwd(decisions.reduce((acc, d) => acc + d.decision.estimatedProceeds, 0))}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#0f172a] border border-slate-800">
          <div className="text-slate-400">預估台股總摩擦稅費</div>
          <div className="text-xl font-bold font-mono tabular-nums text-rose-300 mt-1">
            {formatTwd(decisions.reduce((acc, d) => acc + d.decision.estimatedFrictionCost, 0))}
          </div>
        </div>
      </div>

      {/* Holding Diagnostic Cards */}
      <div className="space-y-4">
        {decisions.map(({ holding, decision }) => {
          const pnlPct =
            holding.costPrice > 0
              ? ((holding.currentPrice - holding.costPrice) / holding.costPrice) * 100
              : 0;
          return (
            <div key={holding.id} className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={decision.primaryPriority} />
                  <span className="font-mono text-base font-bold text-slate-100">{holding.symbol}</span>
                  <span className="text-sm text-slate-300">{holding.name}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {getProfileLabel(holding.valuationProfile)}
                  </span>
                  <GradeBadge
                    grade={
                      holding.financialRating?.finalGrade ??
                      holding.cyclicalRating?.finalGrade ??
                      holding.currentRating.finalGrade
                    }
                  />
                </div>
                <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                  <span className="text-slate-300">{formatTwLots(holding.shares)}</span>
                  <span className="text-slate-400">權重 {decision.positionWeightPct.toFixed(1)}%</span>
                  <span className={pnlPct >= 0 ? 'text-emerald-300 font-semibold' : 'text-rose-300 font-semibold'}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                  </span>
                  <button
                    onClick={() => removeHolding(holding.id)}
                    className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
                <label className="space-y-1">
                  <span className="text-slate-400">成本價</span>
                  <input
                    type="number"
                    step="0.5"
                    value={holding.costPrice}
                    onChange={(e) => updateHolding(holding.id, { costPrice: Number(e.target.value) || 0 })}
                    className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-400">現價</span>
                  <input
                    type="number"
                    step="0.5"
                    value={holding.currentPrice}
                    onChange={(e) => updateHolding(holding.id, { currentPrice: Number(e.target.value) || 0 })}
                    className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-400">股數</span>
                  <input
                    type="number"
                    step={100}
                    value={holding.shares}
                    onChange={(e) => updateHolding(holding.id, { shares: Number(e.target.value) || 0 })}
                    className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-400">20日 ATR</span>
                  <input
                    type="number"
                    step="0.5"
                    value={holding.atr20}
                    onChange={(e) => updateHolding(holding.id, { atr20: Number(e.target.value) || 0 })}
                    className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-400">破 200MA 天數</span>
                  <input
                    type="number"
                    min={0}
                    value={holding.daysBelow200Ma}
                    onChange={(e) => updateHolding(holding.id, { daysBelow200Ma: Number(e.target.value) || 0 })}
                    className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono tabular-nums"
                  />
                </label>
                <label className="flex items-end pb-1.5 gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={holding.moatPermanentlyBroken}
                    onChange={(e) => updateHolding(holding.id, { moatPermanentlyBroken: e.target.checked })}
                    className="accent-rose-500"
                  />
                  護城河永久證偽
                </label>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-100">{decision.actionLabel}</span>
                  <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-slate-300">
                    <span>建議賣出：{formatTwLots(decision.recommendedSellShares)} ({decision.recommendedSellPct}%)</span>
                    <span>摩擦稅費：{formatTwd(decision.estimatedFrictionCost)}</span>
                    {decision.trailingStopPrice !== undefined && (
                      <span className="text-fuchsia-300">移動停利價：{decision.trailingStopPrice} 元</span>
                    )}
                    {decision.portfolioLossImpactPct > 0 && (
                      <span className="text-rose-300">虧損衝擊：-{decision.portfolioLossImpactPct.toFixed(2)}%</span>
                    )}
                  </div>
                </div>
                <p className="text-slate-400 leading-relaxed">{decision.actionDetail}</p>

                {decision.triggeredSignals.length > 1 && (
                  <div className="pt-2 border-t border-slate-800 space-y-1">
                    <div className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      次要觸發訊號：
                    </div>
                    {decision.triggeredSignals.slice(1).map((sig, i) => (
                      <div key={i} className="text-[11px] text-slate-400">
                        • [{sig.priority}] {sig.title} — {sig.detail}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
