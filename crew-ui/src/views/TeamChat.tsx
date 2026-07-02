import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/appStore';
import type { Agent, ChatMessage } from '../types';

interface StreamingMsg {
  id: string; agentId: string; agentName: string; avatar?: string;
  content: string; timestamp: string; done: boolean;
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500',
];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function parseMentions(text: string, agents: Agent[]) {
  const mentionRegex = /@(\S+)/g;
  const mentioned = new Set<string>();
  let m;
  while ((m = mentionRegex.exec(text)) !== null) {
    const agent = agents.find(a => a.name === m![1]);
    if (agent) mentioned.add(agent.id);
  }
  const cleanText = text.replace(mentionRegex, '').trim();
  return { targetAgentIds: [...mentioned], cleanText: cleanText || text.trim() };
}

export default function TeamChat() {
  const { teams, agents, tasks, getChat, sendChatMessage, streamCallAi, saveWorkspaceMessage } = useAppStore();
  const [teamId, setTeamId] = useState('');
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState<string[]>([]);
  const [streaming, setStreaming] = useState<StreamingMsg[]>([]);
  const [mentionSuggest, setMentionSuggest] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const sendLockRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const team = teams.find(t => t.id === teamId);
  const manager = team?.members.find(m => m.isManager);
  const managerAgent = manager ? agents.find(a => a.id === manager.agentId) : null;
  const teamAgents = agents.filter(a => team?.members.some(m => m.agentId === a.id));

  useEffect(() => { if (teamId) load(); }, [teamId]);

  useEffect(() => {
    if (!teamId) return;
    const id = setInterval(() => {
      getChat(teamId).then(latest => {
        setMsgs(prev => {
          const ids = new Set(prev.map(m => m.id));
          const fresh = latest.filter(m => !ids.has(m.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      }).catch(err => { console.error('Chat poll error:', err); });
    }, 3000);
    return () => clearInterval(id);
  }, [teamId]);

  const load = async () => { const c = await getChat(teamId); setMsgs(c); };

  const scrollDown = () => { if (nearBottom.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); };
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);
  useEffect(() => { scrollDown(); }, [msgs.length, streaming]);

  const cancel = () => {
    controllerRef.current?.abort(); controllerRef.current = null;
    setBusy(false); setThinking([]); setStreaming([]);
    toast.info('已停止生成');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; setInput(val);
    const cursor = e.target.selectionStart ?? 0;
    const atIdx = val.slice(0, cursor).lastIndexOf('@');
    setMentionSuggest(atIdx >= 0 && !val.slice(atIdx, cursor).includes(' '));
  };

  const insertMention = (agentName: string) => {
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, cursor), after = input.slice(cursor);
    const atIdx = before.lastIndexOf('@');
    setInput(atIdx >= 0 ? before.slice(0, atIdx) + '@' + agentName + ' ' + after : '@' + agentName + ' ' + input);
    setMentionSuggest(false);
    inputRef.current?.focus();
  };

  const send = async () => {
    if (!input.trim() || !teamId || !team || sendLockRef.current) return;
    sendLockRef.current = true;
    const { targetAgentIds, cleanText } = parseMentions(input.trim(), agents);
    let targets = team.members.filter(m => {
      if (targetAgentIds.length > 0) return targetAgentIds.includes(m.agentId);
      return m.isManager;
    });
    if (targets.length === 0 && targetAgentIds.length > 0) {
      toast.error('未找到匹配的 Agent'); sendLockRef.current = false; return;
    }
    if (targets.length === 0 && !manager) {
      toast.error('该团队没有管理者'); sendLockRef.current = false; return;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), teamId, agentId: 'user',
      agentName: '我', content: input, isUser: true, timestamp: new Date().toISOString(),
    };
    await sendChatMessage(teamId, 'user', '我', input, true, userMsg.id);
    setMsgs(prev => [...prev, userMsg]); setInput('');
    if (busy) { sendLockRef.current = false; return; }

    setBusy(true);
    const controller = new AbortController(); controllerRef.current = controller;
    const history = [...msgs, userMsg].slice(-8).map(m => `${m.agentName}: ${m.content}`).join('\n');

    // Build team context for manager coordination
    const buildTeamContext = () => {
      const memberInfo = team.members.map(m => {
        const a = agents.find(x => x.id === m.agentId);
        if (!a) return null;
        const memberTasks = tasks.filter(t => t.teamId === teamId && t.subTasks?.some(s => s.assignedAgentId === a.id));
        const inProgress = memberTasks.filter(t => t.status === 'in_progress').length;
        return `- ${m.isManager ? '👑' : ''} ${a.name}: ${a.capabilities?.join(', ') || a.description}${inProgress > 0 ? ` [进行中: ${inProgress}个任务]` : ''}`;
      }).filter(Boolean).join('\n');
      const activeTasks = tasks.filter(t => t.teamId === teamId && t.status === 'in_progress');
      const taskSummary = activeTasks.length > 0
        ? activeTasks.map(t => `- ${t.title} [${t.phase}]`).join('\n')
        : '无进行中的任务';
      return `团队成员：\n${memberInfo}\n\n进行中的任务：\n${taskSummary}`;
    };

    const teamContext = buildTeamContext();

    const promises = targets.map(async m => {
      const agent = agents.find(a => a.id === m.agentId);
      if (!agent) return null;
      const streamId = crypto.randomUUID();
      setThinking(prev => [...prev, agent.name]);
      const streamMsg: StreamingMsg = {
        id: streamId, agentId: agent.id, agentName: agent.name,
        avatar: agent.avatar, content: '', timestamp: new Date().toISOString(), done: false,
      };
      setStreaming(prev => [...prev, streamMsg]);

      try {
        const isManager = m.isManager;
        const teamMembersCtx = `你所在团队：${team.name}\n${teamContext}`;
        const prompt = targetAgentIds.length > 0
          ? `你是团队「${team.name}」的成员「${agent.name}」。\n\n${teamMembersCtx}\n\n你可以用 @成员名 与团队中的其他成员协作。\n\n团队协作群中 @了你。最近对话：\n${history}\n\n用户对你说：「${cleanText}」\n\n请回复。如需其他成员协助，@他们。80-200字。`
          : isManager
            ? `你是团队「${team.name}」的管理者「${agent.name}」。\n\n${teamMembersCtx}\n\n你可以用 @成员名 给团队成员分配任务。\n\n协作群最近对话：\n${history}\n\n作为管理者，请：\n1. 分析当前需求\n2. 如有必要，@具体成员分配任务（如 \"@代码助手 请实现XX模块\"）\n3. 说明决策理由\n\n100-200字。`
            : `你是「${agent.name}」，${agent.description || '团队成员'}。\n\n${teamMembersCtx}\n\n你可以用 @成员名 与其他成员协作。\n\n协作群对话：\n${history}\n\n报告工作进展，如需协助请 @其他成员。80-150字。`;

        const fullText = await streamCallAi(
          prompt,
          (chunk) => {
            if (controller.signal.aborted) return;
            setStreaming(prev => prev.map(s => s.id === streamId ? { ...s, content: s.content + chunk } : s));
          },
          agent.config,
        );
        if (controller.signal.aborted) return null;
        setStreaming(prev => prev.map(s => s.id === streamId ? { ...s, done: true } : s));
        if (fullText.trim()) {
          const am: ChatMessage = {
            id: crypto.randomUUID(), teamId, agentId: agent.id,
            agentName: agent.name, avatar: agent.avatar,
            content: fullText, isUser: false, timestamp: new Date().toISOString(),
          };
          await sendChatMessage(teamId, agent.id, agent.name, fullText, false, am.id, agent.avatar);
          return am;
        }
        return null;
      } catch (err) {
        if (controller.signal.aborted) return null;
        toast.error(`${agent.name} 回复失败`);
        return null;
      } finally {
        setThinking(prev => prev.filter(n => n !== agent.name));
        setStreaming(prev => prev.filter(s => s.id !== streamId));
      }
    });

    const results = await Promise.all(promises);
    if (!controller.signal.aborted) {
      const valid = results.filter(Boolean) as ChatMessage[];
      setMsgs(prev => [...prev, ...valid]);

      // Auto-dispatch: manager's @mentions → workspace tasks + agents respond in chat
      for (const msg of valid) {
        const agent = agents.find(a => a.id === msg.agentId);
        if (!agent || !team.members.find(m => m.agentId === agent.id)) continue;
        const { targetAgentIds: dispatched, cleanText: instruction } = parseMentions(msg.content, agents);
        if (dispatched.length === 0) continue;

        // Trigger responses from @mentioned agents
        for (const aid of dispatched) {
          const target = agents.find(a => a.id === aid);
          if (!target || aid === agent.id) continue;

          // Create workspace task
          const taskMsg = `[${agent.isManager ? '管理者' : ''} ${agent.name} @了你]\n${instruction || msg.content}`;
          saveWorkspaceMessage(aid, teamId, 'user', taskMsg).catch(() => {});

          // Also have the agent respond directly in the chat
          const streamId = crypto.randomUUID();
          setThinking(prev => [...prev, target.name]);
          const streamMsg: StreamingMsg = {
            id: streamId, agentId: target.id, agentName: target.name,
            avatar: target.avatar, content: '', timestamp: new Date().toISOString(), done: false,
          };
          setStreaming(prev => [...prev, streamMsg]);

          streamCallAi(
            `你是团队「${team.name}」的成员「${target.name}」，${target.description || '团队成员'}。\n\n${history}\n\n${agent.name} 在协作群中 @了你：「${instruction || msg.content}」\n\n请直接回复确认收到任务并简要说明你接下来会怎么做。50-100字，直接回复，不要加前缀。`,
            (chunk) => {
              setStreaming(prev => prev.map(s => s.id === streamId ? { ...s, content: s.content + chunk } : s));
            },
            target.config,
          ).then(async (fullText) => {
            setStreaming(prev => prev.map(s => s.id === streamId ? { ...s, done: true } : s));
            if (fullText.trim()) {
              const am: ChatMessage = {
                id: crypto.randomUUID(), teamId, agentId: target.id,
                agentName: target.name, avatar: target.avatar,
                content: fullText, isUser: false, timestamp: new Date().toISOString(),
              };
              await sendChatMessage(teamId, target.id, target.name, fullText, false, am.id, target.avatar);
              setMsgs(prev => [...prev, am]);
            }
          }).catch(() => {}).finally(() => {
            setThinking(prev => prev.filter(n => n !== target.name));
            setStreaming(prev => prev.filter(s => s.id !== streamId));
          });
        }
      }
    }
    setBusy(false); controllerRef.current = null; sendLockRef.current = false;
    setTimeout(scrollDown, 100);
  };

  const getMentionSuggestions = () => {
    if (!mentionSuggest) return [];
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const atIdx = input.slice(0, cursor).lastIndexOf('@');
    if (atIdx < 0) return [];
    const partial = input.slice(atIdx + 1, cursor).toLowerCase();
    return teamAgents.filter(a => !partial || a.name.toLowerCase().includes(partial));
  };

  const AvatarCircle = ({ name, avatar, size = 'md' }: { name: string; avatar?: string; size?: 'sm' | 'md' }) => (
    <div className={`${size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs'} rounded-full flex items-center justify-center text-white font-bold shrink-0 ${getAvatarColor(name)}`}>
      {avatar || name.charAt(0)}
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-1px)]">
      {/* Team list sidebar */}
      <div className="w-56 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="p-3 border-b border-gray-200 bg-white">
          <h3 className="text-sm font-semibold text-gray-700">协作群</h3>
          <p className="text-xs text-gray-400 mt-0.5">{teams.length} 个团队</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {teams.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">暂无团队，先去「我的团队」创建</p>
          )}
          {teams.map(t => {
            const m = t.members.find(mb => mb.isManager);
            const ma = m ? agents.find(a => a.id === m.agentId) : null;
            const active = t.id === teamId;
            return (
              <button key={t.id} onClick={() => setTeamId(t.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${
                  active ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                <div className="font-medium flex items-center gap-1.5">
                  <span className="text-base">{active ? '💬' : '💬'}</span>
                  {t.name}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {ma && <span className={`w-4 h-4 rounded-full text-[8px] flex items-center justify-center text-white ${getAvatarColor(ma.name)}`}>{ma.avatar || ma.name.charAt(0)}</span>}
                  <span className="text-[11px] text-gray-400">{t.members.length} 人{ma ? ` · 👑${ma.name}` : ' · ⚠️无管理'}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat area */}
      {!teamId ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 bg-white">
          <div className="text-center">
            <div className="text-5xl mb-4">💬</div>
            <p className="font-medium">选择一个团队开始协作</p>
            <p className="text-sm mt-2 text-gray-300">默认消息发给管理者，用 @Agent名 指定对话对象</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-gray-200 bg-white flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm">{team?.name}</span>
            <span className="text-xs text-gray-400">{team?.members.length}人</span>
            {managerAgent && (
              <span className="ml-2 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium border border-amber-200 flex items-center gap-1">
                <AvatarCircle name={managerAgent.name} size="sm" /> {managerAgent.name}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {busy && <button onClick={cancel} className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium">停止</button>}
              <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600">刷新</button>
            </div>
          </div>

          {/* Messages */}
          <div onScroll={onScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
            {msgs.length === 0 && !busy && streaming.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <p className="font-medium">协作群暂无消息</p>
                <p className="text-sm mt-1">
                  {managerAgent ? <>直接发送，默认与管理者 <b className="text-gray-600">@{managerAgent.name}</b> 对话</> : <>用 <b className="text-gray-600">@Agent名</b> 指定对话对象</>}
                </p>
              </div>
            )}
            {msgs.map(msg => (
              <div key={msg.id} className={`flex gap-2 ${msg.isUser ? 'flex-row-reverse' : ''} animate-fade-in`}>
                <AvatarCircle name={msg.isUser ? '我' : msg.agentName} avatar={msg.isUser ? undefined : msg.avatar} size="sm" />
                <div className={`max-w-[60%] px-4 py-3 rounded-2xl ${
                  msg.isUser ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white border border-gray-200 text-gray-700 rounded-bl-md shadow-sm'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold ${msg.isUser ? 'text-blue-100' : 'text-blue-600'}`}>{msg.agentName}</span>
                    <span className={`text-xs ${msg.isUser ? 'text-blue-200' : 'text-gray-400'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: msg.content.replace(/@(\S+)/g, '<span class="text-blue-600 font-medium bg-blue-50 px-0.5 rounded">@$1</span>') }} />
                </div>
              </div>
            ))}
            {streaming.map(s => (
              <div key={s.id} className="flex gap-2 animate-fade-in">
                <AvatarCircle name={s.agentName} avatar={s.avatar} size="sm" />
                <div className="max-w-[60%] px-4 py-3 bg-white border border-blue-200 rounded-2xl rounded-bl-md shadow-sm ring-1 ring-blue-100">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-blue-600">{s.agentName}</span>
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-xs text-gray-400">处理中...</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-gray-700">
                    {s.content || <span className="text-gray-300 italic">思考中...</span>}
                    {!s.done && <span className="inline-block w-1.5 h-4 bg-blue-500 ml-0.5 animate-pulse align-text-bottom" />}
                  </p>
                </div>
              </div>
            ))}
            {busy && streaming.length === 0 && (
              <div className="flex justify-start">
                <div className="px-4 py-3 bg-white border border-gray-200 rounded-2xl rounded-bl-md shadow-sm">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    {thinking.map(n => <span key={n} className="text-blue-600 text-xs font-medium">{n}</span>)}
                    <span>处理中...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-200 bg-white relative">
            {mentionSuggest && getMentionSuggestions().length > 0 && (
              <div className="absolute bottom-full left-4 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg p-1 z-20 animate-fade-in max-h-40 overflow-y-auto">
                {getMentionSuggestions().map(a => (
                  <button key={a.id} onClick={() => insertMention(a.name)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center text-white ${getAvatarColor(a.name)}`}>{a.avatar || a.name.charAt(0)}</span>
                    {a.name}{a.id === manager?.agentId && <span className="text-amber-500 text-xs ml-auto">管理者</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input ref={inputRef} type="text" value={input}
                onChange={handleInputChange}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !mentionSuggest) send(); }}
                placeholder={managerAgent ? `协作群 · 默认 @${managerAgent.name}` : '协作群 · 用 @Agent名 指定'}
                disabled={busy}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 disabled:bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
              <button onClick={send} disabled={!input.trim() || busy}
                className="px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-[0.98] transition-all">发送</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
