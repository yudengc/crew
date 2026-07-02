import { create } from 'zustand';
import type { Agent, Team, TaskItem, MarketplaceAgent, Settings, ChatMessage, ListingItem, AgentWorkspace, ChatSession } from '../types';
import { bridgeSend, streamAiChat } from '../utils/bridge';

interface AppState {
  agents: Agent[];
  teams: Team[];
  tasks: TaskItem[];
  marketplace: MarketplaceAgent[];
  settings: Settings;
  currentView: 'onboarding' | 'marketplace' | 'teams' | 'chat' | 'tasks' | 'agentFactory' | 'settings' | 'workspace';
  isLoading: boolean;
  error: string | null;

  setView: (view: AppState['currentView']) => void;
  loadData: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadTeams: () => Promise<void>;
  loadTasks: () => Promise<void>;
  loadMarketplace: () => Promise<void>;
  loadSettings: () => Promise<void>;

  saveAgent: (agent: Agent) => Promise<Agent | null>;
  deleteAgent: (id: string) => Promise<boolean>;
  saveTeam: (team: Team) => Promise<Team | null>;
  deleteTeam: (id: string) => Promise<boolean>;
  saveTask: (task: TaskItem) => Promise<TaskItem | null>;
  deleteTask: (id: string) => Promise<boolean>;
  saveSettings: (settings: Settings) => Promise<void>;
  purchaseAgent: (agent: MarketplaceAgent) => Promise<boolean>;
  callAi: (prompt: string, config?: Partial<Agent['config']>) => Promise<string>;
  streamCallAi: (prompt: string, onChunk: (text: string) => void, config?: Partial<Agent['config']>) => Promise<string>;
  cancelTask: (taskId: string) => Promise<boolean>;
  getWorkspace: (agentId: string, teamId: string) => Promise<AgentWorkspace | null>;
  saveWorkspaceMessage: (agentId: string, teamId: string, role: string, content: string) => Promise<void>;

  // 新功能
  addMemberToTeam: (teamId: string, agentId: string, role?: string) => Promise<boolean>;
  removeMemberFromTeam: (teamId: string, agentId: string) => Promise<boolean>;
  getChat: (teamId: string) => Promise<ChatMessage[]>;
  getSessions: (teamId: string) => Promise<ChatSession[]>;
  createSession: (teamId: string, name: string) => Promise<ChatSession | null>;
  getSessionMessages: (sessionId: string) => Promise<ChatMessage[]>;
  sendChatMessage: (teamId: string, agentId: string, agentName: string, content: string, isUser: boolean, msgId?: string, avatar?: string) => Promise<ChatMessage | null>;
  publishAgent: (agentId: string, price: number) => Promise<boolean>;
  unpublishAgent: (agentId: string) => Promise<boolean>;
  getListing: (agentId: string) => Promise<ListingItem | null>;
  executeTaskOrchestrated: (taskId: string) => Promise<TaskItem | null>;
}

