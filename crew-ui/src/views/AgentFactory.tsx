import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/appStore';
import { CAPABILITIES, type Agent } from '../types';

const MODELS = [
  { v: 'claude-sonnet-4-20250514', l: 'Claude Sonnet 4' },
  { v: 'claude-opus-4-20250514', l: 'Claude Opus 4' },
  { v: 'claude-haiku-4-5-20251001', l: 'Claude Haiku 4.5' },
  { v: 'gpt-4', l: 'GPT-4' },
  { v: 'gpt-3.5-turbo', l: 'GPT-3.5 Turbo' },
];

export default function AgentFactory() {
  const { saveAgent, callAi, settings } = useAppStore();
  const [form, setForm] = useState({
    name: '', description: '', capabilities: [] as string[],
    communicationStyle: '专业', decisionMaking: '理性',
    modelId: 'claude-sonnet-4-20250514', temperature: 0.7, maxTokens: 4096,
  });
  const [test, setTest] = useState('');
  const [testRes, setTestRes] = useState('');
  const [testing, setTesting] = useState(false);

  const toggleCap = (c: string) => setForm(f => ({ ...f, capabilities: f.capabilities.includes(c) ? f.capabilities.filter(x => x !== c) : [...f.capabilities, c] }));

  const doTest = async () => {
    if (!test.trim()) return;
    setTesting(true); setTestRes('');
    try { setTestRes(await callAi(`你是 ${form.name || 'AI'}。\n\n${test}`, { model_id: form.modelId, temperature: form.temperature, max_tokens: form.maxTokens })); }
    catch (e) { setTestRes(`错误：${(e as Error).message}`); }
    finally { setTesting(false); }
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('请输入 Agent 名称'); return; }
    if (form.capabilities.length === 0) { toast.error('请至少选一个能力'); return; }
    const agent: Agent = {
      id: crypto.randomUUID(), name: form.name, description: form.description,
      capabilities: form.capabilities,
      personality: { communication_style: form.communicationStyle, decision_making: form.decisionMaking },
      config: { model_provider: form.modelId.startsWith('claude') ? 'claude' : 'openai', model_id: form.modelId, temperature: form.temperature, max_tokens: form.maxTokens },
      cost: 0, isCustom: true, isListed: false, createdAt: new Date().toISOString(),
    };
    if (await saveAgent(agent)) {
      toast.success('创建成功');
      setForm({ name: '', description: '', capabilities: [], communicationStyle: '专业', decisionMaking: '理性', modelId: 'claude-sonnet-4-20250514', temperature: 0.7, maxTokens: 4096 });
      setTest(''); setTestRes('');
    } else toast.error('创建失败');
  };

  const hasKey = settings.claudeApiKey || settings.openAiApiKey;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Agent 工厂</h2>
        <p className="text-sm text-gray-400 mt-0.5">创建自定义 AI Agent，设定能力、性格和模型</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">Agent 名称</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：安全审计专家"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">描述</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="描述专长和特点..." rows={2}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 resize-none outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">能力标签</label>
            <div className="flex flex-wrap gap-2">
              {CAPABILITIES.map(c => (
                <button key={c.value} onClick={() => toggleCap(c.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    form.capabilities.includes(c.value) ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>{c.icon} {c.label}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">沟通风格</label>
              <select value={form.communicationStyle} onChange={e => setForm({ ...form, communicationStyle: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
                <option value="专业">专业简洁</option><option value="详细">详细全面</option><option value="友好">友好轻松</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">决策方式</label>
              <select value={form.decisionMaking} onChange={e => setForm({ ...form, decisionMaking: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
                <option value="理性">理性分析</option><option value="创意">创意发散</option><option value="保守">谨慎保守</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">模型</label>
            <select value={form.modelId} onChange={e => setForm({ ...form, modelId: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
              {MODELS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">温度 <span className="text-blue-600">{form.temperature}</span></label>
              <input type="range" min="0" max="1" step="0.1" value={form.temperature}
                onChange={e => setForm({ ...form, temperature: parseFloat(e.target.value) })} className="w-full accent-blue-600" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">Max Tokens <span className="text-blue-600">{form.maxTokens}</span></label>
              <input type="range" min="256" max="8192" step="256" value={form.maxTokens}
                onChange={e => setForm({ ...form, maxTokens: parseInt(e.target.value) })} className="w-full accent-blue-600" />
            </div>
          </div>
          <button onClick={save}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-[0.98] transition-all">保存 Agent</button>
        </div>

        <div className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col">
          <h3 className="font-semibold text-gray-900 mb-3">快速测试</h3>
          <textarea value={test} onChange={e => setTest(e.target.value)} placeholder="输入测试消息..." rows={4}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 resize-none mb-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
          <button onClick={doTest} disabled={testing || !hasKey}
            className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 mb-3 hover:bg-blue-700 transition-all">{testing ? '测试中...' : '发送测试'}</button>
          {!hasKey && <p className="text-xs text-amber-600 mb-3">请先配置 API Key</p>}
          {testRes && <div className="flex-1 p-4 bg-gray-50 rounded-xl text-sm text-gray-600 whitespace-pre-wrap overflow-auto border border-gray-100">{testRes}</div>}
        </div>
      </div>
    </div>
  );
}
