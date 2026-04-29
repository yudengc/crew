import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import type { TaskItem } from '../types';

const PHASE_LABELS: Record<string, string> = {
  idle: '待执行',
  decomposing: '分析中',
  executing: '执行中',
  synthesizing: '综合中',
  completed: '已完成',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  in_progress: '执行中',
  completed: '已完成',
};

export default function TaskCenter() {
  const { tasks, teams, agents, saveTask, deleteTask, callAi, executeTaskOrchestrated } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', teamId: '' });
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<string>('idle');

  const handleCreate = async () => {
    if (!newTask.title.trim() || !newTask.teamId) return;
    const team = teams.find(t => t.id === newTask.teamId);
    const task: TaskItem = {
      id: crypto.randomUUID(),
      title: newTask.title,
      description: newTask.description,
      teamId: newTask.teamId,
      teamMembers: team?.members ?? [],
      status: 'pending',
      result: '',
      createdAt: new Date().toISOString(),
      subTasks: [],
      phase: 'idle',
    };
    await saveTask(task);
    setNewTask({ title: '', description: '', teamId: '' });
    setShowCreate(false);
  };

  const handleExecute = async (task: TaskItem) => {
    const team = teams.find(t => t.id === task.teamId);
    if (!team) return;

    const updatedTask: TaskItem = { ...task, status: 'in_progress' };
    await saveTask(updatedTask);
    setExecutingTaskId(task.id);

    try {
      const memberAgents = team.members
        .map(m => agents.find(a => a.id === m.agentId))
        .filter(Boolean);

      let results: string[] = [];
      for (const agent of memberAgents) {
        if (!agent) continue;
        const prompt = `你是 ${agent.name}，${agent.description}。任务：${task.description}`;
        const result = await callAi(prompt, agent.config);
        results.push(`【${agent.name}】\n${result}`);
      }

      const finalTask: TaskItem = {
        ...updatedTask,
        status: 'completed',
        result: results.join('\n\n'),
        completedAt: new Date().toISOString(),
      };
      await saveTask(finalTask);
    } catch (error) {
      const failedTask: TaskItem = {
        ...updatedTask,
        status: 'pending',
        result: `错误：${(error as Error).message}`,
      };
      await saveTask(failedTask);
    } finally {
      setExecutingTaskId(null);
    }
  };

  const handleExecuteOrchestrated = async (task: TaskItem) => {
    setExecutingTaskId(task.id);
    setCurrentPhase('decomposing');

    // Poll phase updates from task store
    const pollPhase = setInterval(() => {
      const updated = tasks.find(t => t.id === task.id);
      if (updated) {
        setCurrentPhase(updated.phase);
        if (updated.phase === 'completed' || updated.status === 'completed') {
          clearInterval(pollPhase);
          setExecutingTaskId(null);
          setCurrentPhase('idle');
        }
      }
    }, 1000);

    try {
      await executeTaskOrchestrated(task.id);
    } catch (error) {
      console.error('Orchestration error:', error);
    } finally {
      clearInterval(pollPhase);
      setExecutingTaskId(null);
      setCurrentPhase('idle');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定删除这个任务吗？')) {
      await deleteTask(id);
    }
  };

  const getAgentName = (agentId: string) => {
    return agents.find(a => a.id === agentId)?.name ?? agentId;
  };

  const getManagerName = (task: TaskItem) => {
    const manager = task.teamMembers?.find(m => m.isManager);
    if (manager) return getAgentName(manager.agentId);
    if (task.teamMembers?.length > 0) return getAgentName(task.teamMembers[0].agentId);
    return '未知';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">任务中心</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          + 创建任务
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-4 bg-[#252526] rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">创建新任务</h3>
          <input
            type="text"
            placeholder="任务标题"
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            className="w-full px-4 py-2 mb-4 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <textarea
            placeholder="任务描述..."
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            rows={3}
            className="w-full px-4 py-2 mb-4 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
          />
          <select
            value={newTask.teamId}
            onChange={(e) => setNewTask({ ...newTask, teamId: e.target.value })}
            className="w-full px-4 py-2 mb-4 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">选择执行团队</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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

      {tasks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-xl mb-2">还没有任务</p>
          <p>创建一个任务，分配给团队执行</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => {
            const isExecuting = executingTaskId === task.id;
            const phase = isExecuting ? currentPhase : task.phase;
            const phaseLabel = PHASE_LABELS[phase] ?? phase;

            return (
              <div key={task.id} className="p-4 bg-[#252526] rounded-lg border border-gray-700">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{task.title}</h3>
                    <p className="text-gray-400 text-sm mt-1">{task.description}</p>
                    <p className="text-gray-500 text-xs mt-1">
                      负责人：{getManagerName(task)} · 团队：{teams.find(t => t.id === task.teamId)?.name ?? '未知'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-sm ${
                      task.status === 'completed' ? 'bg-green-900 text-green-300' :
                      task.status === 'in_progress' ? 'bg-yellow-900 text-yellow-300' :
                      'bg-gray-700 text-gray-300'
                    }`}>
                      {phase !== 'idle' && phase !== 'completed' ? phaseLabel : STATUS_LABELS[task.status] ?? task.status}
                    </span>
                    {task.status !== 'completed' && (
                      <>
                        <button
                          onClick={() => handleExecute(task)}
                          disabled={isExecuting}
                          className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
                        >
                          简单执行
                        </button>
                        <button
                          onClick={() => handleExecuteOrchestrated(task)}
                          disabled={isExecuting}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isExecuting ? '执行中...' : '智能协调'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="text-gray-500 hover:text-red-400 text-sm"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {/* Phase progress indicator */}
                {phase !== 'idle' && phase !== 'completed' && (
                  <div className="mb-3 flex items-center gap-2 text-sm">
                    <div className="flex gap-1">
                      {['decomposing', 'executing', 'synthesizing'].map((p) => (
                        <div
                          key={p}
                          className={`w-16 h-1 rounded ${
                            phase === p ? 'bg-blue-500' :
                            ['decomposing', 'executing', 'synthesizing'].indexOf(phase) > ['decomposing', 'executing', 'synthesizing'].indexOf(p)
                              ? 'bg-green-500' : 'bg-gray-600'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-blue-400">{phaseLabel}...</span>
                  </div>
                )}

                {/* Sub-task cards */}
                {task.subTasks && task.subTasks.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <h4 className="text-sm font-medium text-gray-400">子任务</h4>
                    {task.subTasks.map((subtask) => (
                      <div key={subtask.id} className="p-2 bg-[#1e1e1e] rounded border border-gray-700">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${
                              subtask.status === 'completed' ? 'bg-green-500' :
                              subtask.status === 'in_progress' ? 'bg-yellow-500' : 'bg-gray-500'
                            }`} />
                            <span className="text-sm text-white">{subtask.title}</span>
                            <span className="text-xs text-gray-500">→ {subtask.assignedAgentName}</span>
                          </div>
                          <span className="text-xs text-gray-500">{STATUS_LABELS[subtask.status] ?? subtask.status}</span>
                        </div>
                        {subtask.result && subtask.status === 'completed' && (
                          <div className="mt-2 text-xs text-gray-400 whitespace-pre-wrap pl-4 border-l-2 border-gray-700">
                            {subtask.result.substring(0, 200)}{subtask.result.length > 200 ? '...' : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Final result */}
                {task.result && (
                  <div className="mt-3 p-3 bg-[#1e1e1e] rounded text-gray-300 text-sm whitespace-pre-wrap">
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