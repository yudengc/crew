import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import type { ChatMessage } from '../types';

export default function TeamChat() {
  const { teams, agents, getChat, sendChatMessage, callAi } = useAppStore();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isAiResponding, setIsAiResponding] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedTeam = teams.find(t => t.id === selectedTeamId);
  const teamAgents = selectedTeam?.members
    .map(m => agents.find(a => a.id === m.agentId))
    .filter(Boolean) || [];

  useEffect(() => {
    if (selectedTeamId) {
      loadChat();
    }
  }, [selectedTeamId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadChat = async () => {
    if (!selectedTeamId) return;
    const chat = await getChat(selectedTeamId);
    setMessages(chat);
  };

  const handleSendUserMessage = async () => {
    if (!inputMessage.trim() || !selectedTeamId) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      teamId: selectedTeamId,
      agentId: 'user',
      agentName: '项目经理',
      content: inputMessage,
      isUser: true,
      timestamp: new Date().toISOString(),
    };

    await sendChatMessage(selectedTeamId, 'user', '项目经理', inputMessage, true);
    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');

    // Notify all agents in the team
    await notifyAgents(selectedTeamId, `【项目经理】介入：${inputMessage}`);
  };

  const notifyAgents = async (teamId: string, message: string) => {
    if (!selectedTeam) return;

    setIsAiResponding(true);

    const responses: ChatMessage[] = [];

    for (const member of selectedTeam.members) {
      const agent = agents.find(a => a.id === member.agentId);
      if (!agent) continue;

      try {
        const prompt = `你是团队协作群的成员，团队名称：${selectedTeam.name}。

当前场景：项目经理介入发言：「${message}」

请以 ${agent.name} 的身份回应这个介入。你可以：
1. 确认理解并执行
2. 提出问题或建议
3. 汇报当前进展

保持简洁，50字以内。`;

        const response = await callAi(prompt, agent.config);

        const agentMsg: ChatMessage = {
          id: crypto.randomUUID(),
          teamId,
          agentId: agent.id,
          agentName: agent.name,
          content: response,
          isUser: false,
          timestamp: new Date().toISOString(),
        };

        await sendChatMessage(teamId, agent.id, agent.name, response, false);
        responses.push(agentMsg);
      } catch (error) {
        console.error(`Error getting response from ${agent.name}:`, error);
      }
    }

    setMessages(prev => [...prev, ...responses]);
    setIsAiResponding(false);
  };

  if (teams.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-xl mb-2">还没有团队</p>
        <p>先创建团队才能使用协作群功能</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-white">团队协作群</h2>
      </div>

      <div className="flex gap-4 mb-4">
        <select
          value={selectedTeamId || ''}
          onChange={(e) => setSelectedTeamId(e.target.value || null)}
          className="px-4 py-2 bg-[#2d2d2d] border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">选择团队</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name} ({team.members.length} 人)
            </option>
          ))}
        </select>

        {selectedTeam && (
          <div className="flex items-center gap-2 text-gray-400">
            <span>成员：</span>
            {teamAgents.map(agent => agent && (
              <span key={agent.id} className="px-2 py-1 bg-[#1e1e1e] rounded text-sm">
                {agent.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {selectedTeamId ? (
        <>
          <div className="flex-1 bg-[#252526] rounded-lg border border-gray-700 p-4 overflow-y-auto mb-4" style={{ minHeight: '400px' }}>
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <p>协作群还没有消息</p>
                  <p className="text-sm mt-2">发送消息或执行任务来开始对话</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] p-3 rounded-lg ${
                        msg.isUser
                          ? 'bg-blue-600 text-white'
                          : 'bg-[#1e1e1e] text-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-semibold ${msg.isUser ? 'text-blue-200' : 'text-gray-400'}`}>
                          {msg.agentName}
                        </span>
                        <span className="text-xs opacity-60">
                          {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))
              )}
              {isAiResponding && (
                <div className="flex justify-start">
                  <div className="bg-[#1e1e1e] text-gray-400 p-3 rounded-lg">
                    <span className="animate-pulse">Agent 正在思考...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendUserMessage()}
              placeholder="输入消息介入协作..."
              className="flex-1 px-4 py-2 bg-[#2d2d2d] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSendUserMessage}
              disabled={!inputMessage.trim() || isAiResponding}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              发言
            </button>
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <p>请选择要进入的团队协作群</p>
        </div>
      )}
    </div>
  );
}