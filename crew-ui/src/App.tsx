import { useEffect } from 'react';
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
  const { currentView, loadData, isLoading } = useAppStore();

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1e1e1e]">
        <div className="text-gray-400 text-lg">加载中...</div>
      </div>
    );
  }

  return (
    <>
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