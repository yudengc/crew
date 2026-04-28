import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import type { TaskItem } from '../types';

export default function TaskCenter() {
  const { tasks, teams, agents, saveTask, deleteTask, callAi } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', teamId: '' });
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newTask.title.trim() || !newTask.teamId) return;
    const task: TaskItem = {
      id: crypto.randomUUID(),
      title: newTask.title,
      description: newTask.description,
      teamId: newTask.teamId,
      status: 'pending',
      result: '',
      createdAt: new Date().toISOString(),
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

  const handleDelete = async (id: string) => {
    if (confirm('确定删除这个任务吗？')) {
      await deleteTask(id);
    }
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
          {tasks.map((task) => (
            <div key={task.id} className="p-4 bg-[#252526] rounded-lg border border-gray-700">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{task.title}</h3>
                  <p className="text-gray-400 text-sm mt-1">{task.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-sm ${
                    task.status === 'completed' ? 'bg-green-900 text-green-300' :
                    task.status === 'in_progress' ? 'bg-yellow-900 text-yellow-300' :
                    'bg-gray-700 text-gray-300'
                  }`}>
                    {task.status === 'completed' ? '已完成' :
                     task.status === 'in_progress' ? '执行中' : '待执行'}
                  </span>
                  {task.status !== 'completed' && (
                    <button
                      onClick={() => handleExecute(task)}
                      disabled={executingTaskId === task.id}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {executingTaskId === task.id ? '执行中...' : '执行'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="text-gray-500 hover:text-red-400 text-sm"
                  >
                    删除
                  </button>
                </div>
              </div>
              {task.result && (
                <div className="mt-3 p-3 bg-[#1e1e1e] rounded text-gray-300 text-sm whitespace-pre-wrap">
                  {task.result}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}