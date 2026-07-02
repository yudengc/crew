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

export default function TeamChat() {
  const { teams, agents, getChat, sendChatMessage, streamCallAi } = useAppStore();
  const [teamId, setTeamId] = useState('');
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState<string[]>([]);
  const [streaming, setStreaming] = useState<StreamingMsg[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const sendLockRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  const team = teams.find(t => t.id === teamId);

  useEffect(() => { if (teamId) load(); }, [teamId]);

  // Poll every 3s for new messages (others' messages in shared chat)
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

  const send = async () => {
    if (!input.trim() || !teamId || !team || sendLockRef.current) return;
    sendLockRef.current = true;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), teamId, agentId: 'user',
      agentName: '我', content: input, isUser: true,
      timestamp: new Date().toISOString(),
    };
    await sendChatMessage(teamId, 'user', '我', input, true, userMsg.id);
    setMsgs(prev => [...prev, userMsg]);
    setInput('');
    if (busy) return;

    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;

    const history = [...msgs, userMsg].slice(-10)
      .map(m => `${m.agentName}: ${m.content}`).join('\n');

    // Stream responses from all team members in parallel
    const promises = team.members.map(async m => {
      const agent = agents.find(a => a.id === m.agentId);
      if (!agent) return null;

      const streamId = crypto.randomUUID();
      setThinking(prev => [...prev, agent.name]);

      // Create streaming placeholder
      const streamMsg: StreamingMsg = {
        id: streamId, agentId: agent.id, agentName: agent.name,
        content: '', timestamp: new Date().toISOString(), done: false,
      };
      setStreaming(prev => [...prev, streamMsg]);

      try {
        const prompt = `你是「${agent.name}」，${agent.description || '团队成员'}。\n团队「${team.name}」对话记录：\n${history}\n\n请以团队成员身份自然回应，150字以内。直接回复，不要加名字前缀。`;

        const fullText = await streamCallAi(
          prompt,
          // onChunk — update streaming message in real-time
          (chunk) => {
            if (controller.signal.aborted) return;
            setStreaming(prev => prev.map(s =>
              s.id === streamId ? { ...s, content: s.content + chunk } : s
            ));
          },
          agent.config,
        );

        if (controller.signal.aborted) return null;

        // Mark streaming done & save
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

  return (
    <div className="flex flex-col h-[calc(100vh-1px)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        <select value={teamId} onChange={e => setTeamId(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white text-sm">
          <option value="">选择团队</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.members.length}人)</option>)}
        </select>
        {team && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {team.members.map(m => {
              const a = agents.find(x => x.id === m.agentId);
              return a ? <span key={a.id} className="px-2 py-0.5 bg-gray-100 rounded-lg">{a.name}</span> : null;
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

      {/* Empty state */}
      {!teamId ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <div className="text-5xl mb-4">💬</div>
            <p className="font-medium">请选择一个团队</p>
          </div>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div onScroll={onScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
            {msgs.length === 0 && !busy && streaming.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <p className="font-medium">还没有消息</p>
                <p className="text-sm mt-1">发送第一条消息</p>
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
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ))}

            {/* Streaming messages — live partial content */}
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

            {/* Global thinking indicator (before streaming starts) */}
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
          <div className="p-4 border-t border-gray-200 bg-white">
            <div className="flex gap-2">
              <input
                type="text" value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="输入消息... (Enter 发送)"
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
