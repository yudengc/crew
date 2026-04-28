import { useState } from 'react';
import { useAppStore } from '../stores/appStore';

export default function Settings() {
  const { settings, saveSettings } = useAppStore();
  const [form, setForm] = useState({ ...settings });
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-white mb-6">设置</h2>

      <div className="space-y-6">
        <div className="p-4 bg-[#252526] rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">AI 提供商</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-gray-400 mb-2">提供商</label>
              <select
                value={form.aiProvider}
                onChange={(e) => setForm({ ...form, aiProvider: e.target.value })}
                className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="claude">Claude (Anthropic)</option>
                <option value="openai">OpenAI GPT</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-400 mb-2">默认模型</label>
              <input
                type="text"
                value={form.defaultModel}
                onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="p-4 bg-[#252526] rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">API Keys</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-gray-400 mb-2">Claude API Key</label>
              <input
                type="password"
                value={form.claudeApiKey}
                onChange={(e) => setForm({ ...form, claudeApiKey: e.target.value })}
                placeholder="sk-ant-..."
                className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            {form.aiProvider === 'openai' && (
              <div>
                <label className="block text-gray-400 mb-2">OpenAI API Key</label>
                <input
                  type="password"
                  value={form.openAiApiKey}
                  onChange={(e) => setForm({ ...form, openAiApiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        <div className="p-4 bg-[#252526] rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">外观</h3>
          <div>
            <label className="block text-gray-400 mb-2">主题</label>
            <select
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value })}
              className="w-full px-4 py-2 bg-[#1e1e1e] border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          {saved ? '已保存 ✓' : '保存设置'}
        </button>
      </div>
    </div>
  );
}