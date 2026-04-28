import { useState } from 'react';
import { useAppStore } from '../stores/appStore';

const steps = [
  {
    title: '什么是 Agent？',
    content: 'Agent 是具有特定能力的 AI 助手。每个 Agent 都有独特的技能树，比如代码编写、数据分析、调研搜索等。你可以把他们想象成你的数字员工。',
    icon: '🤖',
  },
  {
    title: '组建你的团队',
    content: '从市场购买 Agent 或自己创建他们，然后把他们组合成团队。一个团队可以包含多个不同能力的 Agent，协作完成复杂任务。',
    icon: '👥',
  },
  {
    title: '下发任务',
    content: '作为项目经理，你只需要描述任务需求，团队会自动协调分配工作。Agent 之间可以通信协作，最终给你一个完整的结果。',
    icon: '📋',
  },
  {
    title: '开始使用',
    content: '先去市场看看有哪些 Agent 可用，或者直接创建你需要的自定义 Agent。准备好了吗？',
    icon: '🚀',
  },
];

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const { setView, saveSettings, settings } = useAppStore();

  const handleNext = async () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      await saveSettings({ ...settings, hasCompletedOnboarding: true });
      setView('marketplace');
    }
  };

  const handleSkip = async () => {
    await saveSettings({ ...settings, hasCompletedOnboarding: true });
    setView('marketplace');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#1e1e1e] p-8">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-12">
          <div className="text-6xl mb-4">{steps[currentStep].icon}</div>
          <h2 className="text-3xl font-bold text-white mb-2">
            {steps[currentStep].title}
          </h2>
          <p className="text-gray-400 text-lg leading-relaxed">
            {steps[currentStep].content}
          </p>
        </div>

        <div className="flex justify-center gap-3 mb-8">
          {steps.map((_, idx) => (
            <div
              key={idx}
              className={`w-3 h-3 rounded-full transition-colors ${
                idx === currentStep ? 'bg-blue-500' : 'bg-gray-600'
              }`}
            />
          ))}
        </div>

        <div className="flex justify-center gap-4">
          {currentStep > 0 && (
            <button
              onClick={() => setCurrentStep(currentStep - 1)}
              className="px-6 py-3 text-gray-400 hover:text-white transition-colors"
            >
              上一步
            </button>
          )}
          <button
            onClick={handleNext}
            className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            {currentStep === steps.length - 1 ? '开始使用' : '下一步'}
          </button>
          <button
            onClick={handleSkip}
            className="px-6 py-3 text-gray-500 hover:text-gray-300 transition-colors"
          >
            跳过引导
          </button>
        </div>
      </div>
    </div>
  );
}