import React, { useCallback, useEffect, useRef, useState } from 'react'
import '@ant-design/v5-patch-for-react-19'
import { Alert, Button, ConfigProvider, Skeleton, Tabs, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { api } from './api'
import { cmdbApi } from './cmdb/cmdbApi'
import { MODULES, panelKeyFor, resolveSearchTarget } from './cmdbWorkspaceState'
import ModuleTabs from './components/ModuleTabs'
import GlobalSearch from './modules/search/GlobalSearch'
import AssetCenter from './AssetCenter'
import CmdbResources from './cmdb/CmdbResources'
import ServerCenter from './ServerCenter'
import OrgPersonCenter from './modules/org/OrgPersonCenter'
import IPManager from './IPManager'
import Dashboard from './Dashboard'
import AuditLogs from './AuditLogs'
import CmdbConfig from './cmdb/CmdbConfig'
import './app.css'
import './cmdb/cmdb.css'
import './cmdb/resource-ledger.css'
import './modules/app-rebuild.css'
import './cmdb-workspace.css'

function ModulePanel({ hidden, children }) {
  const panel = useRef(null)
  return <section ref={panel} hidden={hidden} className="cmdb-module-panel">
    <ConfigProvider getPopupContainer={() => panel.current}>{children}</ConfigProvider>
  </section>
}

export default function CmdbWorkspace({
  activeModule,
  onModuleChange,
  onProjectNameChange,
  nativeShell = false,
} = {}) {
  const root = useRef(null)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [internalModule, setInternalModule] = useState('search')
  const [operationsTab, setOperationsTab] = useState('dashboard')
  const [targets, setTargets] = useState({})
  const [visited, setVisited] = useState(new Set(['search']))
  const [hostTheme, setHostTheme] = useState({})
  const module = activeModule ?? internalModule
  const setModule = useCallback((nextModule) => {
    if (activeModule === undefined) setInternalModule(nextModule)
    onModuleChange?.(nextModule)
  }, [activeModule, onModuleChange])
  const panelKey = panelKeyFor(module)

  const initialize = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (window.netcatty) {
        if (typeof window.netcatty.cmdbStatus !== 'function') throw new Error('Cmdb 原生状态通道不可用')
        const status = await window.netcatty.cmdbStatus()
        if (!status?.available) throw new Error([status?.error || 'Cmdb 服务未启动', status?.logPath].filter(Boolean).join('；'))
      }
      const [nextMeta, projects] = await Promise.all([api.meta(), cmdbApi.listProjects()])
      setMeta(nextMeta)
      onProjectNameChange?.(projects.list?.[0]?.name || '默认项目')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [onProjectNameChange])

  useEffect(() => { initialize() }, [initialize])
  useEffect(() => { setVisited((previous) => new Set([...previous, panelKey])) }, [panelKey])

  useEffect(() => {
    const updateTheme = () => {
      const css = getComputedStyle(root.current)
      const color = (name, fallback) => `hsl(${css.getPropertyValue(name).trim() || fallback})`
      const dark = document.documentElement.classList.contains('dark')
      setHostTheme({
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: color('--primary', '213 85% 48%'), colorInfo: color('--primary', '213 85% 48%'),
          colorBgBase: color('--background', '0 0% 100%'), colorBgContainer: color('--card', '0 0% 100%'),
          colorBgElevated: color('--popover', '0 0% 100%'), colorText: color('--foreground', '0 0% 13%'),
          colorTextSecondary: color('--muted-foreground', '0 0% 45%'), colorBorder: color('--border', '0 0% 87%'),
          borderRadius: 4, fontSize: 13, controlHeight: 32,
        },
        components: { Button: { primaryShadow: 'none' }, Table: { cellPaddingBlockSM: 8 } },
      })
    }
    updateTheme()
    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => observer.disconnect()
  }, [])

  const navigateSearch = (result) => {
    if (result.tableKey === 'servers') {
      setModule('systems')
      setTargets((previous) => ({ ...previous, systems: { ...result } }))
      return
    }
    const target = resolveSearchTarget(result)
    if (!target) return
    setModule(target.module)
    if (result.tableKey === 'asset_logs') setOperationsTab('audit')
    const key = panelKeyFor(target.module)
    setTargets((previous) => ({ ...previous, [key]: { ...target.focusTarget } }))
  }

  useEffect(() => {
    const handleKey = (event) => {
      if (!root.current?.getClientRects().length) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setModule('search')
        requestAnimationFrame(() => root.current?.querySelector('[data-global-search-input]')?.focus())
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const panels = [
    ['search', <GlobalSearch onNavigate={navigateSearch} />],
    ['assets', <AssetCenter meta={meta} focusTarget={targets.assets} onNavigate={navigateSearch} />],
    ['infrastructure', <CmdbResources meta={meta} scope="infrastructure" title="基础设施资源" focusTarget={targets.infrastructure} />],
    ['systems', <ServerCenter meta={meta} section="apps" focusTarget={targets.systems} />],
    ['people', <OrgPersonCenter focusTarget={targets.people} onNavigate={navigateSearch} />],
    ['ip', <IPManager meta={meta} focusTarget={targets.ip} onNavigate={navigateSearch} />],
    ['operations', <Tabs activeKey={operationsTab} onChange={setOperationsTab} items={[
      { key: 'dashboard', label: '统计概览', children: <Dashboard /> },
      { key: 'audit', label: '运维履历', children: <AuditLogs meta={meta} focusTarget={targets.operations} /> },
    ]} />],
    ['config', <CmdbConfig />],
  ]

  return <div ref={root} className={`cmdb-workspace${nativeShell ? ' cmdb-workspace-native' : ''}`}>
    <ConfigProvider locale={zhCN} theme={hostTheme} getPopupContainer={(trigger) => trigger?.closest('.cmdb-workspace') || root.current}>
      {!nativeShell && <ModuleTabs items={MODULES} activeKey={module} onChange={setModule} label="Cmdb 模块" />}
      <main className="cmdb-workspace-content">
        {error ? <Alert type="error" showIcon message="Cmdb 服务不可用" description={error} action={<Button onClick={initialize} loading={loading}>重试</Button>} />
          : !meta ? <Skeleton active paragraph={{ rows: 8 }} />
          : panels.map(([key, content]) => visited.has(key) && <ModulePanel key={key} hidden={panelKey !== key}>{content}</ModulePanel>)}
      </main>
    </ConfigProvider>
  </div>
}
