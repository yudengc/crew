import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../stores/appStore';
import { useConfirm } from '../components/ConfirmDialog';
import type { MarketplaceAgent } from '../types';
import { CAPABILITIES } from '../types';

export default function Marketplace() {
  const { marketplace, purchaseAgent, agents } = useAppStore();
  const [tab, setTab] = useState<'browse' | 'listings'>('browse');
  const [search, setSearch] = useState('');
  const [filterCap, setFilterCap] = useState('');

  const owned = new Set(agents.map(a => a.name));
  const filtered = marketplace.filter(a =>
    (!search || a.name.includes(search) || a.description.includes(search)) &&
    (!filterCap || a.capabilities.includes(filterCap))
  );

  const buy = async (a: MarketplaceAgent) => {
    if (owned.has(a.name)) return;
    (await purchaseAgent(a)) ? toast.success(`已添加「${a.name}」`) : toast.error('购买失败');
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Agent 市场</h2>
          <p className="text-sm text-gray-400 mt-0.5">浏览和购买 Agent · 已拥有 {agents.length} 个</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          ['browse', '浏览市场'],
          ['listings', '我的上架'],
        ] as const).map(([k, v]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{v}</button>
        ))}
      </div>

      {tab === 'browse' && (
        <>
          <div className="flex gap-3 mb-6">
            <input type="text" placeholder="搜索 Agent..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-white border border-gray-300 rounded-xl text-gray-900
                placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" />
            <select value={filterCap} onChange={e => setFilterCap(e.target.value)}
              className="px-4 py-2.5 bg-white border border-gray-300 rounded-xl text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
              <option value="">全部分类</option>
              {CAPABILITIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-24 text-gray-400">
              <div className="text-4xl mb-3">🔍</div>
              <p className="font-medium">没有找到匹配的 Agent</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(agent => {
                const has = owned.has(agent.name);
                return (
                  <div key={agent.id}
                    className={`p-5 rounded-2xl border transition-all duration-200 hover:shadow-md ${
                      has ? 'bg-green-50/50 border-green-200' : 'bg-white border-gray-200 shadow-sm'
                    }`}>
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold text-gray-900">{agent.name}</h3>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        has ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>{has ? '已拥有' : `${agent.cost} 积分`}</span>
                    </div>
                    <p className="text-sm text-gray-500 mb-4 leading-relaxed">{agent.description}</p>
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {agent.capabilities.map(cap => {
                        const info = CAPABILITIES.find(c => c.value === cap);
                        return <span key={cap} className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-600">{info?.icon} {info?.label}</span>;
                      })}
                    </div>
                    <button onClick={() => buy(agent)} disabled={has}
                      className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        has ? 'bg-gray-50 text-gray-400 border border-gray-200 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-[0.98]'
                      }`}>{has ? '已添加' : '添加到团队'}</button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'listings' && <MyListingsView />}
    </div>
  );
}

function MyListingsView() {
  const { agents, publishAgent, unpublishAgent } = useAppStore();
  const { confirm, dialog } = useConfirm();
  const [pub, setPub] = useState<string | null>(null);
  const [price, setPrice] = useState<Record<string, number>>({});
  const customs = agents.filter(a => a.isCustom);

  const handlePublish = async (id: string) => {
    setPub(id);
    try { (await publishAgent(id, price[id] || 50)) ? toast.success('上架成功') : toast.error('上架失败'); }
    catch { toast.error('上架失败'); } finally { setPub(null); }
  };
  const unpub = async (id: string) => {
    if (!(await confirm({ title: '下架', message: '确定下架吗？', variant: 'danger' }))) return;
    (await unpublishAgent(id)) ? toast.success('已下架') : toast.error('下架失败');
  };

  return <>
    {dialog}
    {customs.length === 0 ? (
      <div className="text-center py-24 text-gray-400">
        <div className="text-4xl mb-3">🏭</div>
        <p className="font-medium">还没有自定义 Agent</p>
        <p className="text-sm mt-1">去 Agent 工厂创建并上架</p>
      </div>
    ) : (
      <div className="space-y-3">
        {customs.map(a => (
          <div key={a.id} className="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-medium text-gray-900">{a.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${a.isListed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {a.isListed ? '已上架' : '未上架'}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{a.description}</p>
            </div>
            <div className="flex items-center gap-3">
              {!a.isListed ? (
                <>
                  <input type="number" placeholder="定价" value={price[a.id] || ''}
                    onChange={e => setPrice({ ...price, [a.id]: Number(e.target.value) || 0 })}
                    className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                  <button onClick={() => handlePublish(a.id)} disabled={pub === a.id}
                    className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all">上架</button>
                </>
              ) : (
                <button onClick={() => unpub(a.id)}
                  className="px-4 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-all">下架</button>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </>;
}
