import React from 'react';
import type { ExitPriority, Grade, ValuationProfile } from '../engine/types';

export function formatTwd(value: number): string {
  if (!Number.isFinite(value)) return 'NT$ 0';
  return `NT$ ${Math.round(value).toLocaleString('en-US')}`;
}

export function formatTwLots(shares: number): string {
  if (!Number.isFinite(shares) || shares <= 0) return '0 股 (0 張 0 股)';
  const s = Math.floor(shares);
  const lots = Math.floor(s / 1000);
  const odd = s % 1000;
  return `${s.toLocaleString('en-US')} 股 (${lots} 張 ${odd} 股)`;
}

export function getProfileLabel(profile: ValuationProfile): string {
  if (profile === 'cyclical_heavy_asset') return '循環－重資產型 (航運/記憶體/面板)';
  if (profile === 'cyclical_inventory_order') return '循環－存貨訂單型 (設備/IC設計)';
  if (profile === 'financial_bank') return '金融－銀行／官股型 (Fin-QVM)';
  if (profile === 'financial_life_fhc') return '金融－壽險雙引擎型 (Fin-QVM)';
  return '標準品質型 (Standard QVM)';
}

const GRADE_STYLES: Record<Grade, string> = {
  A: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  B: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  C: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  D: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  F: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
};

export const GradeBadge: React.FC<{ grade: Grade; size?: 'sm' | 'md' | 'lg' }> = ({
  grade,
  size = 'sm',
}) => {
  const sizeClass =
    size === 'lg'
      ? 'px-4 py-1.5 text-2xl font-bold tracking-wider rounded-lg'
      : size === 'md'
        ? 'px-2.5 py-0.5 text-sm font-bold rounded-md'
        : 'px-2 py-0.5 text-xs font-bold rounded';

  return (
    <span
      className={`inline-flex items-center justify-center border font-mono tabular-nums ${GRADE_STYLES[grade]} ${sizeClass}`}
    >
      {grade} 級
    </span>
  );
};

const PRIORITY_STYLES: Record<ExitPriority, string> = {
  P0: 'bg-rose-600/25 text-rose-200 border-rose-500/60',
  'P1-F': 'bg-pink-600/25 text-pink-200 border-pink-400/60',
  'P1-C': 'bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-400/60',
  P1: 'bg-red-500/20 text-red-300 border-red-500/50',
  P2: 'bg-orange-500/20 text-orange-300 border-orange-500/50',
  P3: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
  P4: 'bg-violet-500/20 text-violet-300 border-violet-500/50',
  HOLD: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
};

export const PriorityBadge: React.FC<{ priority: ExitPriority }> = ({ priority }) => {
  const label =
    priority === 'HOLD'
      ? '續抱 HOLD'
      : priority === 'P1-C'
        ? 'P1-C 見頂減碼'
        : priority === 'P1-F'
          ? 'P1-F 金融警戒'
          : priority;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-mono font-bold border rounded ${PRIORITY_STYLES[priority]}`}
    >
      {label}
    </span>
  );
};
