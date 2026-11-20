import React, { useState } from 'react';
import {
  Activity,
  Briefcase,
  ClipboardCheck,
  Filter,
  LayoutDashboard,
  PieChart,
  Terminal,
} from 'lucide-react';
import { DashboardView } from './components/DashboardView';
import { PortfolioView } from './components/PortfolioView';
import { ScorecardView } from './components/ScorecardView';
import { ScreenerView } from './components/ScreenerView';
import { SizerView } from './components/SizerView';
import { TopControlBar } from './components/TopControlBar';
import { useTwQuantStore, type NavTab } from './store/useTwQuantStore';

const NAV_ITEMS: { id: NavTab; label: string; sub: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: '總覽儀表板', sub: 'TW Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'scorecard', label: '單股健檢與計分卡', sub: 'QVM / Cyclical', icon: <ClipboardCheck className="w-4 h-4" /> },
  { id: 'screener', label: '批次篩選 Z-Score', sub: 'Peer Ranking', icon: <Filter className="w-4 h-4" /> },
  { id: 'portfolio', label: '持倉監控與出場台', sub: 'P0–P4 / P1-C', icon: <Briefcase className="w-4 h-4" /> },
  { id: 'sizer', label: '反波動率倉位配置', sub: '張／零股配置', icon: <PieChart className="w-4 h-4" /> },
];

export function App() {
  const { activeTab, setActiveTab } = useTwQuantStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex">
      <aside
        className={`${
          sidebarOpen ? 'w-60' : 'w-16'
        } shrink-0 bg-[#0b111e] border-r border-slate-800 flex flex-col transition-all duration-200`}
      >
        <div className="h-14 px-3.5 border-b border-slate-800 flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shrink-0 text-slate-950 font-bold">
            <Terminal className="w-4 h-4" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-slate-100 truncate">
                TW-QVM Quant
              </div>
              <div className="text-[10px] text-cyan-400 font-mono truncate">
                TAIWAN STOCK TERMINAL
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2.5 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full px-2.5 py-2.5 rounded-lg flex items-center gap-3 text-left transition ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/35'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent'
                }`}
                title={item.label}
              >
                <span className="shrink-0">{item.icon}</span>
                {sidebarOpen && (
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{item.label}</div>
                    <div className="text-[10px] font-mono text-slate-500 truncate">{item.sub}</div>
                  </div>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          {sidebarOpen && <span className="truncate">TW-QVM + Cyclical v1.0</span>}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <TopControlBar onToggleSidebar={() => setSidebarOpen((v) => !v)} />

        <main className="flex-1 p-4 md:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'scorecard' && <ScorecardView />}
          {activeTab === 'screener' && <ScreenerView />}
          {activeTab === 'portfolio' && <PortfolioView />}
          {activeTab === 'sizer' && <SizerView />}
        </main>
      </div>
    </div>
  );
}

export default App;
