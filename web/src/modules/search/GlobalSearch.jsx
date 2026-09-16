import React, { useState } from 'react'
import { Empty, Input, Spin, Tag, message } from 'antd'
import { ArrowRightOutlined, ClusterOutlined, DatabaseOutlined, HistoryOutlined, LaptopOutlined, SearchOutlined, AppstoreOutlined } from '@ant-design/icons'
import { api } from '../../api'
import './search.css'

const GROUPS = [
  { name: '终端资产', icon: <LaptopOutlined />, tone: 'blue' },
  { name: '物理服务器', icon: <DatabaseOutlined />, tone: 'green' },
  { name: '系统应用', icon: <AppstoreOutlined />, tone: 'violet' },
  { name: '运维履历', icon: <HistoryOutlined />, tone: 'amber' },
  { name: 'IP 规划池', icon: <ClusterOutlined />, tone: 'cyan' },
]

export default function GlobalSearch({ onNavigate }) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const groups = GROUPS.map((group) => ({
    ...group,
    items: results.filter((item) => {
      if (group.name === 'IP 规划池') return ['IP 规划池', 'IP规划池', 'IP池'].includes(item.group)
      return item.group === group.name
    }),
  })).filter((group) => group.items.length)

  const search = async () => {
    const query = keyword.trim()
    if (!query) { setResults([]); setSearched(false); return }
    setSearched(true); setLoading(true)
    try { const response = await api.search(query, 50); setResults(response.results || []) } catch (error) { setResults([]); message.error(`查询失败：${error.message}`) } finally { setLoading(false) }
  }

  return <section className="new-search-page">
    <div className="new-search-head"><div><span>资产管理 / 全局查询</span><h1>全局查询</h1><p>一次输入，查找终端资产、服务器、应用、履历和 IP。</p></div><div className="new-search-count">跨 5 类数据</div></div>
    <div className="new-search-box"><Input data-global-search-input autoFocus allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} onPressEnter={search} prefix={<SearchOutlined />} placeholder="输入姓名、资产编号、SN、IP、服务器或应用名称" suffix={<kbd>Ctrl K</kbd>} /><button type="button" onClick={search} disabled={loading}>{loading ? <Spin size="small" /> : '查询'}</button></div>
    <div className="new-search-scope"><span>查询范围</span>{GROUPS.map((group) => <Tag key={group.name}>{group.name}</Tag>)}</div>
    {!searched ? <div className="new-search-empty"><SearchOutlined /><strong>输入条件开始查询</strong><span>支持姓名、资产编号、序列号、IP 和应用名称</span></div> : loading ? <div className="new-search-empty"><Spin /><span>正在查询</span></div> : groups.length === 0 ? <div className="new-search-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`未找到“${keyword}”相关记录`} /></div> : <div className="new-result-groups">{groups.map((group) => <section className="new-result-group" key={group.name}><header><span className={`result-icon ${group.tone}`}>{group.icon}</span><strong>{group.name}</strong><Tag>{group.items.length}</Tag></header>{group.items.map((item, index) => <button type="button" key={`${item.table}-${item.id}-${index}`} onClick={() => onNavigate?.(item)}><span><b>{item.title || `${item.table} #${item.id}`}</b><small>{[item.subtitle, ...Object.entries(item.data || {}).slice(0, 3).map(([key, value]) => `${key}：${value}`)].filter(Boolean).join(' · ')}</small></span><ArrowRightOutlined /></button>)}</section>)}</div>}
  </section>
}
