export {};

declare global {
  interface Window {
    ClaireBridge: {
      send: (action: string, data?: unknown) => Promise<unknown>;
      onResult: (callback: (data: unknown) => void) => void;
      onError: (callback: (error: string) => void) => void;
    };
  }
}

export async function bridgeSend(action: string, data?: unknown): Promise<unknown> {
  if (window.ClaireBridge) {
    return window.ClaireBridge.send(action, data);
  }
  console.warn('ClaireBridge not available, using mock');
  return mockBridge(action, data);
}

const mockData: Record<string, unknown> = {
  agents: [],
  teams: [],
  tasks: [],
  chats: {},
  marketplace: [
    { id: '1', name: '代码助手', description: '熟练掌握多种编程语言', capabilities: ['code_generation'], cost: 50, isBuiltIn: true },
    { id: '2', name: '数据分析员', description: '精通数据分析和可视化', capabilities: ['data_analysis'], cost: 80, isBuiltIn: true },
  ],
  settings: { theme: 'dark', aiProvider: 'claude', hasCompletedOnboarding: false },
  listings: [],
};

function mockBridge(action: string, data?: unknown): unknown {
  switch (action) {
    case 'getAgents': return mockData.agents;
    case 'getTeams': return mockData.teams;
    case 'getTasks': return mockData.tasks;
    case 'getMarketplace': return mockData.marketplace;
    case 'getSettings': return mockData.settings;
    case 'getChats': return mockData.chats;
    case 'saveSettings': mockData.settings = data as typeof mockData.settings; return mockData.settings;
    case 'getListing': return null;
    default: return null;
  }
}

export function setupBridgeCallbacks() {
  if (window.ClaireBridge) {
    window.ClaireBridge.onResult((data) => {
      console.log('Bridge result:', data);
    });
    window.ClaireBridge.onError((error) => {
      console.error('Bridge error:', error);
    });
  }
}