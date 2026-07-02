import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/appStore';
import type { Agent, ChatMessage, ChatSession } from '../types';

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
  const { teams, agents, sendChatMessage, streamCallAi, saveWorkspaceMessage, getSessions, createSession, getSessionMessages, deleteSession, renameSession } = useAppStore();
  const [teamId, setTeamId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState<string[]>([]);
  const [streaming, setStreaming] = useState<StreamingMsg[]>([]);
  const [editingSession, setEditingSession] = useState('');
  const [editName, setEditName] = useState('');
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

  // Load sessions when team changes
  useEffect(() => {
    if (!teamId) { setSessions([]); setSessionId(''); setMsgs([]); return; }
    getSessions(teamId).then(s => {
      setSessions(s);
      if (s.length > 0 && s[0].id !== sessionId) {
        setSessionId(s[0].id);
      }
    }).catch(() => {});
  }, [teamId]);

  // Load messages when session changes
  useEffect(() => { if (sessionId) loadSession(); }, [sessionId]);

  // Poll for new messages
  useEffect(() => {
    if (!sessionId) return;
    const id = setInterval(() => {
      getSessionMessages(sessionId).then(latest => {
        setMsgs(prev => {
          const ids = new Set(prev.map(m => m.id));
          const fresh = latest.filter(m => !ids.has(m.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      }).catch(err => { console.error('Chat poll error:', err); });
    }, 3000);
    return () => clearInterval(id);
  }, [sessionId]);

  const loadSession = async () => {
    const ms = await getSessionMessages(sessionId);
    setMsgs(ms);
  };

  const newSession = async () => {
    if (!teamId) return;
    const name = `会话 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    const s = await createSession(teamId, name);
    if (s) {
      setSessions(prev => [...prev, s]);
      setSessionId(s.id);
    }
  };

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
    if (!input.trim() || !teamId || !team || sendLockRef.current || busy) return;
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
      id: crypto.randomUUID(), teamId, sessionId, agentId: 'user',
      agentName: '我', content: input, isUser: true, timestamp: new Date().toISOString(),
    };
    await sendChatMessage(teamId, 'user', '我', input, true, userMsg.id, undefined, sessionId);
    setMsgs(prev => [...prev, userMsg]); setInput('');

    setBusy(true);
    const controller = new AbortController(); controllerRef.current = controller;
    const history = [...msgs, userMsg].slice(-8).map(m => `${m.agentName}: ${m.content}`).join('\n');

    // Only manager gets AI response in chat; other agents route to workspace
    const promises = targets.map(async m => {
      const agent = agents.find(a => a.id === m.agentId);
      if (!agent) return null;

      // Non-manager agents being @mentioned → assess then act
      if (!m.isManager && targetAgentIds.length > 0) {
        const streamId = crypto.randomUUID();
        setThinking(prev => [...prev, agent.name]);
        const streamMsg: StreamingMsg = {
          id: streamId, agentId: agent.id, agentName: agent.name,
          avatar: agent.avatar, content: '', timestamp: new Date().toISOString(), done: false,
        };
        setStreaming(prev => [...prev, streamMsg]);

        try {
          // Quick assessment: agent decides if this is simple or needs workspace
          const assessmentPrompt = `你是「${agent.name}」，${agent.description || ''}。\n\n协作群中 @了你：「${cleanText || input}」\n\n判断：\n- 如果这是简单问题（如报数、问候、简单确认），直接简短回答（最多30字）\n- 如果需要深入分析或执行操作，说\"需要处理，预计X分钟\"并简要说明你要做什么\n\n只输出回复本身，不要加前缀。`;
          const assessment = await streamCallAi(
            assessmentPrompt,
            (chunk) => {
              if (controller.signal.aborted) return;
              setStreaming(prev => prev.map(s => s.id === streamId ? { ...s, content: s.content + chunk } : s));
            },
            { ...agent.config, max_tokens: 100 },
          );
          if (controller.signal.aborted) return null;
          setStreaming(prev => prev.map(s => s.id === streamId ? { ...s, done: true } : s));

          if (assessment.trim()) {
            const am: ChatMessage = {
              id: crypto.randomUUID(), teamId, agentId: agent.id,
              agentName: agent.name, avatar: agent.avatar,
              content: assessment, isUser: false, timestamp: new Date().toISOString(),
            };
            await sendChatMessage(teamId, agent.id, agent.name, assessment, false, am.id, agent.avatar);

            // If the response indicates it needs work (contains keywords like "需要", "预计", "分析", "处理"),
            // also trigger workspace execution
            const needsWorkspace = /需要|预计|分析|处理|执行|查找|检查|实现|编写|设计/.test(assessment);
            if (needsWorkspace) {
              const taskText = cleanText || input;
              saveWorkspaceMessage(agent.id, teamId, 'user', taskText, sessionId, sessions.find(s => s.id === sessionId)?.name || '').catch(() => {});
              const { bridgeSend } = await import('../utils/bridge');
              bridgeSend('runAgentInWorkspace', JSON.stringify({
                agentId: agent.id, teamId, task: taskText, context: history, sessionId, sessionName: sessions.find(s => s.id === sessionId)?.name || ''
              })).then(async (result: unknown) => {
                const data = result as Record<string, unknown> | null;
                if (data?.result) {
                  await saveWorkspaceMessage(agent.id, teamId, 'assistant', String(data.result)).catch(() => {});
                  const summary = String(data.result).length > 200
                    ? String(data.result).slice(0, 200) + '...'
                    : String(data.result);
                  const report: ChatMessage = {
                    id: crypto.randomUUID(), teamId, agentId: agent.id,
                    agentName: agent.name, avatar: agent.avatar,
                    content: `📋 执行完成：\n${summary}${String(data.result).length > 200 ? '\n（详见工作区）' : ''}`,
                    isUser: false, timestamp: new Date().toISOString(),
                  };
                  await sendChatMessage(teamId, agent.id, agent.name, report.content, false, report.id, agent.avatar);
                  setMsgs(prev => [...prev, report]);
                }
              }).catch(() => {});
            }
            return am;
          }
          return null;
        } catch (err) { if (controller.signal.aborted) return null; toast.error(`代理回复失败`);
          if (controller.signal.aborted) return null;
          return null;
        } finally {
          setThinking(prev => prev.filter(n => n !== agent.name));
          setStreaming(prev => prev.filter(s => s.id !== streamId));
        }
      }

      // Manager: think in workspace, only summary in chat
      setThinking(prev => [...prev, agent.name]);

      // Save task to workspace
      const taskText = cleanText || input;
      saveWorkspaceMessage(agent.id, teamId, 'user',
        `[协作群任务]\n${taskText}`, sessionId,
        sessions.find(s => s.id === sessionId)?.name || '').catch(() => {});

      // Run agent loop in workspace (not streaming to chat)
      const { bridgeSend } = await import('../utils/bridge');
      const wsPromise = bridgeSend('runAgentInWorkspace', JSON.stringify({
        agentId: agent.id, teamId, task: taskText, context: history, sessionId, sessionName: sessions.find(s => s.id === sessionId)?.name || ''
      }));

      // Show brief thinking indicator in chat
      const streamId = crypto.randomUUID();
      const streamMsg: StreamingMsg = {
        id: streamId, agentId: agent.id, agentName: agent.name,
        avatar: agent.avatar, content: '正在思考...', timestamp: new Date().toISOString(), done: false,
      };
      setStreaming(prev => [...prev, streamMsg]);

      try {
        const result = await wsPromise as Record<string, unknown> | null;
        if (controller.signal.aborted) { setThinking(prev => prev.filter(n => n !== agent.name)); setStreaming(prev => prev.filter(s => s.id !== streamId)); return null; }

        setStreaming(prev => prev.map(s => s.id === streamId ? { ...s, done: true } : s));

        if (result?.result) {
          await saveWorkspaceMessage(agent.id, teamId, 'assistant',
            String(result.result), sessionId,
            sessions.find(s => s.id === sessionId)?.name || '').catch(() => {});

          // Post brief summary to chat (not the full thinking)
          const fullText = String(result.result);
          const summary = m.isManager
            ? (fullText.length > 200 ? fullText.slice(0, 200) + '...（详见工作区）' : fullText)
            : (fullText.length > 150 ? fullText.slice(0, 150) + '...' : fullText);

          const am: ChatMessage = {
            id: crypto.randomUUID(), teamId, agentId: agent.id,
            agentName: agent.name, avatar: agent.avatar,
            content: summary, isUser: false, timestamp: new Date().toISOString(),
          };
          await sendChatMessage(teamId, agent.id, agent.name, summary, false, am.id, agent.avatar, sessionId);
          return am;
        }
        return null;
      } catch (err) { if (controller.signal.aborted) return null; toast.error(`代理回复失败`);
        if (controller.signal.aborted) return null;
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
          const isMgr = team.members.find(m => m.agentId === agent.id)?.isManager;
          const taskMsg = `[${isMgr ? '管理者' : ''} ${agent.name} @了你]\n${instruction || msg.content}`;
          saveWorkspaceMessage(aid, teamId, 'user', taskMsg, sessionId, sessions.find(s => s.id === sessionId)?.name || '').catch(() => {});

          // Agent acknowledges briefly in chat
          setThinking(prev => [...prev, target.name]);
          const ackMsg: ChatMessage = {
            id: crypto.randomUUID(), teamId, agentId: target.id,
            agentName: target.name, avatar: target.avatar,
            content: `收到，我来处理。`,
            isUser: false, timestamp: new Date().toISOString(),
          };
          await sendChatMessage(teamId, target.id, target.name, ackMsg.content, false, ackMsg.id, target.avatar, sessionId);
          setMsgs(prev => [...prev, ackMsg]);
          setThinking(prev => prev.filter(n => n !== target.name));

          // Agent works in private workspace using ReAct loop (code-driven, not prompt-driven)
          const { bridgeSend } = await import('../utils/bridge');
          bridgeSend('runAgentInWorkspace', JSON.stringify({
            agentId: target.id, teamId,
            task: instruction || msg.content,
            context: history, sessionId, sessionName: sessions.find(s => s.id === sessionId)?.name || ''
          })).then(async (result: unknown) => {
            const data = result as Record<string, unknown> | null;
            if (data?.result) {
              // Save thinking to workspace
              await saveWorkspaceMessage(aid, teamId, 'assistant', String(data.result), sessionId, sessions.find(s => s.id === sessionId)?.name || '').catch(() => {});
              // Post execution summary to team chat
              const summary = String(data.result).length > 200
                ? String(data.result).slice(0, 200) + '...（详见工作区）'
                : String(data.result);
              const report: ChatMessage = {
                id: crypto.randomUUID(), teamId, agentId: target.id,
                agentName: target.name, avatar: target.avatar,
                content: `📋 执行完成：\n${summary}`,
                isUser: false, timestamp: new Date().toISOString(),
              };
              await sendChatMessage(teamId, target.id, target.name, report.content, false, report.id, target.avatar);
              setMsgs(prev => [...prev, report]);
            }
          }).catch(() => {});
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
      {/* Team + Sessions sidebar */}
      <div className="w-56 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="p-3 border-b border-gray-200 bg-white">
          <h3 className="text-sm font-semibold text-gray-700">协作群</h3>
          <p className="text-xs text-gray-400 mt-0.5">{teams.length} 个团队</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {teams.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">暂无团队</p>
          )}
          {teams.map(t => {
            const active = t.id === teamId;
            return (
              <div key={t.id}>
                <button onClick={() => setTeamId(t.id)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                    active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                  }`}>
                  💬 {t.name}
                  <span className="text-[11px] text-gray-400 ml-1">{t.members.length}人</span>
                </button>
                {active && (
                  <div className="ml-3 mt-0.5 space-y-0.5">
                    {sessions.map(s => (
                      <div key={s.id} className={`flex items-center group rounded-lg text-xs ${
                        s.id === sessionId ? 'bg-blue-100' : 'hover:bg-gray-100'
                      }`}>
                        {editingSession === s.id ? (
                          <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                            onKeyDown={async e => {
                              if (e.key === 'Enter') { await renameSession(s.id, editName); setSessions(prev => prev.map(x => x.id === s.id ? { ...x, name: editName } : x)); setEditingSession(''); }
                              if (e.key === 'Escape') setEditingSession('');
                            }}
                            onBlur={() => setEditingSession('')}
                            className="flex-1 px-2 py-1.5 bg-white border border-blue-300 rounded outline-none text-xs"
                            onClick={e => e.stopPropagation()} />
                        ) : (
                          <button onClick={() => setSessionId(s.id)}
                            className={`flex-1 text-left px-3 py-1.5 ${s.id === sessionId ? 'text-blue-700 font-medium' : 'text-gray-500'}`}>
                            # {s.name}
                          </button>
                        )}
                        <div className="flex items-center mr-1">
                          <button onClick={() => { setEditingSession(s.id); setEditName(s.name); }}
                            className="p-1 text-gray-300 hover:text-blue-500" title="重命名">✎</button>
                          <button onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm('删除此会话？')) {
                              await deleteSession(s.id);
                              setSessions(prev => prev.filter(x => x.id !== s.id));
                              if (sessionId === s.id) { const remaining = sessions.filter(x => x.id !== s.id); setSessionId(remaining[0]?.id || ''); }
                            }
                          }} className="p-1 text-gray-300 hover:text-red-500" title="删除">×</button>
                        </div>
                      </div>
                    ))}
                    <button onClick={newSession}
                      className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all">
                      ＋ 新会话
                    </button>
                  </div>
                )}
              </div>
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
              <button onClick={loadSession} className="text-xs text-gray-400 hover:text-gray-600">刷新</button>
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
