import React, { useEffect, useState } from 'react';
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
import { ScreenerView } from './components/ScreenerView';
import { SizerView } from './components/SizerView';
import { StockHealthReportView } from './components/StockHealthReportView';
import { TopControlBar } from './components/TopControlBar';
import { useTwQuantStore, type NavTab } from './store/useTwQuantStore';

const NAV_ITEMS: { id: NavTab; label: string; sub: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: '選股總覽首頁', sub: '市場戰報與推薦', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'scorecard', label: '個股深度健檢書', sub: '五章節白話診斷', icon: <ClipboardCheck className="w-4 h-4" /> },
  { id: 'screener', label: '台股分類搜尋池', sub: '全清單篩選比較', icon: <Filter className="w-4 h-4" /> },
  { id: 'portfolio', label: '持倉監控與出場', sub: '停損停利預警台', icon: <Briefcase className="w-4 h-4" /> },
  { id: 'sizer', label: '資金與張數試算', sub: '整張與零股配置', icon: <PieChart className="w-4 h-4" /> },
];

export function App() {
  const { activeTab, setActiveTab, loadStaticData } = useTwQuantStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    void loadStaticData();
  }, [loadStaticData]);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex overflow-x-hidden">
      <aside
        className={`hidden md:flex ${
          sidebarOpen ? 'w-60' : 'w-16'
        } shrink-0 bg-[#0b111e] border-r border-slate-800 flex-col transition-all duration-200 no-print`}
      >
        <div className="h-14 px-3.5 border-b border-slate-800 flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shrink-0 text-slate-950 font-bold">
            <Terminal className="w-4 h-4" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-slate-100 truncate">
                台股穩健選股平台
              </div>
              <div className="text-[10px] text-cyan-400 font-mono truncate">
                深度健檢與買賣建議
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
                    <div className="text-[10px] text-slate-500 truncate">{item.sub}</div>
                  </div>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          {sidebarOpen && <span className="truncate">真實台股數據自動更新</span>}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col pb-16 md:pb-0">
        <TopControlBar onToggleSidebar={() => setSidebarOpen((v) => !v)} />

        <main className="flex-1 p-3 sm:p-4 md:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'scorecard' && (
            <StockHealthReportView onBackToSearch={() => setActiveTab('dashboard')} />
          )}
          {activeTab === 'screener' && <ScreenerView />}
          {activeTab === 'portfolio' && <PortfolioView />}
          {activeTab === 'sizer' && <SizerView />}
        </main>

        {/* 手機版底部導覽列 */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#0b111e]/95 backdrop-blur border-t border-slate-800 grid grid-cols-5 py-1.5 px-1 no-print">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-medium transition ${
                  active ? 'text-cyan-300' : 'text-slate-400'
                }`}
              >
                {item.icon}
                <span className="mt-0.5 truncate max-w-[68px]">{item.label.slice(0, 4)}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export default App;
