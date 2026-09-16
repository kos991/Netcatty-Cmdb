import React, { useState } from 'react'
import { Alert, Button, Empty, Input, Skeleton, Tag } from 'antd'
import { ArrowRightOutlined, ClusterOutlined, DatabaseOutlined, HistoryOutlined, LaptopOutlined, SearchOutlined, AppstoreOutlined, TeamOutlined } from '@ant-design/icons'
import { api } from '../../api'
import './search.css'

const GROUPS = [
  { key: 'assets', name: '终端资产', icon: <LaptopOutlined /> },
  { key: 'cmdb_assets', name: '基础设施资源', icon: <DatabaseOutlined /> },
  { key: 'server_apps', name: '业务系统', icon: <AppstoreOutlined /> },
  { key: 'persons', name: '组织与人员', icon: <TeamOutlined /> },
  { key: 'asset_logs', name: '运维履历', icon: <HistoryOutlined /> },
  { key: 'ip_pool', name: 'IP 规划池', icon: <ClusterOutlined /> },
]

export default function GlobalSearch({ onNavigate }) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const groups = GROUPS.map((group) => ({ ...group, items: results.filter((item) => item.tableKey === group.key) }))

  const search = async () => {
    const query = keyword.trim()
    if (!query) { setResults([]); setSearched(false); setError(''); return }
    setLoading(true)
    try { const response = await api.search(query, 50); setResults(response.results || []); setSearched(true); setError('') }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return <section className="new-search-page">
    <div className="cmdb-page-heading"><h2>全局查询</h2>{searched && <span>{results.length} 条结果</span>}</div>
    <div className="new-search-box"><Input data-global-search-input allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} onPressEnter={search} prefix={<SearchOutlined />} placeholder="姓名、资产编号、SN、IP、房间、系统名称" /><Button type="primary" icon={<SearchOutlined />} onClick={search} loading={loading}>查询</Button></div>
    <div className="new-search-scope">{GROUPS.map((group) => <Tag key={group.key}>{group.name}</Tag>)}</div>
    {error && <Alert type="error" showIcon message="全局查询失败" description={error} action={<Button onClick={search}>重试</Button>} />}
    {loading && !results.length ? <Skeleton active paragraph={{ rows: 6 }} /> : !searched ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无查询结果" />
      : <div className="new-result-groups">{groups.map((group) => <section className="new-result-group" key={group.key}>
        <header><span className="result-icon">{group.icon}</span><strong>{group.name}</strong><Tag>{group.items.length}</Tag></header>
        {!group.items.length ? <div className="cmdb-search-no-match">无匹配记录</div> : group.items.map((item) => <button type="button" key={`${item.tableKey}-${item.id}`} onClick={() => onNavigate?.(item)}>
          <span><b>{item.title || `#${item.id}`}</b><small>{[item.subtitle, item.department, item.status, ...Object.entries(item.data || {}).slice(0, 3).map(([key, value]) => `${key}：${value}`)].filter(Boolean).join(' · ')}</small></span><ArrowRightOutlined />
        </button>)}
      </section>)}</div>}
  </section>
}
