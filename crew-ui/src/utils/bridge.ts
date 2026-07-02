export {};

declare global {
  interface Window {
    ClaireBridge: {
      send: (action: string, data?: unknown) => Promise<unknown>;
      onResult: (data: unknown) => void;
      onError: (error: string) => void;
      onStreamEvent: (event: StreamEvent) => void;
    };
  }
}

export interface StreamEvent {
  streamId: string;
  type: 'chunk' | 'done' | 'error' | 'cancelled';
  data: string;
}

function tryParse(v: unknown): unknown {
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

export async function bridgeSend(action: string, data?: unknown): Promise<unknown> {
  if (window.ClaireBridge) {
    const raw = await window.ClaireBridge.send(action, data);
    return tryParse(raw);
  }
  console.warn('ClaireBridge not available, using mock');
  return mockBridge(action, data);
}

// Load persisted settings from localStorage for browser dev mode
const defaultSettings = {
  theme: 'light', aiProvider: 'deepseek', hasCompletedOnboarding: false,
  claudeApiKey: '', openAiApiKey: '', deepseekApiKey: '', defaultModel: 'deepseek-chat'
};
let savedSettings: Record<string, unknown> | null = null;
try {
  const raw = localStorage.getItem('crew-settings');
  if (raw) savedSettings = JSON.parse(raw);
} catch { /* ignore */ }

const mockData: Record<string, unknown> = {
  agents: [],
  teams: [],
  tasks: [],
  chats: {},
  marketplace: [
    { id: '1', name: '代码助手', description: '熟练掌握多种编程语言', capabilities: ['code_generation'], cost: 50, isBuiltIn: true },
    { id: '2', name: '数据分析员', description: '精通数据分析和可视化', capabilities: ['data_analysis'], cost: 80, isBuiltIn: true },
  ],
  settings: savedSettings || defaultSettings,
  listings: [],
};

function mockBridge(action: string, data?: unknown): unknown {
  const parsed = typeof data === 'string' ? tryParse(data) : data;

  switch (action) {
    case 'getAgents': return mockData.agents;
    case 'getTeams': return mockData.teams;
    case 'getTasks': return mockData.tasks;
    case 'getMarketplace': return mockData.marketplace;
    case 'getSettings': return mockData.settings;
    case 'getChats': return mockData.chats;
    case 'getChat': {
      const teamId = typeof data === 'string' ? data : '';
      const chat = (mockData.chats as Record<string, unknown>)[teamId];
      return chat || { teamId, messages: [] };
    }
    case 'getListing': return null;
    case 'saveAgent': {
      const agent = parsed as Record<string, unknown>;
      if (!agent) return null;
      const agents = mockData.agents as Record<string, unknown>[];
      const idx = agents.findIndex(a => (a as Record<string,unknown>).id === agent.id);
      if (idx >= 0) agents[idx] = agent; else agents.push(agent);
      mockData.agents = agents;
      return agent;
    }
    case 'deleteAgent': {
      const agents = mockData.agents as Record<string, unknown>[];
      mockData.agents = agents.filter(a => (a as Record<string,unknown>).id !== data);
      return true;
    }
    case 'saveTeam': {
      const team = parsed as Record<string, unknown>;
      if (!team) return null;
      const teams = mockData.teams as Record<string, unknown>[];
      const idx = teams.findIndex(t => (t as Record<string,unknown>).id === team.id);
      if (idx >= 0) teams[idx] = team; else teams.push(team);
      mockData.teams = teams;
      return team;
    }
    case 'deleteTeam': {
      const teams = mockData.teams as Record<string, unknown>[];
      mockData.teams = teams.filter(t => (t as Record<string,unknown>).id !== data);
      return true;
    }
    case 'saveTask': {
      const task = parsed as Record<string, unknown>;
      if (!task) return null;
      const tasks = mockData.tasks as Record<string, unknown>[];
      const idx = tasks.findIndex(t => (t as Record<string,unknown>).id === task.id);
      if (idx >= 0) tasks[idx] = task; else tasks.push(task);
      mockData.tasks = tasks;
      return task;
    }
    case 'deleteTask': {
      const tasks = mockData.tasks as Record<string, unknown>[];
      mockData.tasks = tasks.filter(t => (t as Record<string,unknown>).id !== data);
      return true;
    }
    case 'sendChatMessage': {
      const msg = parsed as Record<string, unknown>;
      if (!msg) return null;
      const chats = mockData.chats as Record<string, Record<string, unknown>>;
      const teamId = msg.teamId as string;
      if (!chats[teamId]) chats[teamId] = { teamId, messages: [] };
      (chats[teamId].messages as unknown[]).push(msg);
      return msg;
    }
    case 'publishAgent': return parsed;
    case 'unpublishAgent': return true;
    case 'saveSettings': {
      mockData.settings = parsed as typeof mockData.settings;
      try { localStorage.setItem('crew-settings', JSON.stringify(mockData.settings)); } catch { /* ignore */ }
      return mockData.settings;
    }
    case 'executeTaskOrchestrated': {
      const taskPayload = parsed as Record<string, unknown>;
      const tasks = mockData.tasks as Record<string, unknown>[];
      const task = tasks.find(t => (t as Record<string,unknown>).id === taskPayload?.id) as Record<string,unknown> | undefined;
      if (!task) return { error: '任务未找到' };

      // Phase 1: Decompose (simulated with delay)
      task.phase = 'decomposing';
      const teamMembers = (taskPayload?.teamMembers || []) as Record<string, unknown>[];
      const mockSubTasks = teamMembers.slice(0, 4).map((m: Record<string,unknown>, i: number) => ({
        id: `sub-${Date.now()}-${i}`,
        title: ['分析需求', '收集数据', '执行核心逻辑', '验证结果'][i] || `子任务 ${i + 1}`,
        assignedAgentId: m.agentId || `agent-${i}`,
        assignedAgentName: (m as Record<string,unknown>).role || `成员 ${i + 1}`,
        status: 'pending',
        result: '',
      }));
      task.subTasks = mockSubTasks;

      // Async simulate the full pipeline
      setTimeout(() => {
        // Phase 2: Execute — mark sub-tasks in progress → completed
        task.phase = 'executing';
        mockSubTasks.forEach((st: Record<string,unknown>, i: number) => {
          setTimeout(() => {
            (st as Record<string,unknown>).status = 'in_progress';
            setTimeout(() => {
              (st as Record<string,unknown>).status = 'completed';
              (st as Record<string,unknown>).result = `[Mock] 子任务执行完成。在桌面应用中可调用真实 AI 执行此任务。`;
            }, 600 + i * 200);
          }, i * 400);
        });

        // Phase 3: Synthesize
        setTimeout(() => {
          task.phase = 'synthesizing';
          setTimeout(() => {
            task.phase = 'completed';
            task.status = 'completed';
            task.result = '📋 [Mock 模式] 任务已完成三阶段编排：拆解 → 并行执行 → 综合。各子任务已由对应成员完成。\n\n⚠️ 在桌面应用中运行可获得真实 AI 编排结果。';
            task.completedAt = new Date().toISOString();
          }, 1500);
        }, teamMembers.length * 400 + 1000);
      }, 1200);

      return { task: { ...task, id: taskPayload?.id } };
    }
    case 'streamAi': return { streamId: 'mock', status: 'streaming' };
    case 'cancelAi': return { cancelled: true };
    case 'cancelTask': return { cancelled: true };
    default: return null;
  }
}

export function setupBridgeCallbacks() {
  if (!window.ClaireBridge) {
    console.log('Running in dev mode — ClaireBridge not available');
    return;
  }

  window.ClaireBridge.onResult = (data) => {
    console.log('Bridge result:', data);
  };
  window.ClaireBridge.onError = (error) => {
    console.error('Bridge error:', error);
  };
  window.ClaireBridge.onStreamEvent = (event) => {
    console.log('Stream event:', event.type, event.streamId);
  };
}

// ── Streaming helper ──────────────────────────────────────────

const streamHandlers = new Map<string, (event: StreamEvent) => void>();

/**
 * Stream an AI chat response, calling onChunk for each text delta
 * and returning the complete text when done.
 */
export function streamAiChat(
  prompt: string,
  modelId: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const chunks: string[] = [];
    let settled = false;

    // Register handler for streaming events
    const handler = (event: StreamEvent) => {
      if (event.streamId !== streamId || settled) return;

      switch (event.type) {
        case 'chunk':
          chunks.push(event.data);
          onChunk(event.data);
          break;
        case 'done':
          settled = true;
          streamHandlers.delete(streamId);
          resolve(chunks.join(''));
          break;
        case 'error':
          settled = true;
          streamHandlers.delete(streamId);
          reject(new Error(event.data));
          break;
        case 'cancelled':
          settled = true;
          streamHandlers.delete(streamId);
          resolve(chunks.join('') + '\n\n[已取消]');
          break;
      }
    };

    // Store handler and wire bridge
    streamHandlers.set(streamId, handler);

    if (window.ClaireBridge) {
      window.ClaireBridge.onStreamEvent = (event) => {
        const h = streamHandlers.get(event.streamId);
        if (h) h(event);
      };
    } else {
      // Dev mode mock: simulate word-by-word streaming
      setTimeout(() => {
        if (settled) return;
        const responses = [
          '好的，我来分析一下这个需求。根据当前团队的配置和成员能力，我建议按以下步骤推进：\n\n1. **需求分析** — 先理清核心目标和约束条件\n2. **方案设计** — 制定可执行的计划\n3. **分工协作** — 将任务分配给最合适的成员\n\n这是一个典型的团队协作场景，每位成员都能发挥自己的专长。',
          '我同意这个方案。从技术角度来看，实现起来并不复杂。我们需要注意以下几点：\n\n- 保持代码质量和可维护性\n- 做好错误处理和边界情况\n- 确保性能和响应速度\n\n如果有具体的技术问题，随时可以问我。',
          '从项目管理的角度考虑，建议我们设置明确的里程碑和检查点。这样能够确保团队始终保持同步，及时发现并解决潜在问题。\n\n各位成员请按照分工推进，有进展及时同步。',
        ];
        const text = responses[Math.floor(Math.random() * responses.length)];
        const words = text.split('');
        let i = 0;
        const iv = setInterval(() => {
          if (settled) { clearInterval(iv); return; }
          const step = 3 + Math.floor(Math.random() * 5);
          const chunk = words.slice(i, i + step).join('');
          i += step;
          if (i >= words.length) {
            clearInterval(iv);
            handler({ streamId, type: 'chunk', data: words.slice(i - step).join('') });
            handler({ streamId, type: 'done', data: '' });
          } else {
            handler({ streamId, type: 'chunk', data: chunk });
          }
        }, 30 + Math.floor(Math.random() * 40));
      }, 400 + Math.random() * 600);
    }

    // Listen for abort signal
    if (signal) {
      signal.addEventListener('abort', () => {
        if (!settled) {
          bridgeSend('cancelAi', JSON.stringify({ streamId })).catch(console.error);
          handler({ streamId, type: 'cancelled', data: '' });
        }
      });
    }

    // Send stream request
    const payload = {
      prompt,
      modelId: modelId || 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 4096,
    };

    bridgeSend('streamAi', { streamId, data: JSON.stringify(payload) })
      .catch((err) => {
        if (!settled) {
          handler({ streamId, type: 'error', data: err instanceof Error ? err.message : String(err) });
        }
      });
  });
}
