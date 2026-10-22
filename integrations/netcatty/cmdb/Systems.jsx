import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, Globe, History, KeyRound, MapPin, Network, RotateCcw, Server, Settings2, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { allPages, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { isApplicationHostInfrastructure } from './state'
import { ActionIcon, DataTable, EmptyState, ErrorBanner, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'
import AssetTransferMenu from './AssetTransferMenu'
import NetcattyConnectionFields, { useNetcattyConnectionEditor } from './NetcattyConnectionFields'
import NetcattyLinks from './NetcattyLinks'
import { AssetPanel, AssetPanelFields, AssetPanelSave, AssetPanelSection, useAssetPanelLayout } from './AssetPanel'
import AssetRowActions from './AssetRowActions'
import { AssetDraftDiscardDialog, AssetFormPanel, AssetFormTabs, useAssetDraftGuard } from './AssetFormTabs'
import AssetCreateDialog from './AssetCreateDialog'
import { AssetDetailTabBar } from './AssetDetailTabs'
import AssetFilterPicker, { useAssetFilterSelection } from './AssetFilterPicker'
import { applicationNetworkPresentation, maskCredentialText, networkTypeColor, visibleAssetColumnKeys, UNCONFIGURED_FILTER_VALUE } from './assetTableModel'
import { LogTimeline } from './TerminalAssets'
import InfrastructureQuickConnect from './InfrastructureQuickConnect'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { toast } from '@/components/ui/toast'

const APP_FIELDS = textFields([['app_name', '系统名称'], ['version', '版本'], ['provider', '供应商'], ['port', '端口'], ['access_url', '访问入口'], ['middleware', '中间件'], ['database_info', '数据库'], ['owner', '负责人'], ['department', '所属部门'], ['deployment_location', '部署位置'], ['description', '说明', 'textarea'], ['remark', '备注', 'textarea']]).map((f) => ({ ...f, required: ['app_name'].includes(f.key) }))
const SYSTEM_TABS = [
  { key: 'system', label: '系统信息', icon: Settings2 },
  { key: 'network', label: '网络配置', icon: Network },
  { key: 'usage', label: '使用与归属', icon: MapPin },
  { key: 'hosting', label: '承载设备', icon: Server },
  { key: 'records', label: '运维履历', icon: History },
  { key: 'relations', label: '凭证中心', icon: KeyRound },
]
const SYSTEM_FORM_TABS = [
  { key: 'basic', label: '基本信息' },
  { key: 'ownership', label: '归属与承载' },
  { key: 'network', label: '网络与系统' },
  { key: 'credentials', label: '凭证中心' },
]
const loadDirectory = () => allPages(api.infrastructure, { scope: 'infrastructure' })
const loadTaxonomy = async () => {
  const categories = await api.taxonomy('application-categories')
  return { categories: categories.list || [] }
}

function LegacyServerPanel({ id, onClose, onOpenApplication, expanded, onExpandedChange, onWidthChange }) {
  const loader = useCallback(() => api.server(id), [id])
  const query = useQuery(loader)
  const server = query.data?.server
  return <AssetPanel open expanded={expanded} onExpandedChange={onExpandedChange} onWidthChange={onWidthChange} onClose={onClose} title={server?.device_name || '历史承载服务器'} subtitle={server?.asset_code} status={server?.status} icon={Server}>
    {query.error ? <ErrorBanner message={query.error} onRetry={query.reload} /> : !server ? <p className="text-xs text-muted-foreground">正在加载承载设备…</p> : <>
      <AssetPanelSection title="实际承载设备" icon={Server}><AssetPanelFields items={[["设备名称", server.device_name], ['资产编号', server.asset_code], ['品牌型号', server.brand_model], ['序列号', server.serial_number], ['位置', server.location], ['机柜 U 位', server.rack_unit], ['CPU', server.cpu_info], ['内存', server.memory_info], ['磁盘', server.disk_info], ['管理 IP', server.mgmt_ip], ['业务 IP', server.biz_ip], ['操作系统', server.os_type], ['备注', server.remark]]} /></AssetPanelSection>
      <AssetPanelSection title="承载业务系统" icon={Workflow}>{query.data.apps?.length ? <div className="space-y-1">{query.data.apps.map(item => <Button key={item.id} variant="link" className="block h-auto p-0 text-xs" onClick={() => onOpenApplication(item)}>{item.app_name || `业务系统 #${item.id}`}</Button>)}</div> : <EmptyState label="暂无关联业务系统" />}</AssetPanelSection>
    </>}
  </AssetPanel>
}

export default function Systems({ keyword, focusTarget, meta, command, leadingControl, headerActions, filtersExpanded = true, onFiltersExpandedChange, onPanelOpenChange, onNavigate }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [provider, setProvider] = useState('')
  const [owner, setOwner] = useState('')
  const [department, setDepartment] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [hostId, setHostId] = useState('')
  const [hostLinked, setHostLinked] = useState('')
  const [networkType, setNetworkType] = useState('')
  const filterItems = [
    { key: 'app_type', label: '系统类型' },
    { key: 'provider', label: '供应商' }, { key: 'owner', label: '负责人' },
    { key: 'department', label: '部门' },
    { key: 'host_id', label: '承载服务器' }, { key: 'host_linked', label: '承载关联' },
    { key: 'network_type', label: '网络类型' }, { key: 'status', label: '状态' },
    { key: 'include_archived', label: '含已注销' },
  ]
  const { visible: visibleFilters, toggle: toggleFilter } = useAssetFilterSelection('systems', filterItems, filterItems.map((item) => item.key), (update) => {
    const current = { app_type: type, provider, owner, department, host_id: hostId, host_linked: hostLinked, network_type: networkType, status, include_archived: includeArchived }
    const next = update(current)
    setType(next.app_type)
    setProvider(next.provider)
    setOwner(next.owner)
    setDepartment(next.department)
    setIncludeArchived(Boolean(next.include_archived))
    setHostId(next.host_id)
    setHostLinked(next.host_linked)
    setNetworkType(next.network_type)
    setStatus(next.status)
  }, () => setPage(1))
  const [editor, setEditor] = useState(null)
  const [editorBaseline, setEditorBaseline] = useState(null)
  const [formTab, setFormTab] = useState('basic')
  const [values, setValues] = useState({})
  const [detail, setDetail] = useState(null)
  const [legacyServerId, setLegacyServerId] = useState(null)
  const [panelExpanded, setPanelExpanded] = useState(false)
  const [detailTab, setDetailTab] = useState('system')
  const [archiving, setArchiving] = useState(null)
  useEffect(() => { setDetailTab(detail?.initialTab || 'system') }, [detail?.id, detail?.initialTab])
  useEffect(() => { setPanelExpanded(false) }, [detail?.id, editor, legacyServerId])
  const panelLayout = useAssetPanelLayout(!!detail || !!legacyServerId || !!editor?.record.id, panelExpanded, onPanelOpenChange)
  const handledCommandId = useRef(null)
  const action = useAction()
  const netcatty = useNetcattyConnectionEditor('application')
  const beginNetcattyConnection = netcatty.begin
  const { openBrowser } = useNetcattyDirectory()
  const openAccessUrl = (row) => action.run(async () => {
    const url = String(row.access_url || '').trim()
    if (!/^https?:\/\//i.test(url)) { toast.error('访问地址需以 http 或 https 开头'); return }
    const result = await api.netcattyLinks({ asset_type: 'application', asset_id: row.id })
    const primary = (result.list || []).find((link) => link.is_primary && link.host_id)
    if (!primary) { toast.error('请先在凭证中心关联可访问该地址的 Netcatty 主机'); return }
    openBrowser(primary.host_id, url)
  })
  const accessUrlNode = (row) => {
    const url = String(row.access_url || '').trim()
    return <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs"><span className="min-w-0 select-text break-all">{url || '未配置'}</span>{/^https?:\/\//i.test(url) ? <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded p-0 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`在 Netcatty 浏览器中打开 ${url}`} title={`在 Netcatty 浏览器中打开 ${url}`} disabled={action.busy} onClick={(event) => { event.stopPropagation(); openAccessUrl(row) }}><Globe size={13} aria-hidden="true" /></Button> : null}</span>
  }
  const directory = useQuery(loadDirectory, [])
  const networkDefinitions = useDirectory(async () => (await api.config('network-types')).list || [])
  const loadAppDirectory = useCallback(() => allPages(api.apps), [])
  const appDirectory = useQuery(loadAppDirectory, [])
  const taxonomy = useDirectory(loadTaxonomy)
  const categories = useMemo(() => taxonomy.data?.categories || [], [taxonomy.data?.categories])
  const appRecords = useMemo(() => appDirectory.data || [], [appDirectory.data])
  const providerOptions = useMemo(() => [...new Set(appRecords.map((item) => item.provider).filter(Boolean))], [appRecords])
  const ownerOptions = useMemo(() => [...new Set(appRecords.map((item) => item.owner).filter(Boolean))], [appRecords])
  const networkOptions = useMemo(() => [...new Set(appRecords.map((item) => item.network_type).filter(Boolean))], [appRecords])
  const departmentOptions = useMemo(() => [...new Set(appRecords.map((item) => item.department).filter(Boolean))], [appRecords])
  const includeArchivedParam = includeArchived || /注销|归档/.test(status) ? 'true' : ''
  const loader = useCallback(() => api.apps({ keyword, app_type: type, provider, owner, department, host_id: hostId, host_linked: hostLinked, network_type: networkType, status, include_archived: includeArchivedParam, page, page_size: pageSize }), [keyword, type, provider, owner, department, hostId, hostLinked, networkType, status, includeArchivedParam, page, pageSize])
  const query = useQuery(loader)
  const detailLoader = useCallback(async () => {
    if (!detail) return null
    const { app, logs = [] } = await api.app(detail.id)
    const host = app.cmdb_asset_id ? await api.infrastructureAsset(app.cmdb_asset_id) : app.server_id ? await api.server(app.server_id) : null
    const ips = app.service_ip ? await api.ipEntries({ keyword: app.service_ip, page: 1, page_size: 20 }) : { list: [] }
    const legacyHost = host?.server
    return { app, logs, infrastructure: host?.asset || (legacyHost ? { ...legacyHost, name: legacyHost.device_name, device_type: '历史承载服务器', legacy: true } : null), ipam: ips.list?.find(item => item.ip === app.service_ip) }
  }, [detail])
  const detailQuery = useQuery(detailLoader)
  const serverDirectory = (directory.data || []).filter((asset) => isApplicationHostInfrastructure(asset))
  useEffect(() => { setPage(1) }, [keyword])
  useEffect(() => { if (focusTarget?.tableKey === 'servers') setLegacyServerId(focusTarget.id) }, [focusTarget])
  useEffect(() => { if (focusTarget?.tableKey === 'server_apps') setDetail(focusTarget) }, [focusTarget])
  const open = useCallback((record = {}) => { void beginNetcattyConnection(record.id || 0); const next = { status: '正常运行', app_type: categories[0]?.name || '', ...record }; setEditor({ record }); setEditorBaseline(next); setValues(next); setFormTab('basic') }, [beginNetcattyConnection, categories])
  const refresh = useCallback(() => { query.reload(); appDirectory.reload(); directory.reload(); taxonomy.reload(); detailQuery.reload() }, [appDirectory, detailQuery, directory, query, taxonomy])
  useEffect(() => {
    if (!command?.id || command?.tab !== 'systems' || handledCommandId.current === command.id) return
    handledCommandId.current = command.id
    if (command.type === 'create') open()
    if (command.type === 'refresh') refresh()
  }, [command, open, refresh])
  const fields = [
    ...APP_FIELDS, { key: 'cmdb_asset_id', label: '承载设备（可选）', numeric: true, options: choices(serverDirectory.map((asset) => ({ value: asset.id, label: `${asset.asset_code || '未配置编码'} · ${asset.name || asset.category_name || asset.device_type || ''}` })), '不关联设备') },
    { key: 'service_ip', label: '业务 IP（非承载设备管理 IP）' },
    { key: 'deployment', label: '部署方式', options: choices(['虚拟机部署', '物理机部署', '容器部署', '托管服务', '待部署', ...[values.deployment].filter(Boolean)]) },
    { key: 'app_type', label: '系统类型', required: true, searchable: true, options: choices([...new Set([...categories.map((item) => item.name), values.app_type].filter(Boolean))]) },
    { key: 'status', label: '状态', options: choices([...new Set([...(meta.app_statuses || []), '正常运行', '维护中', '待上线', '已停用', '已注销'])]) },
  ]
  // 列表、标签和详情共用服务端按系统自身 service_ip 解析的网络类型。
  const applicationNetworkLabel = (row = {}) => applicationNetworkPresentation(row).networkType
  const appColumns = [
    { key: 'name_code', label: '系统名称', headerTitle: '系统名称', headerClassName: 'cmdb-asset-identity-header', width: 16, sticky: 'left', render: (_, row) => <div className="flex min-w-0 items-center gap-1.5"><Button type="button" variant="link" title={row.app_name || '未命名系统'} className="h-auto min-w-0 max-w-full justify-start truncate p-0 text-left text-xs font-semibold" onClick={() => setDetail({ tableKey: 'server_apps', id: row.id })}>{row.app_name || '未命名系统'}</Button><span className="h-2 w-2 shrink-0 rounded-full border border-border/70" style={{ backgroundColor: networkTypeColor(applicationNetworkLabel(row), networkDefinitions.data || []) }} title={`网络类型：${applicationNetworkLabel(row)}`} aria-label={`网络类型：${applicationNetworkLabel(row)}`} /></div> },
    { key: 'app_type', label: '系统类型', width: 8, render: (value) => <span className="block truncate" title={value || '未配置'}>{value || '未配置'}</span> },
    { key: 'version', label: '版本', width: 7, render: (value) => <span className="block truncate" title={value || '未配置'}>{value || '未配置'}</span> },
    { key: 'owner', label: '负责人', width: 8, render: (value) => { const text = maskCredentialText(value); return <span className="block truncate" title={text || '未配置'}>{text || '未配置'}</span> } },
    { key: 'access_url', label: '访问地址', width: 22, render: (value, row) => <div className="flex min-w-0 items-center gap-1.5"><span data-system-access-url className="block min-w-0 select-text whitespace-normal break-words font-mono text-[11px]" style={{ overflowWrap: 'anywhere' }} title={value || '未配置'}>{value || '未配置'}</span>{value && /^https?:\/\//i.test(value) ? <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded p-0 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`在 Netcatty 浏览器中打开 ${value}`} title={`在 Netcatty 浏览器中打开 ${value}`} disabled={action.busy} onClick={(event) => { event.stopPropagation(); openAccessUrl(row) }}><Globe size={13} aria-hidden="true" /></Button> : null}</div> },
    { key: 'service_ip', label: '业务 IP', width: 13, render: (_, row) => { const network = applicationNetworkPresentation(row); return <div className="min-w-0 truncate font-mono text-xs" title={network.ip || '未关联业务 IP'}>{network.ip || '未关联业务 IP'}</div> } },
    { key: 'network_type', label: '网络类型', width: 7, render: (_, row) => <span className="block truncate text-xs text-muted-foreground" title={applicationNetworkLabel(row)}>{applicationNetworkLabel(row)}</span> },
    { key: 'host', label: '承载设备', width: 12, render: (_, row) => row.cmdb_asset_id ? <Button variant="link" title={row.server_name || '查看承载设备'} className="h-auto max-w-full truncate p-0 text-xs" onClick={() => onNavigate?.({ tableKey: 'cmdb_assets', id: row.cmdb_asset_id })}>{row.server_name || '查看承载设备'}</Button> : row.server_id ? <Button variant="link" title={row.server_name || '查看历史承载服务器'} className="h-auto max-w-full truncate p-0 text-xs" onClick={() => setDetail({ tableKey: 'server_apps', id: row.id, initialTab: 'hosting' })}>{row.server_name || '历史承载服务器'}</Button> : '未关联' },
    { key: 'status', label: '状态', width: 9, sticky: 'right', render: (v) => <StatusPill tone={statusTone(v)}>{v || '未配置'}</StatusPill> },
    { key: 'actions', label: '操作', width: 80, sticky: 'right', className: 'text-right', render: (_, row) => <AssetRowActions name={row.app_name || ''} onEdit={() => open(row)} onDetail={() => setDetail({ tableKey: 'server_apps', id: row.id })} onArchive={() => setArchiving(row)} /> },
  ]
  const appColumnsByKey = Object.fromEntries(appColumns.map((column) => [column.key, column]))
  const visibleColumns = visibleAssetColumnKeys('system').map((key) => appColumnsByKey[key]).filter(Boolean)
  const closeEditor = useCallback(() => { setEditor(null); setEditorBaseline(null) }, [])
  const draftGuard = useAssetDraftGuard(editorBaseline, values, closeEditor)
  const save = () => action.run(async () => {
    validateFields(fields, values)
    const result = editor.record.id ? (await api.updateApp(editor.record.id, values), { id: editor.record.id }) : await api.createApp(values)
    if (!editor.record.id) setEditor(current => ({ ...current, record: { ...values, id: result.id } }))
    await netcatty.persist(result.id)
    closeEditor()
    refresh()
  }, '已保存')
  const app = detailQuery.data?.app
  const editorTabs = SYSTEM_FORM_TABS
  const editorBody = editor ? <>
    <AssetFormPanel active={formTab === 'basic'} section="basic"><AssetPanelSection title="基本信息" icon={Settings2}><Fields fields={fields.filter(({ key }) => ['app_name', 'app_type', 'version', 'provider', 'status'].includes(key))} value={values} onChange={setValues} /></AssetPanelSection></AssetFormPanel>
    <AssetFormPanel active={formTab === 'ownership'} section="ownership"><AssetPanelSection title="归属与承载" icon={MapPin}><Fields fields={fields.filter(({ key }) => ['owner', 'department', 'cmdb_asset_id', 'deployment_location', 'description', 'remark'].includes(key))} value={values} onChange={setValues} /></AssetPanelSection></AssetFormPanel>
    <AssetFormPanel active={formTab === 'network'} section="network"><AssetPanelSection title="网络与系统" icon={Network}><Fields fields={fields.filter(({ key }) => ['deployment', 'service_ip', 'port', 'access_url', 'middleware', 'database_info'].includes(key))} value={values} onChange={setValues} /><p className="text-[11px] text-muted-foreground">业务 IP 独立于承载设备；网络类型由该地址所属的地址池确认。</p></AssetPanelSection></AssetFormPanel>
    <AssetFormPanel active={formTab === 'credentials'} section="credentials"><AssetPanelSection title="凭证中心" icon={KeyRound}><NetcattyConnectionFields asset={{ name: values.app_name, ip: values.service_ip }} value={netcatty.connection} onChange={netcatty.setConnection} hosts={netcatty.hosts} credentials={netcatty.credentials} loading={netcatty.loading} error={netcatty.error} /></AssetPanelSection></AssetFormPanel>
  </> : null
  return <div className="cmdb-asset-page flex min-h-0 min-w-0 flex-1 flex-col">
    {headerActions && createPortal(<><AssetFilterPicker expanded={filtersExpanded} onExpandedChange={onFiltersExpandedChange} items={filterItems} visible={visibleFilters} onToggle={toggleFilter} /><AssetTransferMenu importTitle="设备信息导入" importLabel="导入设备信息" importer={api.importSangfor} onImported={refresh} exporter={() => api.exportApps({ keyword, app_type: type, provider, owner, department, host_id: hostId, host_linked: hostLinked, network_type: networkType, status, include_archived: includeArchivedParam })} /></>, headerActions)}
    <Toolbar className="cmdb-asset-toolbar" hidden={!filtersExpanded}>
    {leadingControl}
    {visibleFilters.includes('app_type') && <SelectControl prefix="类型" className="w-40" value={type} onChange={(v) => { setType(v); setPage(1) }} options={choices([{ value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }, ...categories.map((item) => ({ value: item.name, label: item.name }))], '全部')} />}{visibleFilters.includes('provider') && <SelectControl prefix="供应商" className="w-40" value={provider} onChange={(v) => { setProvider(v); setPage(1) }} options={choices([...providerOptions, { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}{visibleFilters.includes('owner') && <SelectControl prefix="负责人" className="w-36" value={owner} onChange={(v) => { setOwner(v); setPage(1) }} options={choices([...ownerOptions, { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}{visibleFilters.includes('host_id') && <SelectControl prefix="承载" className="w-44" value={hostId} onChange={(v) => { setHostId(v); setPage(1) }} options={choices(serverDirectory.map((asset) => ({ value: asset.id, label: asset.asset_code || asset.name || '未配置编码' })), '全部')} />}{visibleFilters.includes('host_linked') && <SelectControl prefix="关联" className="w-36" value={hostLinked} onChange={(v) => { setHostLinked(v); setPage(1) }} options={choices([{ value: 'linked', label: '已关联' }, { value: 'unlinked', label: '未关联' }], '全部')} />}{visibleFilters.includes('network_type') && <SelectControl prefix="网络" className="w-36" value={networkType} onChange={(v) => { setNetworkType(v); setPage(1) }} options={choices([...networkOptions, { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}{visibleFilters.includes('status') && <SelectControl prefix="状态" className="w-36" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={choices([...(meta.app_statuses || []), { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
    {visibleFilters.includes('department') && <SelectControl prefix="部门" className="w-36" value={department} onChange={(value) => { setDepartment(value); setPage(1) }} options={choices([...departmentOptions, { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
    {visibleFilters.includes('include_archived') && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={includeArchived} onChange={(event) => { setIncludeArchived(event.target.checked); setPage(1) }} />含已注销</label>}
    <ActionIcon label="重置筛选" onClick={() => { setType(''); setProvider(''); setOwner(''); setDepartment(''); setHostId(''); setHostLinked(''); setNetworkType(''); setStatus(''); setIncludeArchived(false); setPage(1) }}><RotateCcw size={15} /></ActionIcon>
  </Toolbar>
    {(query.error || directory.error || taxonomy.error || appDirectory.error) && <ErrorBanner message={query.error || directory.error || taxonomy.error || appDirectory.error} onRetry={refresh} />}
    <DataTable assetLayout loading={query.loading} rows={query.error ? [] : query.data?.list || []} columns={visibleColumns} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    {detail && !editor && !legacyServerId && <AssetPanel open expanded={panelExpanded} onExpandedChange={setPanelExpanded} onWidthChange={panelLayout.onWidthChange} onClose={() => setDetail(null)} title={app?.app_name || detail.app_name || '业务系统'} subtitle={[app?.app_type].filter(Boolean).join(' · ')} status={app?.status} icon={Workflow} onEdit={app ? () => open(app) : undefined} actions={app ? <ActionIcon label="注销归档" onClick={() => setArchiving(app)}><Archive size={15} /></ActionIcon> : null} tabs={<AssetDetailTabBar tabs={SYSTEM_TABS} value={detailTab} onChange={setDetailTab} panelId="system-detail-content" dataSection="system-detail-tabs" />}>
      {detailQuery.error ? <ErrorBanner message={detailQuery.error} onRetry={detailQuery.reload} /> : detailQuery.loading && !app ? <p className="text-xs text-muted-foreground">正在加载系统档案…</p> : null}
      {app && <div id="system-detail-content" role="tabpanel" aria-labelledby={`system-detail-tabs-${detailTab}`}>
        {detailTab === 'system' ? <AssetPanelSection title="系统信息" icon={Settings2}><AssetPanelFields items={[['系统名称', app.app_name], ['系统类型', app.app_type], ['版本', app.version], ['供应商', app.provider], ['部署方式', app.deployment], ['中间件', app.middleware], ['数据库', app.database_info], ['状态', app.status]]} /></AssetPanelSection> : null}
        {detailTab === 'network' ? <AssetPanelSection title="网络配置" icon={Network}><AssetPanelFields items={[[ '业务 IP', app.service_ip ? <span className="inline-flex items-center gap-1 font-mono">{app.service_ip}<InfrastructureQuickConnect asset={app} address={app.service_ip} assetType="application" /></span> : '未配置'], ['网络类型', applicationNetworkLabel(app)], ['端口', app.port], ['访问入口', accessUrlNode(app)], ['网络类型来源', applicationNetworkLabel(app) === '未配置' ? '未匹配地址池' : '业务 IP 所属 IPAM 地址池'], ['IPAM', app.service_ip ? detailQuery.data.ipam ? '已纳入' : '未纳入' : '无业务 IP']]} />{detailQuery.data.ipam ? <Button variant="link" onClick={() => onNavigate?.({ tableKey: 'ip_pool', id: detailQuery.data.ipam.id, title: detailQuery.data.ipam.ip, subtitle: detailQuery.data.ipam.subnet })}>查看 IPAM 地址</Button> : null}</AssetPanelSection> : null}
        {detailTab === 'usage' ? <AssetPanelSection title="使用与归属" icon={MapPin}><AssetPanelFields items={[['负责人', maskCredentialText(app.owner)], ['所属部门', app.department], ['部署位置', app.deployment_location], ['说明', maskCredentialText(app.description)], ['备注', maskCredentialText(app.remark)]]} /></AssetPanelSection> : null}
        {detailTab === 'hosting' ? <AssetPanelSection title="承载设备" icon={Server}>{detailQuery.data.infrastructure ? <><AssetPanelFields items={[['设备名称', detailQuery.data.infrastructure.name], ['资产编号', detailQuery.data.infrastructure.asset_code], ['设备类型', detailQuery.data.infrastructure.category_name || detailQuery.data.infrastructure.device_type], ...(detailQuery.data.infrastructure.legacy ? [['品牌型号', detailQuery.data.infrastructure.brand_model], ['管理 IP', detailQuery.data.infrastructure.mgmt_ip], ['业务 IP', detailQuery.data.infrastructure.biz_ip], ['位置', detailQuery.data.infrastructure.location], ['机柜 U 位', detailQuery.data.infrastructure.rack_unit], ['操作系统', detailQuery.data.infrastructure.os_type], ['状态', detailQuery.data.infrastructure.status]] : [])]} />{detailQuery.data.infrastructure.legacy ? <p className="text-xs text-muted-foreground">保留历史 server_id 实际承载关联；修改系统资料不会丢失该关联。</p> : <Button variant="link" onClick={() => onNavigate?.({ tableKey: 'cmdb_assets', id: detailQuery.data.infrastructure.id })}>查看承载设备</Button>}</> : <EmptyState label="未关联承载设备" />}</AssetPanelSection> : null}
        {detailTab === 'records' ? <AssetPanelSection title="运维履历" icon={History}><LogTimeline logs={detailQuery.data.logs} /></AssetPanelSection> : null}
        {detailTab === 'relations' ? <AssetPanelSection title="凭证中心" icon={KeyRound}><NetcattyLinks assetType="application" assetId={app.id} asset={{ name: app.app_name, ip: app.service_ip }} embedded /></AssetPanelSection> : null}
      </div>}
    </AssetPanel>}
    {legacyServerId && !editor && <LegacyServerPanel expanded={panelExpanded} onExpandedChange={setPanelExpanded} onWidthChange={panelLayout.onWidthChange} id={legacyServerId} onClose={() => setLegacyServerId(null)} onOpenApplication={record => { setLegacyServerId(null); setDetail({ tableKey: 'server_apps', id: record.id }) }} />}
    {editor && (editor.record.id
      ? <AssetPanel open expanded={panelExpanded} onExpandedChange={setPanelExpanded} onWidthChange={panelLayout.onWidthChange} onClose={draftGuard.requestClose} title="编辑业务系统" subtitle={editor.record.app_name} icon={Workflow} tabs={<AssetFormTabs tabs={editorTabs} value={formTab} onChange={setFormTab} dataSection="system-form-tabs" />} footer={<AssetPanelSave onCancel={draftGuard.requestClose} onSave={save} busy={action.busy || netcatty.loading} />}>{editorBody}</AssetPanel>
      : <AssetCreateDialog open title="新增业务系统" onOpenChange={(value) => { if (!value) draftGuard.requestClose() }} icon={Workflow} tabs={editorTabs} tab={formTab} onTabChange={setFormTab} busy={action.busy || netcatty.loading} footer={<AssetPanelSave onCancel={draftGuard.requestClose} onSave={save} busy={action.busy || netcatty.loading} />}>{editorBody}</AssetCreateDialog>)}
    <ConfirmDialog open={!!archiving} onOpenChange={(value) => { if (!value) setArchiving(null) }} title="注销归档业务系统" message="系统资料与运维履历将保留，可通过“含已注销”或状态筛选查询。" confirmLabel="注销归档" busy={action.busy} onConfirm={() => action.run(async () => { await api.deleteApp(archiving.id); if (Number(detail?.id) === Number(archiving.id)) setDetail(null); setArchiving(null); refresh() }, '已注销归档')} />
    <AssetDraftDiscardDialog guard={draftGuard} busy={action.busy} />
  </div>
}
