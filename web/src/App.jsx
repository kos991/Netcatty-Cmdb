import React, { useEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import { api } from './api'
import ShellPreview from './ShellPreview'
import TopHeader from './modules/shell/TopHeader'
import GlobalSearch from './modules/search/GlobalSearch'
import CmdbCenter from './modules/cmdb/CmdbCenter'
import OrgPersonCenter from './modules/org/OrgPersonCenter'
import CustomFieldCenter from './modules/customfields/CustomFieldCenter'
import IPPoolCenter from './modules/ippool/IPPoolCenter'
import './modules/app-rebuild.css'

const PAGE_META = {
  search: ['全局查询', '跨终端资产、服务器、应用、履历和 IP 查询'],
  cmdb_center: ['CMDB 资产总账', '终端资产、物理服务器、系统应用和运维履历'],
  org_persons: ['组织与人员', '多级组织架构、部门花名册与名下资产穿透'],
  custom_fields: ['自定义字段', '扩展属性配置、动态表单与导出规则'],
  ip_pool: ['IP 规划池', '查看网段容量、网络分区、地址占用和关联资产'],
}

export default function App() {
  if (new URLSearchParams(window.location.search).get('preview') === 'shells') return <ShellPreview />

  const params = new URLSearchParams(window.location.search)
  const initial =
    params.get('view') === 'ip_pool'
      ? 'ip_pool'
      : params.get('view') === 'org_persons'
      ? 'org_persons'
      : params.get('view') === 'custom_fields'
      ? 'custom_fields'
      : params.get('view') === 'cmdb_center' || params.get('view') === 'cmdb'
      ? 'cmdb_center'
      : 'search'

  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)
  const [currentMenu, setCurrentMenu] = useState(initial)
  const [cmdbTab, setCmdbTab] = useState(params.get('sub') || 'resources')
  const [focusTarget, setFocusTarget] = useState(null)

  useEffect(() => {
    api.meta().then(setMeta).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCurrentMenu('search')
        window.setTimeout(() => document.querySelector('[data-global-search-input]')?.focus(), 0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const next = new URLSearchParams()
    next.set('view', currentMenu)
    if (currentMenu === 'cmdb_center' && cmdbTab) next.set('sub', cmdbTab)
    window.history.replaceState(null, '', `${window.location.pathname}?${next.toString()}`)
  }, [currentMenu, cmdbTab])

  const navigate = (key) => {
    if (key === 'cmdb_center') {
      if (!cmdbTab || cmdbTab === 'logs') setCmdbTab('resources')
      setCurrentMenu('cmdb_center')
      return
    }
    setCurrentMenu(key)
  }

  const onSearchNavigate = (result) => {
    if (result.tableKey === 'assets') setCmdbTab('assets')
    else if (result.tableKey === 'servers' || result.tableKey === 'server_apps') setCmdbTab('servers')
    else if (result.tableKey === 'asset_logs') setCmdbTab('logs')
    else {
      setCurrentMenu('ip_pool')
      setFocusTarget(result)
      return
    }
    setCurrentMenu('cmdb_center')
    setFocusTarget(result)
  }

  const renderPage = () => {
    if (currentMenu === 'ip_pool') return <IPPoolCenter focusTarget={focusTarget} />
    if (currentMenu === 'org_persons') return <OrgPersonCenter />
    if (currentMenu === 'custom_fields') return <CustomFieldCenter />
    if (currentMenu === 'cmdb_center') {
      return (
        <CmdbCenter
          meta={meta}
          tab={cmdbTab}
          onTabChange={setCmdbTab}
          focusTarget={focusTarget}
        />
      )
    }
    return <GlobalSearch onNavigate={onSearchNavigate} />
  }

  return (
    <div className="rebuild-app">
      <TopHeader
        current={currentMenu}
        onNavigate={navigate}
        onSearch={() => {
          setCurrentMenu('search')
          window.setTimeout(() => document.querySelector('[data-global-search-input]')?.focus(), 0)
        }}
      />
      <main className="rebuild-main">
        <div className="rebuild-content">
          {error ? (
            <Alert type="error" showIcon message={`初始化异常：${error}`} />
          ) : !meta ? (
            <div className="rebuild-loading">
              <Spin />
            </div>
          ) : (
            renderPage()
          )}
        </div>
      </main>
    </div>
  )
}
