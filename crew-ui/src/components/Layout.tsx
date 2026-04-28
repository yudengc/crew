import type { ReactNode } from 'react';
import { useAppStore } from '../stores/appStore';

const navItems = [
  { key: 'marketplace', label: '市场', icon: '🏪' },
  { key: 'teams', label: '我的团队', icon: '👥' },
  { key: 'chat', label: '协作群', icon: '💬' },
  { key: 'tasks', label: '任务中心', icon: '📋' },
  { key: 'agentFactory', label: 'Agent工厂', icon: '🏭' },
  { key: 'settings', label: '设置', icon: '⚙️' },
] as const;

export default function Layout({ children }: { children: ReactNode }) {
  const { currentView, setView } = useAppStore();

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] text-gray-200">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-[#252526]">
        <h1 className="text-xl font-semibold text-white">Agent Team Orchestrator</h1>
        <nav className="flex gap-2">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                currentView === item.key
                  ? 'bg-[#094771] text-white'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  );
}