import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/appStore';

export default function Settings() {
  const { settings, saveSettings, callAi } = useAppStore();
  const [form, setForm] = useState({ ...settings });
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const save = async () => {
    if (form.claudeApiKey && !form.claudeApiKey.startsWith('sk-ant-')) toast.warning('Claude Key 应以 sk-ant- 开头');
    if (form.openAiApiKey && !form.openAiApiKey.startsWith('sk-')) toast.warning('OpenAI Key 应以 sk- 开头');
    await saveSettings(form);
    setSaved(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 2000);
  };

  const testConn = async (provider: 'claude' | 'openai') => {
    const key = provider === 'claude' ? form.claudeApiKey : form.openAiApiKey;
    if (!key) { toast.error('请先输入 API Key'); return; }
    setTesting(provider);
    try {
      await saveSettings(form);
      await callAi('Respond with "OK".', { model_id: provider === 'claude' ? 'claude-haiku-4-5-20251001' : 'gpt-3.5-turbo', temperature: 0, max_tokens: 10 });
      toast.success(`${provider === 'claude' ? 'Claude' : 'OpenAI'} 连接成功 ✓`);
    } catch { toast.error('连接失败，检查 Key 和网络'); }
    finally { setTesting(null); }
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">设置</h2>
        <p className="text-sm text-gray-400 mt-0.5">配置 AI 提供商和 API Keys</p>
      </div>

      <div className="space-y-5">
        <div className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4">提供商</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">默认提供商</label>
              <select value={form.aiProvider} onChange={e => setForm({ ...form, aiProvider: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
                <option value="claude">Claude (Anthropic)</option>
                <option value="openai">OpenAI GPT</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">默认模型</label>
              <input type="text" value={form.defaultModel} onChange={e => setForm({ ...form, defaultModel: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
            </div>
          </div>
        </div>

        <div className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4">API Keys</h3>
          <div className="space-y-4">
            {([
              { key: 'claudeApiKey' as const, label: 'Claude API Key', hint: 'sk-ant-', provider: 'claude' as const },
              { key: 'openAiApiKey' as const, label: 'OpenAI API Key', hint: 'sk-', provider: 'openai' as const },
            ]).map(({ key, label, hint, provider }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-600">{label}</label>
                  <button onClick={() => testConn(provider)} disabled={testing !== null || !form[key]}
                    className="text-xs px-3 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-40 transition-all font-medium">
                    {testing === provider ? '测试中...' : '测试连接'}
                  </button>
                </div>
                <input type="password" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
                  placeholder={hint + '...'}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4">外观</h3>
          <select value={form.theme} onChange={e => setForm({ ...form, theme: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>

        <button onClick={save}
          className="px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-[0.98] transition-all">
          {saved ? '已保存 ✓' : '保存设置'}
        </button>
      </div>
    </div>
  );
}
