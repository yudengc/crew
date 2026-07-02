export interface Agent {
  id: string;
  name: string;
  avatar?: string;
  description: string;
  capabilities: string[];
  personality?: AgentPersonality;
  config: AgentConfig;
  cost: number;
  isCustom: boolean;
  isListed: boolean;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  teamId: string;
  name: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  teamId: string;
  sessionId?: string;
  agentId: string;
  agentName: string;
  avatar?: string;
  content: string;
  isUser: boolean;
  timestamp: string;
  replyTo?: string;
  targetAgentId?: string;
  messageType?: 'chat' | 'task' | 'report' | 'question';
}

export interface AgentPersonality {
  communication_style: string;
  decision_making: string;
}

export interface AgentConfig {
  model_provider: string;
  model_id: string;
  temperature: number;
  max_tokens: number;
}

export interface Team {
  id: string;
  name: string;
  members: TeamMember[];
  createdAt: string;
}

export interface TeamMember {
  agentId: string;
  role: string;
  isManager: boolean;
}

export interface SubTask {
  id: string;
  title: string;
  assignedAgentId: string;
  assignedAgentName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  teamId: string;
  teamMembers: TeamMember[];
  status: 'pending' | 'in_progress' | 'completed';
  result: string;
  createdAt: string;
  completedAt?: string;
  subTasks: SubTask[];
  phase: 'idle' | 'decomposing' | 'executing' | 'synthesizing' | 'completed';
}

export interface MarketplaceAgent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  cost: number;
  isBuiltIn: boolean;
}

export interface Settings {
  theme: string;
  aiProvider: string;
  claudeApiKey: string;
  openAiApiKey: string;
  deepseekApiKey: string;
  defaultModel: string;
  hasCompletedOnboarding: boolean;
}

export interface WorkspaceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AgentWorkspace {
  id: string;
  teamId: string;
  agentId: string;
  name: string;
  messages: WorkspaceMessage[];
  createdAt: string;
}

export interface ListingItem {
  id: string;
  agentId: string;
  agentName: string;
  description: string;
  capabilities: string[];
  price: number;
  listedAt: string;
}

export type Capability =
  | 'code_generation'
  | 'code_review'
  | 'data_analysis'
  | 'text_processing'
  | 'research'
  | 'design'
  | 'planning'
  | 'communication';

export const CAPABILITIES: { value: Capability; label: string; icon: string }[] = [
  { value: 'code_generation', label: '写代码', icon: '💻' },
  { value: 'code_review', label: '代码审查', icon: '🔍' },
  { value: 'data_analysis', label: '数据分析', icon: '📊' },
  { value: 'text_processing', label: '文本处理', icon: '📝' },
  { value: 'research', label: '调研搜索', icon: '🔬' },
  { value: 'design', label: '设计产出', icon: '🎨' },
  { value: 'planning', label: '任务规划', icon: '📋' },
  { value: 'communication', label: '对外沟通', icon: '🗣️' },
];