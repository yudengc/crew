import { useState } from 'react';
import { useAppStore } from '../stores/appStore';

const steps = [
  {
    title: '欢迎使用 Crew',
    desc: 'Crew 是一个 Agent 团队协作平台。组建 AI Agent 团队来执行复杂任务——每个 Agent 都有独特的专长和能力。',
    emoji: '🚀',
  },
  {
    title: '浏览市场 & 创建 Agent',
    desc: '在市场中挑选现成的 Agent，或在 Agent 工厂中自定义创建——设定模型、温度、沟通风格和决策方式。',
    emoji: '🏪',
  },
  {
    title: '组建你的团队',
    desc: '将不同专长的 Agent 组合成团队，指定管理者与成员角色，让它们各司其职、相互协作。',
    emoji: '👥',
  },
  {
    title: '智能任务编排',
    desc: '给团队分配任务后，管理 Agent 会自动拆解、并行分派、综合结果——像一支真正的项目团队。',
    emoji: '✨',
  },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const { saveSettings, settings, setView } = useAppStore();
  const last = step === steps.length - 1;

  const finish = async () => {
    await saveSettings({ ...settings, hasCompletedOnboarding: true });
    setView('marketplace');
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-blue-50">
      <div className="w-full max-w-lg mx-auto px-6 sm:px-10">
        {/* Step dots */}
        <div className="flex justify-center gap-2 mb-10">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`rounded-full transition-all duration-500 ${
                i === step
                  ? 'w-10 h-2 bg-blue-600'
                  : i < step
                  ? 'w-2 h-2 bg-green-500'
                  : 'w-2 h-2 bg-gray-300 hover:bg-gray-400'
              }`}
              aria-label={`第 ${i + 1} 步`}
            />
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 p-10 sm:p-12 mb-8">
          <div className="text-center" key={step}>
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-blue-50 mb-8">
              <span className="text-4xl">{steps[step].emoji}</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">{steps[step].title}</h2>
            <p className="text-gray-500 leading-relaxed text-base">{steps[step].desc}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => (last ? finish() : setStep(step + 1))}
            className="w-full max-w-sm py-3.5 bg-blue-600 text-white rounded-2xl font-semibold text-base
              shadow-md shadow-blue-200 hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-300
              active:scale-[0.98] transition-all duration-200"
          >
            {last ? '开始使用' : '下一步'}
          </button>
          <button onClick={finish} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            跳过引导
          </button>
        </div>
      </div>
    </div>
  );
}
