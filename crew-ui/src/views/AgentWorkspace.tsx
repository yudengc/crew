import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/appStore';
import type { AgentWorkspace as WS } from '../types';

const AGENT_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500',
];
function agentColor(name: string) {
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AGENT_COLORS[Math.abs(h) % AGENT_COLORS.length];
}

export default function AgentWorkspaceView() {
  const { teams, agents, getWorkspace, saveWorkspaceMessage, streamCallAi } = useAppStore();
  const [selected, setSelected] = useState<{ agentId: string; teamId: string; agentName: string } | null>(null);
  const [wsSessionId, setWsSessionId] = useState('__all__');
  const [ws, setWs] = useState<WS | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const loadWorkspace = async (agentId: string, teamId: string, sessionId?: string) => {
    const data = await getWorkspace(agentId, teamId, sessionId);
    setWs(data);
  };

  const openAgent = (agentId: string, teamId: string, agentName: string) => {
    setSelected({ agentId, teamId, agentName });
    setWsSessionId('__all__');
    setStreaming('');
    loadWorkspace(agentId, teamId, undefined);
  };

  useEffect(() => { bottomRef.current?.scrollIntoView(); }, [ws?.messages, streaming]);

  const send = async () => {
    if (!input.trim() || !selected || busy) return;
    const { agentId, teamId } = selected;
    await saveWorkspaceMessage(agentId, teamId, 'user', input);
    setWs(prev => prev ? { ...prev, messages: [...prev.messages, { role: 'user', content: input, timestamp: new Date().toISOString() }] } : prev);
    setInput('');
    setBusy(true);
    setStreaming('');

    const agent = agents.find(a => a.id === agentId);
    if (!agent) { setBusy(false); return; }

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const history = (ws?.messages ?? []).slice(-10)
        .map(m => `${m.role === 'user' ? '任务' : '思考'}: ${m.content}`).join('\n');

      const team = teams.find(t => t.id === selected.teamId);
      const teamMembers = team ? agents.filter(a => team.members.some(m => m.agentId === a.id)) : [];
      const memberList = teamMembers.length > 0
        ? teamMembers.map(tm => {
            const tmData = team?.members.find(m => m.agentId === tm.id);
            return `- ${tmData?.isManager ? '👑' : ''} ${tm.name}: ${tm.capabilities?.join(', ') || tm.description}`;
          }).join('\n')
        : '';

      const prompt = `你是「${agent.name}」，${agent.description || 'AI 助手'}。\n\n${memberList ? `团队成员（可以用 @成员名 呼叫做）：\n${memberList}\n\n` : ''}这是你的私有思考空间。以下是历史记录：\n${history}\n\n当前任务：「${input}」\n\n请深入思考并执行。你可以使用工具（read_file, write_file, list_files, execute_command, web_search）。如需其他成员协助，在回复中 @他们。完成后给出详细的结果。`;

      const fullText = await streamCallAi(
        prompt,
        (chunk) => { if (!controller.signal.aborted) setStreaming(prev => prev + chunk); },
        agent.config,
      );

      if (!controller.signal.aborted && fullText.trim()) {
        await saveWorkspaceMessage(agentId, teamId, 'assistant', fullText);
        setWs(prev => prev ? { ...prev, messages: [...prev.messages, { role: 'assistant', content: fullText, timestamp: new Date().toISOString() }] } : prev);
        setStreaming('');
        toast.success(`${agent.name} 思考完成`);
      }
    } catch (err) {
      if (!controller.signal.aborted) toast.error('思考中断');
    } finally {
      setBusy(false);
      controllerRef.current = null;
    }
  };

  const cancel = () => {
    controllerRef.current?.abort();
    setBusy(false);
    setStreaming('');
  };

  return (
    <div className="flex h-[calc(100vh-1px)]">
      {/* Agent list sidebar */}
      <div className="w-60 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="p-3 border-b border-gray-200 bg-white">
          <h3 className="text-sm font-semibold text-gray-700">Agent 工作区</h3>
          <p className="text-xs text-gray-400 mt-0.5">私有思考空间</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {teams.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">暂无团队</p>
          )}
          {teams.map(team => {
            const teamAgents = agents.filter(a => team.members.some(m => m.agentId === a.id));
            return (
              <div key={team.id}>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-2 py-1.5">{team.name}</div>
                {teamAgents.map(a => {
                  const active = selected?.agentId === a.id && selected?.teamId === team.id;
                  return (
                    <button key={a.id}
                      onClick={() => openAgent(a.id, team.id, a.name)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-all ${
                        active ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'text-gray-600 hover:bg-gray-100'
                      }`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${agentColor(a.name)}`}>
                        {a.avatar || a.name.charAt(0)}
                      </span>
                      {a.name}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Workspace */}
      {!selected ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center"><div className="text-5xl mb-4">🧠</div><p>选择一个 Agent 查看其工作区</p></div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${agentColor(selected.agentName)}`}>
              {selected.agentName.charAt(0)}
            </span>
            <span className="font-semibold text-gray-900 text-sm">{selected.agentName}</span>
            <select value={wsSessionId} onChange={e => { const v=e.target.value; setWsSessionId(v); loadWorkspace(selected.agentId, selected.teamId, v==='__all__'?undefined:v); }}
              className="ml-2 px-2 py-0.5 border border-gray-200 rounded-lg text-xs text-gray-500 outline-none bg-white">
              <option value="__all__">所有会话</option>
              {[...new Set(ws?.messages.filter(m=>m.sessionId).map(m=>m.sessionId+'|'+(m.sessionName||'')))].map(s=>{
                const [sid,sn]=s.split('|'); return <option key={sid} value={sid}>{sn||sid?.slice(0,8)}</option>;
              })}
            </select>
            <span className="text-xs text-gray-400 ml-auto">私有</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {(!ws || ws.messages.length === 0) && !streaming && (
              <div className="text-center py-16 text-gray-400">
                <p className="text-sm">这是 {selected.agentName} 的私有思考空间</p>
                <p className="text-xs mt-1 text-gray-300">在此给 Agent 分配任务，它会深度思考并展示过程</p>
              </div>
            )}
            {ws?.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] px-4 py-3 rounded-2xl ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : m.role === 'system'
                    ? 'bg-gray-100 text-gray-500 text-xs italic'
                    : 'bg-white border border-gray-200 text-gray-700 rounded-bl-md shadow-sm'
                }`}>
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-[10px] font-semibold opacity-60">
                      {m.role === 'user' ? '任务' : m.role === 'assistant' ? selected.agentName : '系统'}
                    </span>
                    {m.sessionName && (
                      <span className="text-[9px] px-1 py-0.5 bg-blue-50 text-blue-600 rounded">📋 {m.sessionName}</span>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                </div>
              </div>
            ))}
            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[70%] px-4 py-3 bg-white border border-blue-200 rounded-2xl rounded-bl-md shadow-sm ring-1 ring-blue-100">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-blue-600">{selected.agentName}</span>
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-xs text-gray-400">深度思考中...</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-gray-700">
                    {streaming}
                    <span className="inline-block w-1.5 h-4 bg-blue-500 ml-0.5 animate-pulse align-text-bottom" />
                  </p>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="p-4 border-t border-gray-200 bg-white">
            <div className="flex gap-2">
              <input type="text" value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder={`给 ${selected.agentName} 分配任务...`}
                disabled={busy}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 disabled:bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm" />
              {busy ? (
                <button onClick={cancel} className="px-6 py-2.5 bg-red-50 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100">停止</button>
              ) : (
                <button onClick={send} disabled={!input.trim()}
                  className="px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 hover:bg-blue-700 shadow-sm">发送</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
