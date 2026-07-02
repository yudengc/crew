import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { useAppStore } from './stores/appStore';
import Layout from './components/Layout';
import Onboarding from './views/Onboarding';
import Marketplace from './views/Marketplace';
import Teams from './views/Teams';
import TeamChat from './views/TeamChat';
import TaskCenter from './views/TaskCenter';
import AgentFactory from './views/AgentFactory';
import Settings from './views/Settings';

function App() {
  const { currentView, loadData, isLoading, error } = useAppStore();

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1e1e1e]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-gray-400 text-lg">加载中...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1e1e1e]">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">加载失败</p>
          <p className="text-gray-500 text-sm mb-4">{error}</p>
          <button
            onClick={() => loadData()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster
        theme="light"
        position="bottom-right"
        toastOptions={{
          style: { background: '#fff', border: '1px solid #e5e7eb', color: '#111827' },
        }}
      />
      {currentView === 'onboarding' ? (
        <Onboarding />
      ) : (
        <Layout>
          {currentView === 'marketplace' && <Marketplace />}
          {currentView === 'teams' && <Teams />}
          {currentView === 'chat' && <TeamChat />}
          {currentView === 'tasks' && <TaskCenter />}
          {currentView === 'agentFactory' && <AgentFactory />}
          {currentView === 'settings' && <Settings />}
        </Layout>
      )}
    </>
  );
}

export default App;