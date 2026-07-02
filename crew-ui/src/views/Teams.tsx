import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/appStore';
import { useConfirm } from '../components/ConfirmDialog';
import type { Team } from '../types';

export default function Teams() {
  const { teams, agents, saveTeam, deleteTeam, addMemberToTeam, removeMemberFromTeam } = useAppStore();
  const { confirm, dialog } = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!name.trim()) { toast.error('请输入团队名称'); return; }
    setCreating(true);
    const team: Team = {
      id: crypto.randomUUID(), name: name.trim(),
      members: selected.map(id => ({ agentId: id, role: 'member', isManager: false })),
      createdAt: new Date().toISOString(),
    };
    const ok = await saveTeam(team);
    setCreating(false);
    if (ok) { toast.success('创建成功'); setName(''); setSelected([]); setShowCreate(false); }
    else toast.error('创建失败');
  };

  const del = async (id: string) => {
    if (!(await confirm({ title: '删除团队', message: '确定删除？聊天记录将被清除。', variant: 'danger' }))) return;
    (await deleteTeam(id)) ? toast.success('已删除') : toast.error('删除失败');
  };

  const removeMember = async (teamId: string, agentId: string) => {
    if (!(await confirm({ title: '移除成员', message: '确定移除该成员吗？', variant: 'danger' }))) return;
    (await removeMemberFromTeam(teamId, agentId)) ? toast.success('已移除') : toast.error('移除失败');
  };

  const addMember = async (teamId: string, agentId: string) => {
    (await addMemberToTeam(teamId, agentId)) ? toast.success('已添加') : toast.error('添加失败（可能已存在）');
  };

  const avail = (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    return team ? agents.filter(a => !team.members.some(m => m.agentId === a.id)) : [];
  };

  const getAgent = (id: string) => agents.find(a => a.id === id);

  return (
    <div className="p-6">
      {dialog}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">我的团队</h2>
          <p className="text-sm text-gray-400 mt-0.5">{teams.length} 个团队</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-[0.98] transition-all">
          + 新建团队
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-5 bg-white border border-gray-200 rounded-2xl shadow-sm animate-slide-in">
          <h3 className="font-semibold text-gray-900 mb-4">创建新团队</h3>
          <input type="text" placeholder="团队名称" value={name} onChange={e => setName(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 mb-4 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
          <p className="text-sm text-gray-500 mb-2">选择初始成员：</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {agents.length === 0 && <span className="text-sm text-gray-400">暂无可用 Agent</span>}
            {agents.map(a => (
              <button key={a.id} onClick={() => setSelected(prev => prev.includes(a.id) ? prev.filter(x => x !== a.id) : [...prev, a.id])}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  selected.includes(a.id) ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>{a.name}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={create} disabled={!name.trim() || creating}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 hover:bg-blue-700 transition-all">{creating ? '创建中...' : '创建'}</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">取消</button>
          </div>
        </div>
      )}

      {teams.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <div className="text-5xl mb-4">👥</div>
          <p className="font-medium">还没有团队</p>
          <p className="text-sm mt-1">去市场添加 Agent，然后组建团队</p>
        </div>
      ) : (
        <div className="space-y-4">
          {teams.map(team => (
            <div key={team.id} className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{team.name}</h3>
                  <p className="text-sm text-gray-400">{team.members.length} 名成员</p>
                </div>
                <div className="flex gap-2">
                  <AddPopover teamId={team.id} available={avail(team.id)} onAdd={addMember} />
                  <button onClick={() => del(team.id)}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">删除</button>
                </div>
              </div>
              {team.members.length === 0 ? (
                <p className="text-sm text-gray-400">暂无成员</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {team.members.map(m => {
                    const agent = getAgent(m.agentId);
                    if (!agent) return null;
                    return (
                      <div key={m.agentId} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-sm group hover:border-gray-200 transition-all">
                        <span className="font-medium text-gray-700">{agent.name}</span>
                        <span className="text-xs text-gray-400">{m.isManager ? '管理员' : '成员'}</span>
                        <button onClick={() => removeMember(team.id, m.agentId)}
                          className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all ml-0.5 font-bold">×</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddPopover({ teamId, available, onAdd }: { teamId: string; available: { id: string; name: string }[]; onAdd: (t: string, a: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 font-medium rounded-lg hover:bg-blue-100 transition-all">+ 添加成员</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-white border border-gray-200 rounded-xl shadow-lg p-1.5 animate-fade-in">
            {available.length === 0 ? (
              <p className="text-sm text-gray-400 p-2">没有可添加的 Agent</p>
            ) : available.map(a => (
              <button key={a.id} onClick={() => { onAdd(teamId, a.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-all">+ {a.name}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