export const useAppStore = create<AppState>((set, get) => ({
  agents: [],
  teams: [],
  tasks: [],
  marketplace: [],
  settings: {
    theme: 'light',
    aiProvider: 'deepseek',
    claudeApiKey: '',
    openAiApiKey: '',
    deepseekApiKey: '',
    defaultModel: 'deepseek-chat',
    hasCompletedOnboarding: false,
  },
  currentView: 'onboarding',
  isLoading: true,
  error: null,

  setView: (view) => set({ currentView: view }),

  loadData: async () => {
    set({ isLoading: true, error: null });
    try {
      await Promise.all([
        get().loadAgents(),
        get().loadTeams(),
        get().loadTasks(),
        get().loadMarketplace(),
        get().loadSettings(),
      ]);
      const settings = get().settings;
      if (settings.hasCompletedOnboarding) {
        set({ currentView: 'marketplace' });
      }
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  loadAgents: async () => {
    const data = await bridgeSend('getAgents');
    if (data) set({ agents: data as Agent[] });
  },

  loadTeams: async () => {
    const data = await bridgeSend('getTeams');
    if (data) set({ teams: data as Team[] });
  },

  loadTasks: async () => {
    const data = await bridgeSend('getTasks');
    if (data) set({ tasks: data as TaskItem[] });
  },

  loadMarketplace: async () => {
    const data = await bridgeSend('getMarketplace');
    if (data) set({ marketplace: data as MarketplaceAgent[] });
  },

  loadSettings: async () => {
    const data = await bridgeSend('getSettings');
    if (data) set({ settings: data as Settings });
  },

  saveAgent: async (agent) => {
    const result = await bridgeSend('saveAgent', JSON.stringify(agent));
    if (result) {
      await get().loadAgents();
      return result as Agent;
    }
    return null;
  },

  deleteAgent: async (id) => {
    const result = await bridgeSend('deleteAgent', id);
    if (result === true) {
      await get().loadAgents();
      return true;
    }
    return false;
  },

getSessions: async (teamId) => { const data = await bridgeSend('getSessions', teamId); return (data as ChatSession[]) || []; },  createSession: async (teamId, name) => { const data = await bridgeSend('createSession', JSON.stringify({ teamId, name })); return data as ChatSession | null; },  getSessionMessages: async (sessionId) => { const data = await bridgeSend('getSession', sessionId); if (data && typeof data === 'object') { const s = data as ChatSession; return s.messages || []; } return []; },
  getWorkspace: async (agentId, teamId) => {
    const data = await bridgeSend('getWorkspace', JSON.stringify({ agentId, teamId }));
    if (data) return data as AgentWorkspace;
    return null;
  },

  saveWorkspaceMessage: async (agentId, teamId, role, content) => {
    await bridgeSend('saveWorkspaceMessage', JSON.stringify({ agentId, teamId, role, content }));
  },

  saveTeam: async (team) => {
    const result = await bridgeSend('saveTeam', JSON.stringify(team));
    if (result) {
      await get().loadTeams();
      return result as Team;
    }
    return null;
  },

  deleteTeam: async (id) => {
    const result = await bridgeSend('deleteTeam', id);
    if (result === true) {
      await get().loadTeams();
      return true;
    }
    return false;
  },

  saveTask: async (task) => {
    const result = await bridgeSend('saveTask', JSON.stringify(task));
    if (result) {
      await get().loadTasks();
      return result as TaskItem;
    }
    return null;
  },

  deleteTask: async (id) => {
    const result = await bridgeSend('deleteTask', id);
    if (result === true) {
      await get().loadTasks();
      return true;
    }
    return false;
  },

  executeTaskOrchestrated: async (taskId) => {
    const task = get().tasks.find(t => t.id === taskId);
    if (!task) return null;

    const team = get().teams.find(t => t.id === task.teamId);
    if (!team) return null;

    // Build task payload with teamMembers embedded
    const taskPayload = {
      ...task,
      teamMembers: team.members,
    };

    const result = await bridgeSend('executeTaskOrchestrated', JSON.stringify(taskPayload));
    if (result && typeof result === 'object' && 'task' in result) {
      const updatedTask = (result as { task: TaskItem }).task;
      await get().loadTasks();
      return updatedTask;
    }
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error((result as { error: string }).error);
    }
    return null;
  },

  saveSettings: async (settings) => {
    try {
      await bridgeSend('saveSettings', JSON.stringify(settings));
      set({ settings });
    } catch (err) {
      console.error('Failed to save settings:', err);
      throw err;
    }
  },

  purchaseAgent: async (marketAgent) => {
    const newAgent: Agent = {
      id: crypto.randomUUID(),
      name: marketAgent.name,
      description: marketAgent.description,
      capabilities: marketAgent.capabilities,
      personality: { communication_style: '专业', decision_making: '理性' },
      config: {
        model_provider: get().settings.aiProvider,
        model_id: get().settings.defaultModel,
        temperature: 0.7,
        max_tokens: 4096,
      },
      cost: marketAgent.cost,
      isCustom: false,
      isListed: false,
      createdAt: new Date().toISOString(),
    };
    const result = await get().saveAgent(newAgent);
    return result !== null;
  },

  callAi: async (prompt, config) => {
    const settings = get().settings;
    const request = {
      prompt,
      modelId: config?.model_id || settings.defaultModel,
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.max_tokens ?? 4096,
    };
    const result = await bridgeSend('callAi', JSON.stringify(request));
    if (result && typeof result === 'object' && 'result' in result) {
      return (result as { result: string }).result;
    }
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error((result as { error: string }).error);
    }
    return '无响应';
  },

  streamCallAi: async (prompt, onChunk, config) => {
    const settings = get().settings;
    const modelId = config?.model_id || settings.defaultModel;
    return streamAiChat(prompt, modelId, onChunk);
  },

  cancelTask: async (taskId) => {
    const result = await bridgeSend('cancelTask', taskId);
    if (result && typeof result === 'object' && 'cancelled' in result) {
      await get().loadTasks();
      return true;
    }
    return false;
  },

  addMemberToTeam: async (teamId, agentId, role = 'member') => {
    const teams = get().teams;
    const team = teams.find(t => t.id === teamId);
    if (!team) return false;

    const exists = team.members.some(m => m.agentId === agentId);
    if (exists) return false;

    const newMember = { agentId, role, isManager: role === 'manager' };
    const updatedTeam = {
      ...team,
      members: [...team.members, newMember]
    };

    const result = await get().saveTeam(updatedTeam);
    return result !== null;
  },

  removeMemberFromTeam: async (teamId, agentId) => {
    const teams = get().teams;
    const team = teams.find(t => t.id === teamId);
    if (!team) return false;

    const updatedTeam = {
      ...team,
      members: team.members.filter(m => m.agentId !== agentId)
    };

    const result = await get().saveTeam(updatedTeam);
    return result !== null;
  },

  getChat: async (teamId) => {
    const data = await bridgeSend('getChat', teamId);
    if (data && typeof data === 'object') {
      const chat = data as { teamId?: string; messages?: ChatMessage[] };
      return chat.messages || [];
    }
    return [];
  },

  sendChatMessage: async (teamId, agentId, agentName, content, isUser, msgId, avatar) => {
    const msg: Record<string, unknown> = {
      id: msgId || crypto.randomUUID(),
      teamId, agentId, agentName, content, isUser,
      timestamp: new Date().toISOString(),
    };
    if (avatar) msg.avatar = avatar;

    const result = await bridgeSend('sendChatMessage', JSON.stringify(msg));
    return result as ChatMessage | null;
  },

  publishAgent: async (agentId, price) => {
    const agents = get().agents;
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return false;

    const listing = {
      id: crypto.randomUUID(),
      agentId: agent.id,
      agentName: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      price,
      listedAt: new Date().toISOString(),
    };

    const result = await bridgeSend('publishAgent', JSON.stringify(listing));
    if (result) {
      const updatedAgent = { ...agent, isListed: true };
      await get().saveAgent(updatedAgent);
      return true;
    }
    return false;
  },

  unpublishAgent: async (agentId) => {
    const result = await bridgeSend('unpublishAgent', agentId);
    if (result === true) {
      const agents = get().agents;
      const agent = agents.find(a => a.id === agentId);
      if (agent) {
        const updatedAgent = { ...agent, isListed: false };
        await get().saveAgent(updatedAgent);
      }
      return true;
    }
    return false;
  },

  getListing: async (agentId) => {
    const data = await bridgeSend('getListing', agentId);
    if (data) return data as ListingItem;
    return null;
  },
}));