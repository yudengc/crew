import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/appStore';
import { useConfirm } from '../components/ConfirmDialog';
import type { TaskItem } from '../types';

const PHASE_ORDER = ['decomposing', 'executing', 'synthesizing'] as const;
const PHASE_LABEL: Record<string, string> = { idle: '待执行', decomposing: '拆解中', executing: '执行中', synthesizing: '整合中', completed: '已完成' };

export default function TaskCenter() {
  const { tasks, teams, agents, saveTask, deleteTask, executeTaskOrchestrated } = useAppStore();
  const { confirm, dialog } = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', teamId: '' });
  const [execId, setExecId] = useState<string | null>(null);
  const [phase, setPhase] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.teamId) { toast.error('请填写标题并选团队'); return; }
    const team = teams.find(t => t.id === form.teamId);
    const task: TaskItem = {
      id: crypto.randomUUID(), title: form.title, description: form.description,
      teamId: form.teamId, teamMembers: team?.members ?? [],
      status: 'pending', result: '', createdAt: new Date().toISOString(), subTasks: [], phase: 'idle',
    };
    (await saveTask(task)) ? toast.success('任务已创建') : toast.error('创建失败');
    setForm({ title: '', description: '', teamId: '' }); setShowCreate(false);
  };

  const run = async (task: TaskItem) => {
    // Prevent double-execution of the same task
    if (execId) return;
    setExecId(task.id); setPhase('decomposing');
    const taskId = task.id;
    let t = 0;
    const interval = setInterval(() => {
      const cur = useAppStore.getState().tasks.find(x => x.id === taskId);
      t++;
      if (cur) setPhase(cur.phase);
      if (cur?.phase === 'completed' || t > 600) {
        clearInterval(interval);
        if (taskId === execId) { setExecId(null); setPhase(''); }
      }
    }, 1000);
    try { await executeTaskOrchestrated(taskId); }
    catch { toast.error('执行失败'); }
    finally {
      clearInterval(interval);
      if (taskId === execId) { setExecId(null); setPhase(''); }
    }
  };

  const del = async (id: string) => {
    if (!(await confirm({ title: '删除任务', message: '确定删除吗？', variant: 'danger' }))) return;
    (await deleteTask(id)) ? toast.success('已删除') : toast.error('删除失败');
  };

  return (
    <div className="p-6">
      {dialog}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">任务中心</h2>
          <p className="text-sm text-gray-400 mt-0.5">{tasks.length} 个任务</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-[0.98] transition-all">+ 创建任务</button>
      </div>

      {showCreate && (
        <div className="mb-6 p-5 bg-white border border-gray-200 rounded-2xl shadow-sm animate-slide-in">
          <h3 className="font-semibold text-gray-900 mb-4">创建新任务</h3>
          <input type="text" placeholder="任务标题" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 mb-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
          <textarea placeholder="任务描述..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 mb-3 resize-none outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
          <select value={form.teamId} onChange={e => setForm({ ...form, teamId: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 mb-4 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
            <option value="">选择执行团队</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">创建</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">取消</button>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <div className="text-5xl mb-4">📋</div>
          <p className="font-medium">还没有任务</p>
          <p className="text-sm mt-1">创建任务，分配给团队执行</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map(task => {
            const running = execId === task.id;
            const curPhase = running ? phase : task.phase;
            const team = teams.find(t => t.id === task.teamId);
            return (
              <div key={task.id} className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 mr-4">
                    <h3 className="font-semibold text-gray-900">{task.title}</h3>
                    <p className="text-sm text-gray-500 mt-1">{task.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span>👤 {task.teamMembers?.[0]?.agentId ? agents.find(a => a.id === task.teamMembers[0].agentId)?.name : '未分配'}</span>
                      <span>👥 {team?.name ?? '未知'}</span>
                      <span className={`px-2 py-0.5 rounded-full font-medium ${
                        task.status === 'completed' ? 'bg-green-100 text-green-700' :
                        task.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                      }`}>{curPhase !== 'idle' && curPhase !== 'completed' ? PHASE_LABEL[curPhase] : task.status === 'completed' ? '已完成' : '待执行'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {task.status !== 'completed' && (
                      <button onClick={() => run(task)} disabled={running}
                        className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 hover:bg-blue-700 transition-all">
                        {running ? '执行中...' : '智能协调'}
                      </button>
                    )}
                    <button onClick={() => del(task.id)} className="px-3 py-1.5 text-sm text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">删除</button>
                  </div>
                </div>

                {curPhase !== 'idle' && curPhase !== 'completed' && (
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex gap-2 flex-1">
                      {PHASE_ORDER.map((p, i) => {
                        const idx = PHASE_ORDER.indexOf(curPhase as typeof PHASE_ORDER[number]);
                        const done = idx >= 0 && idx > i;
                        const active = curPhase === p;
                        const color = active ? 'bg-blue-500' : (done ? 'bg-green-500' : 'bg-gray-200');
                        return <div key={p} className={`h-1.5 rounded-full flex-1 transition-colors duration-500 ${color}`} />;
                      })}
                    </div>
                    <span className="text-xs text-blue-600 font-medium whitespace-nowrap">{PHASE_LABEL[curPhase] ?? curPhase}...</span>
                  </div>
                )}

                {task.subTasks.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">子任务</p>
                    {task.subTasks.map(st => (
                      <div key={st.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-xl text-sm border border-gray-100">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          st.status === 'completed' ? 'bg-green-500' : st.status === 'in_progress' ? 'bg-blue-500 animate-pulse' :
                          st.status === 'failed' ? 'bg-red-500' : 'bg-gray-300'
                        }`} />
                        <span className="flex-1 text-gray-600">{st.title}</span>
                        <span className="text-xs text-gray-400">→ {st.assignedAgentName}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          st.status === 'completed' ? 'bg-green-100 text-green-700' : st.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                          st.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-gray-200 text-gray-500'
                        }`}>{st.status === 'completed' ? '完成' : st.status === 'in_progress' ? '执行中' : st.status === 'failed' ? '失败' : '等待'}</span>
                      </div>
                    ))}
                  </div>
                )}

                {task.result && (
                  <div className="mt-3 p-4 bg-gray-50 rounded-xl text-sm text-gray-600 whitespace-pre-wrap leading-relaxed border border-gray-100">
                    {task.result}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
