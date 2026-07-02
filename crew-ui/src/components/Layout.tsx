import type { ReactNode } from 'react';
import { useAppStore } from '../stores/appStore';

const navItems = [
  { key: 'marketplace', label: 'Agent 市场', icon: '🏪' },
  { key: 'teams', label: '我的团队', icon: '👥' },
  { key: 'chat', label: '协作群', icon: '💬' },
  { key: 'tasks', label: '任务中心', icon: '📋' },
  { key: 'agentFactory', label: 'Agent 工厂', icon: '🏭' },
  { key: 'settings', label: '设置', icon: '⚙️' },
] as const;

export default function Layout({ children }: { children: ReactNode }) {
  const { currentView, setView, agents } = useAppStore();

  return (
    <div className="flex h-screen w-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col bg-white border-r border-gray-200">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100">
          <h1 className="text-lg font-bold text-gray-900 tracking-tight">Crew</h1>
          <p className="text-xs text-gray-400 mt-0.5">Agent Team Orchestrator</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => {
            const active = currentView === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key as typeof currentView)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  active
                    ? 'bg-blue-50 text-blue-700 shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="mx-3 mb-3 px-3 py-2.5 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-sm shadow-green-200" />
            <span>{agents.length} 个 Agent 就绪</span>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
