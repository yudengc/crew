import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { CAPABILITIES, type Agent } from '../types';

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { value: 'claude-haiku-4-20250514', label: 'Claude Haiku 4' },
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
];

export default function AgentFactory() {
  const { saveAgent, callAi, settings } = useAppStore();
  const [form, setForm] = useState({
    name: '',
    description: '',
    capabilities: [] as string[],
    communicationStyle: '专业',
    decisionMaking: '理性',
    modelProvider: 'claude',
    modelId: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
  });
  const [testPrompt, setTestPrompt] = useState('');
  const [testResult, setTestResult] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  const toggleCapability = (cap: string) => {
    setForm(prev => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter(c => c !== cap)
        : [...prev.capabilities, cap]
    }));
  };

  const handleTest = async () => {
    if (!testPrompt.trim()) return;
    setIsTesting(true);
    setTestResult('');
    try {
      const prompt = `你是 ${form.name || '自定义Agent'}，${form.description || '一个AI助手'}。\n\n用户：${testPrompt}`;
      const result = await callAi(prompt, {
        model_id: form.modelId,
        temperature: form.temperature,
        max_tokens: form.maxTokens,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult(`错误：${(error as Error).message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      alert('请输入 Agent 名称');
      return;
    }
    if (form.capabilities.length === 0) {
      alert('请至少选择一个能力');
      return;
    }

    const agent: Agent = {
      id: crypto.randomUUID(),
      name: form.name,
      description: form.description,
      capabilities: form.capabilities,
      personality: {
        communication_style: form.communicationStyle,
        decision_making: form.decisionMaking,
      },
      config: {
        model_provider: form.modelProvider,
        model_id: form.modelId,
        temperature: form.temperature,
        max_tokens: form.maxTokens,
      },
      cost: 0,
      isCustom: true,
      isListed: false,
      createdAt: new Date().toISOString(),
    };

    await saveAgent(agent);
    alert('Agent 创建成功！');
    setForm({
      name: '',
      description: '',
      capabilities: [],
      communicationStyle: '专业',
      decisionMaking: '理性',
      modelProvider: 'claude',
      modelId: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 4096,
    });
    setTestPrompt('');
    setTestResult('');
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">创建自定义 Agent</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-gray-400 mb-2">Agent 名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：我的数据分析助手"
              className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-2">描述</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="描述这个 Agent 的专长和特点..."
              rows={2}
              className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-2">能力</label>
            <div className="flex flex-wrap gap-2">
              {CAPABILITIES.map((cap) => (
                <button
                  key={cap.value}
                  onClick={() => toggleCapability(cap.value)}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    form.capabilities.includes(cap.value)
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#1e1e1e] text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {cap.icon} {cap.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-400 mb-2">沟通风格</label>
              <select
                value={form.communicationStyle}
                onChange={(e) => setForm({ ...form, communicationStyle: e.target.value })}
                className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="专业">专业简洁</option>
                <option value="详细">详细全面</option>
                <option value="友好">友好轻松</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-400 mb-2">决策方式</label>
              <select
                value={form.decisionMaking}
                onChange={(e) => setForm({ ...form, decisionMaking: e.target.value })}
                className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="理性">理性分析</option>
                <option value="创意">创意发散</option>
                <option value="保守">谨慎保守</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-gray-400 mb-2">模型</label>
            <select
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-400 mb-2">Temperature ({form.temperature})</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-gray-400 mb-2">Max Tokens ({form.maxTokens})</label>
              <input
                type="range"
                min="256"
                max="8192"
                step="256"
                value={form.maxTokens}
                onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) })}
                className="w-full"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
          >
            保存 Agent
          </button>
        </div>

        <div className="p-4 bg-[#252526] rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">测试 Chat</h3>
          <textarea
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            placeholder="输入测试消息..."
            rows={4}
            className="w-full px-4 py-2 mb-3 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
          />
          <button
            onClick={handleTest}
            disabled={isTesting || !settings.claudeApiKey}
            className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 mb-4"
          >
            {isTesting ? '测试中...' : '发送测试'}
          </button>
          {!settings.claudeApiKey && (
            <p className="text-yellow-500 text-sm mb-2">请先在设置中配置 API Key</p>
          )}
          {testResult && (
            <div className="p-3 bg-[#1e1e1e] rounded text-gray-300 text-sm whitespace-pre-wrap max-h-64 overflow-auto">
              {testResult}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}