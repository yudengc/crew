import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/appStore';
import type { ChatMessage } from '../types';

interface StreamingMsg {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  timestamp: string;
  done: boolean;
}

// Parse @mentions from input text. Returns { targetAgents, cleanText }
function parseMentions(text: string, agents: { id: string; name: string }[]) {
  const mentionRegex = /@(\S+)/g;
  const mentioned = new Set<string>();
  let m;
  while ((m = mentionRegex.exec(text)) !== null) {
    const name = m[1];
    const agent = agents.find(a => a.name === name);
    if (agent) mentioned.add(agent.id);
  }
  const cleanText = text.replace(mentionRegex, '').trim();
  return { targetAgentIds: [...mentioned], cleanText: cleanText || text.trim() };
}

export default function TeamChat() {
  const { teams, agents, getChat, sendChatMessage, streamCallAi } = useAppStore();
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

  // Poll every 3s for new messages
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
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setThinking([]);
    setStreaming([]);
    toast.info('已停止生成');
  };

  // Detect @ for mention suggestions
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    const cursor = e.target.selectionStart ?? 0;
    const beforeCursor = val.slice(0, cursor);
    const atIdx = beforeCursor.lastIndexOf('@');
    setMentionSuggest(atIdx >= 0 && !beforeCursor.slice(atIdx).includes(' '));
  };

  // Insert mention
  const insertMention = (agentName: string) => {
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, cursor);
    const after = input.slice(cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx >= 0) {
      setInput(before.slice(0, atIdx) + '@' + agentName + ' ' + after);
    } else {
      setInput('@' + agentName + ' ' + input);
    }
    setMentionSuggest(false);
    inputRef.current?.focus();
  };

  const send = async () => {
    if (!input.trim() || !teamId || !team || sendLockRef.current) return;
    sendLockRef.current = true;

    // Parse @mentions to determine target agents
    const { targetAgentIds, cleanText } = parseMentions(input.trim(), agents);
    let targets = team.members.filter(m => {
      if (targetAgentIds.length > 0) return targetAgentIds.includes(m.agentId);
      // No @mention: send to manager only
      return m.isManager;
    });

    if (targets.length === 0 && targetAgentIds.length > 0) {
      toast.error('未找到匹配的 Agent，请检查 @名称');
      sendLockRef.current = false;
      return;
    }
    if (targets.length === 0 && !manager) {
      toast.error('该团队没有设置管理者，请用 @Agent名 指定对话对象');
      sendLockRef.current = false;
      return;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), teamId, agentId: 'user',
      agentName: '我', content: input, isUser: true,
      timestamp: new Date().toISOString(),
    };
    await sendChatMessage(teamId, 'user', '我', input, true, userMsg.id);
    setMsgs(prev => [...prev, userMsg]);
    setInput('');
    if (busy) { sendLockRef.current = false; return; }

    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;

    // Build conversation history with agent names for context
    const history = [...msgs, userMsg].slice(-10)
      .map(m => `${m.agentName}: ${m.content}`).join('\n');

    // Stream responses from target members
    const promises = targets.map(async m => {
      const agent = agents.find(a => a.id === m.agentId);
      if (!agent) return null;

      const streamId = crypto.randomUUID();
      setThinking(prev => [...prev, agent.name]);

      const streamMsg: StreamingMsg = {
        id: streamId, agentId: agent.id, agentName: agent.name,
        content: '', timestamp: new Date().toISOString(), done: false,
      };
      setStreaming(prev => [...prev, streamMsg]);

      try {
        const prompt = targetAgentIds.length > 0
          ? `你是「${agent.name}」，${agent.description || '团队成员'}。\n团队「${team.name}」对话记录：\n${history}\n\n用户直接 @了你，请针对性回复以下消息（不要回复其他未 @你的内容）：\n「${cleanText}」\n\n150字以内，直接回复，不要加名字前缀。`
          : `你是「${agent.name}」，${agent.description || '团队成员'}。你是该团队的管理者。\n团队「${team.name}」对话记录：\n${history}\n\n请以团队管理者身份回复，150字以内。直接回复，不要加名字前缀。`;

        const fullText = await streamCallAi(
          prompt,
          (chunk) => {
            if (controller.signal.aborted) return;
            setStreaming(prev => prev.map(s =>
              s.id === streamId ? { ...s, content: s.content + chunk } : s
            ));
          },
          agent.config,
        );

        if (controller.signal.aborted) return null;

        setStreaming(prev => prev.map(s =>
          s.id === streamId ? { ...s, done: true } : s
        ));

        if (fullText.trim()) {
          const am: ChatMessage = {
            id: crypto.randomUUID(), teamId, agentId: agent.id,
            agentName: agent.name, content: fullText, isUser: false,
            timestamp: new Date().toISOString(),
          };
          await sendChatMessage(teamId, agent.id, agent.name, fullText, false, am.id);
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
    const valid = results.filter(Boolean) as ChatMessage[];
    if (!controller.signal.aborted) {
      setMsgs(prev => [...prev, ...valid]);
    }
    setBusy(false);
    controllerRef.current = null;
    sendLockRef.current = false;
    setTimeout(scrollDown, 100);
  };

  // Get mention suggestions
  const getMentionSuggestions = () => {
    if (!mentionSuggest) return [];
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return [];
    const partial = before.slice(atIdx + 1).toLowerCase();
    return teamAgents.filter(a =>
      !partial || a.name.toLowerCase().includes(partial)
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-1px)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        <select value={teamId} onChange={e => setTeamId(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white text-sm">
          <option value="">选择团队</option>
          {teams.map(t => {
            const m = t.members.find(mb => mb.isManager);
            const ma = m ? agents.find(a => a.id === m.agentId) : null;
            return (
              <option key={t.id} value={t.id}>
                {t.name} ({t.members.length}人{ma ? ` · 管理: ${ma.name}` : ''})
              </option>
            );
          })}
        </select>
        {team && (
          <div className="flex items-center gap-1.5 text-xs">
            {managerAgent && (
              <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-lg font-medium border border-amber-200">
                👑 {managerAgent.name} (管理者)
              </span>
            )}
            {team.members.filter(m => !m.isManager).map(m => {
              const a = agents.find(x => x.id === m.agentId);
              return a ? <span key={a.id} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-lg">{a.name}</span> : null;
            })}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {busy && (
            <button onClick={cancel}
              className="text-xs px-3 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium transition-colors">
              停止
            </button>
          )}
          {teamId && <button onClick={load} className="text-sm text-gray-400 hover:text-gray-600">刷新</button>}
        </div>
      </div>

      {/* No team */}
      {!teamId ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <div className="text-5xl mb-4">💬</div>
            <p className="font-medium">请选择一个团队</p>
            <p className="text-sm mt-2 text-gray-300">
              用 <code className="px-1 bg-gray-100 rounded">@Agent名</code> 指定对话对象，不加 @ 则与管理者对话
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div onScroll={onScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
            {msgs.length === 0 && !busy && streaming.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <p className="font-medium">还没有消息</p>
                <p className="text-sm mt-1">
                  {managerAgent
                    ? <>默认向管理者 <b className="text-gray-600">@{managerAgent.name}</b> 发送，或用 @指定其他 Agent</>
                    : <>请用 <b className="text-gray-600">@Agent名</b> 指定对话对象</>
                  }
                </p>
              </div>
            )}

            {msgs.map(msg => (
              <div key={msg.id} className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                <div className={`max-w-[65%] px-4 py-3 rounded-2xl ${
                  msg.isUser
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-white border border-gray-200 text-gray-700 rounded-bl-md shadow-sm'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold ${msg.isUser ? 'text-blue-100' : 'text-blue-600'}`}>
                      {msg.agentName}
                    </span>
                    <span className={`text-xs ${msg.isUser ? 'text-blue-200' : 'text-gray-400'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {/* Highlight @mentions in message text */}
                  <p className="text-sm whitespace-pre-wrap leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: msg.content.replace(/@(\S+)/g,
                        '<span class="text-blue-600 font-medium bg-blue-50 px-0.5 rounded">@$1</span>')
                    }} />
                </div>
              </div>
            ))}

            {/* Streaming messages */}
            {streaming.map(s => (
              <div key={s.id} className="flex justify-start animate-fade-in">
                <div className="max-w-[65%] px-4 py-3 bg-white border border-blue-200 rounded-2xl rounded-bl-md shadow-sm ring-1 ring-blue-100">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-blue-600">{s.agentName}</span>
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-xs text-gray-400">输入中...</span>
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
                    {thinking.map(n => (
                      <span key={n} className="text-blue-600 text-xs font-medium">{n}</span>
                    ))}
                    <span>思考中...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-200 bg-white relative">
            {/* Mention suggestion dropdown */}
            {mentionSuggest && getMentionSuggestions().length > 0 && (
              <div className="absolute bottom-full left-4 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg p-1 z-20 animate-fade-in max-h-40 overflow-y-auto">
                {getMentionSuggestions().map(a => (
                  <button key={a.id} onClick={() => insertMention(a.name)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 flex items-center gap-2">
                    {a.id === manager?.agentId && <span className="text-amber-500">👑</span>}
                    <span>{a.name}</span>
                    <span className="text-xs text-gray-400 ml-auto">{a.id === manager?.agentId ? '管理者' : a.capabilities?.[0]}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input ref={inputRef}
                type="text" value={input}
                onChange={handleInputChange}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !mentionSuggest) send();
                }}
                placeholder={managerAgent
                  ? `输入消息...  @Agent名 指定对话，或直接发送给 ${managerAgent.name}`
                  : '输入消息...  用 @Agent名 指定对话对象'}
                disabled={busy}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 disabled:bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              <button
                onClick={send}
                disabled={!input.trim() || busy}
                className="px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
              >
                发送
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
