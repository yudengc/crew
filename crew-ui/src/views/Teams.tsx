import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import type { Team } from '../types';

export default function Teams() {
  const { teams, agents, saveTeam, deleteTeam, addMemberToTeam, removeMemberFromTeam } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [showAddMember, setShowAddMember] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newTeamName.trim()) return;
    const team: Team = {
      id: crypto.randomUUID(),
      name: newTeamName,
      members: selectedAgents.map(agentId => ({ agentId, role: 'member', isManager: false })),
      createdAt: new Date().toISOString(),
    };
    await saveTeam(team);
    setNewTeamName('');
    setSelectedAgents([]);
    setShowCreate(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定删除这个团队吗？')) {
      await deleteTeam(id);
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents(prev =>
      prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    );
  };

  const handleAddMember = async (teamId: string, agentId: string) => {
    await addMemberToTeam(teamId, agentId);
    setShowAddMember(null);
  };

  const handleRemoveMember = async (teamId: string, agentId: string) => {
    if (confirm('确定移除这个成员吗？')) {
      await removeMemberFromTeam(teamId, agentId);
    }
  };

  const availableAgents = (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    const memberAgentIds = team?.members.map(m => m.agentId) || [];
    return agents.filter(a => !memberAgentIds.includes(a.id));
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">我的团队</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          + 新建团队
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-4 bg-[#252526] rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">创建新团队</h3>
          <input
            type="text"
            placeholder="团队名称"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            className="w-full px-4 py-2 mb-4 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <div className="mb-4">
            <p className="text-gray-400 mb-2">选择初始成员：</p>
            <div className="flex flex-wrap gap-2">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedAgents.includes(agent.id)
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#1e1e1e] text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {agent.name}
                </button>
              ))}
            </div>
            {agents.length === 0 && (
              <p className="text-gray-500 text-sm mt-2">还没有 Agent，先去市场购买或创建</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newTeamName.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              创建
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-gray-400 hover:text-white"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {teams.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-xl mb-2">还没有团队</p>
          <p>去市场购买 Agent，然后组建你的第一个团队</p>
        </div>
      ) : (
        <div className="space-y-4">
          {teams.map((team) => (
            <div key={team.id} className="p-4 bg-[#252526] rounded-lg border border-gray-700">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{team.name}</h3>
                  <span className="text-gray-500 text-sm">{team.members.length} 名成员</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddMember(team.id)}
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                  >
                    添加成员
                  </button>
                  <button
                    onClick={() => handleDelete(team.id)}
                    className="px-3 py-1 text-gray-500 hover:text-red-400 text-sm"
                  >
                    删除
                  </button>
                </div>
              </div>

              {showAddMember === team.id && (
                <div className="mb-3 p-3 bg-[#1e1e1e] rounded border border-gray-600">
                  <p className="text-gray-400 text-sm mb-2">选择要添加的 Agent：</p>
                  <div className="flex flex-wrap gap-2">
                    {availableAgents(team.id).map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => handleAddMember(team.id, agent.id)}
                        className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        + {agent.name}
                      </button>
                    ))}
                    {availableAgents(team.id).length === 0 && (
                      <span className="text-gray-500 text-sm">所有 Agent 都已加入</span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowAddMember(null)}
                    className="mt-2 text-gray-500 hover:text-white text-sm"
                  >
                    取消
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {team.members.map((member) => {
                  const agent = agents.find(a => a.id === member.agentId);
                  return agent ? (
                    <div key={member.agentId} className="flex items-center gap-2 px-3 py-2 bg-[#1e1e1e] rounded">
                      <div>
                        <span className="text-gray-200 text-sm">{agent.name}</span>
                        <span className="text-gray-500 text-xs ml-2">
                          {member.isManager ? '管理员' : '成员'}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveMember(team.id, member.agentId)}
                        className="text-gray-500 hover:text-red-400 text-xs"
                      >
                        移除
                      </button>
                    </div>
                  ) : null;
                })}
              </div>
              {team.members.length === 0 && (
                <p className="text-gray-500 text-sm">暂无成员</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}