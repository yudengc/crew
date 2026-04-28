import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import type { MarketplaceAgent } from '../types';
import { CAPABILITIES } from '../types';

type TabType = 'browse' | 'my-listings';

export default function Marketplace() {
  const { marketplace, purchaseAgent, agents } = useAppStore();
  const [tab, setTab] = useState<TabType>('browse');
  const [search, setSearch] = useState('');
  const [selectedCapability, setSelectedCapability] = useState<string | null>(null);

  const filteredAgents = marketplace.filter((agent) => {
    const matchesSearch = agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.description.toLowerCase().includes(search.toLowerCase());
    const matchesCapability = !selectedCapability || agent.capabilities.includes(selectedCapability);
    return matchesSearch && matchesCapability;
  });

  const ownedAgentIds = new Set(agents.map(a => a.name));

  const handlePurchase = async (agent: MarketplaceAgent) => {
    if (ownedAgentIds.has(agent.name)) return;
    await purchaseAgent(agent);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Agent 市场</h2>
        <span className="text-gray-500">已拥有 {agents.length} 个 Agent</span>
      </div>

      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setTab('browse')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            tab === 'browse' ? 'bg-blue-600 text-white' : 'bg-[#252526] text-gray-400 hover:text-white'
          }`}
        >
          浏览市场
        </button>
        <button
          onClick={() => setTab('my-listings')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            tab === 'my-listings' ? 'bg-blue-600 text-white' : 'bg-[#252526] text-gray-400 hover:text-white'
          }`}
        >
          我的上架
        </button>
      </div>

      {tab === 'browse' && (
        <>
          <div className="flex gap-4 mb-6">
            <input
              type="text"
              placeholder="搜索 Agent..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-4 py-2 bg-[#2d2d2d] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <select
              value={selectedCapability || ''}
              onChange={(e) => setSelectedCapability(e.target.value || null)}
              className="px-4 py-2 bg-[#2d2d2d] border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">全部分类</option>
              {CAPABILITIES.map((c) => (
                <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAgents.map((agent) => {
              const isOwned = ownedAgentIds.has(agent.name);
              return (
                <div
                  key={agent.id}
                  className={`p-4 rounded-lg border ${isOwned ? 'bg-[#1a3a1a] border-green-800' : 'bg-[#252526] border-gray-700'}`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
                    <span className={`text-sm px-2 py-1 rounded ${isOwned ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-300'}`}>
                      {isOwned ? '已拥有' : `${agent.cost} 积分`}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm mb-4">{agent.description}</p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {agent.capabilities.map((cap) => {
                      const capInfo = CAPABILITIES.find(c => c.value === cap);
                      return (
                        <span key={cap} className="text-xs px-2 py-1 bg-[#1e1e1e] rounded text-gray-300">
                          {capInfo?.icon} {capInfo?.label}
                        </span>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => handlePurchase(agent)}
                    disabled={isOwned}
                    className={`w-full py-2 rounded font-medium transition-colors ${isOwned ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                  >
                    {isOwned ? '已添加' : '购买'}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'my-listings' && (
        <MyListingsView />
      )}
    </div>
  );
}

function MyListingsView() {
  const { agents, publishAgent, unpublishAgent } = useAppStore();
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [price, setPrice] = useState<Record<string, number>>({});

  const customAgents = agents.filter(a => a.isCustom);

  const handlePublish = async (agentId: string) => {
    const agentPrice = price[agentId] || 50;
    setPublishingId(agentId);
    await publishAgent(agentId, agentPrice);
    setPublishingId(null);
  };

  const handleUnpublish = async (agentId: string) => {
    if (confirm('确定下架这个 Agent 吗？')) {
      await unpublishAgent(agentId);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-4">我的自定义 Agent</h3>

      {customAgents.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>还没有创建自定义 Agent</p>
          <p className="text-sm mt-2">去 Agent工厂 创建并上架你的 Agent</p>
        </div>
      ) : (
        <div className="space-y-4">
          {customAgents.map((agent) => (
            <div key={agent.id} className="p-4 bg-[#252526] rounded-lg border border-gray-700">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="text-lg font-semibold text-white">{agent.name}</h4>
                  <p className="text-gray-400 text-sm">{agent.description}</p>
                </div>
                <span className={`px-2 py-1 rounded text-sm ${agent.isListed ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                  {agent.isListed ? '已上架' : '未上架'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {agent.capabilities.map((cap) => {
                  const capInfo = CAPABILITIES.find(c => c.value === cap);
                  return (
                    <span key={cap} className="text-xs px-2 py-1 bg-[#1e1e1e] rounded text-gray-300">
                      {capInfo?.icon} {capInfo?.label}
                    </span>
                  );
                })}
              </div>
              <div className="flex items-center gap-4">
                {!agent.isListed ? (
                  <>
                    <input
                      type="number"
                      placeholder="定价"
                      value={price[agent.id] || ''}
                      onChange={(e) => setPrice({ ...price, [agent.id]: parseInt(e.target.value) || 0 })}
                      className="w-24 px-3 py-1 bg-[#1e1e1e] border border-gray-600 rounded text-white text-sm"
                    />
                    <button
                      onClick={() => handlePublish(agent.id)}
                      disabled={publishingId === agent.id}
                      className="px-4 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
                    >
                      {publishingId === agent.id ? '上架中...' : '上架到市场'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleUnpublish(agent.id)}
                    className="px-4 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                  >
                    下架
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}