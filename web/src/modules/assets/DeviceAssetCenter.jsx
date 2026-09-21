import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Input, Skeleton, Tabs, Tag } from 'antd'
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  DatabaseOutlined,
  LaptopOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { api } from '../../api'
import AssetCenter from '../../AssetCenter'
import CmdbResources from '../../cmdb/CmdbResources'
import ServerCenter from '../../ServerCenter'
import { filterDeviceAssetResults, resolveSearchTarget } from '../../cmdbWorkspaceState'
import './device-assets.css'

const SEARCH_GROUPS = [
  { key: 'assets', label: '终端资产', icon: <LaptopOutlined /> },
  { key: 'cmdb_assets', label: '基础设施', icon: <DatabaseOutlined /> },
  { key: 'server_apps', label: '业务系统', icon: <AppstoreOutlined /> },
]

function DeviceAssetSearch({ onNavigate }) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const groups = useMemo(() => SEARCH_GROUPS.map((group) => ({
    ...group,
    items: results.filter((item) => item.tableKey === group.key),
  })), [results])

  const search = async () => {
    const query = keyword.trim()
    if (!query) {
      setResults([])
      setSearched(false)
      setError('')
      return
    }
    setLoading(true)
    try {
      const response = await api.search(query, 50)
      setResults(filterDeviceAssetResults(response.results))
      setSearched(true)
      setError('')
    } catch (searchError) {
      setError(searchError.message)
    } finally {
      setLoading(false)
    }
  }

  return <section className="device-asset-search" aria-label="设备资产搜索">
    <div className="device-asset-search-row">
      <Input
        data-device-asset-search-input
        allowClear
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        onPressEnter={search}
        prefix={<SearchOutlined />}
        placeholder="搜索资产编号、SN、IP、设备名称或系统名称"
      />
      <Button type="primary" icon={<SearchOutlined />} onClick={search} loading={loading}>搜索</Button>
    </div>
    <div className="device-asset-search-scope">
      {SEARCH_GROUPS.map((group) => <Tag key={group.key}>{group.label}</Tag>)}
    </div>
    {error && <Alert type="error" showIcon message="设备资产搜索失败" description={error} action={<Button onClick={search}>重试</Button>} />}
    {loading && !results.length && <Skeleton className="device-asset-search-loading" active paragraph={{ rows: 3 }} />}
    {searched && !loading && <div className="device-asset-results">
      {!results.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`未找到“${keyword.trim()}”相关资产`} /> : groups.map((group) => group.items.length > 0 && <section key={group.key} className="device-asset-result-group">
        <header><span>{group.icon}</span><strong>{group.label}</strong><Tag>{group.items.length}</Tag></header>
        {group.items.map((item) => <button type="button" key={`${item.tableKey}-${item.id}`} onClick={() => onNavigate?.(item)}>
          <span>
            <b>{item.title || `#${item.id}`}</b>
            <small>{[item.subtitle, item.department, item.status, ...Object.entries(item.data || {}).slice(0, 3).map(([key, value]) => `${key}：${value}`)].filter(Boolean).join(' · ')}</small>
          </span>
          <ArrowRightOutlined />
        </button>)}
      </section>)}
    </div>}
  </section>
}

export default function DeviceAssetCenter({ meta, focusTarget, onNavigate }) {
  const [activeTab, setActiveTab] = useState('terminals')

  useEffect(() => {
    const target = resolveSearchTarget(focusTarget)
    if (target?.assetTab) setActiveTab(target.assetTab)
  }, [focusTarget])

  return <div className="device-asset-center">
    <div className="cmdb-page-heading"><h2>设备资产</h2></div>
    <DeviceAssetSearch onNavigate={onNavigate} />
    <Tabs
      className="device-asset-tabs"
      activeKey={activeTab}
      onChange={setActiveTab}
      items={[
        { key: 'terminals', label: '终端资产', children: <AssetCenter meta={meta} focusTarget={focusTarget} onNavigate={onNavigate} hideKeywordSearch /> },
        { key: 'infrastructure', label: '基础设施', children: <CmdbResources meta={meta} scope="infrastructure" title="基础设施资源" focusTarget={focusTarget} hideKeywordSearch /> },
        { key: 'systems', label: '业务系统', children: <ServerCenter meta={meta} section="apps" focusTarget={focusTarget} hideKeywordSearch /> },
      ]}
    />
  </div>
}
