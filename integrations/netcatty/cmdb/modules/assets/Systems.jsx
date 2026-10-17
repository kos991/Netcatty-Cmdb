import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link2, Pencil, Server, Settings2, Trash2, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { allPages, useAction, useDirectory, useQuery, useTableDensity } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { isApplicationHostInfrastructure } from './state'
import { ActionIcon, DataTable, ErrorBanner, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'
import AssetTransferMenu from './AssetTransferMenu'
import NetcattyConnectionFields, { useNetcattyConnectionEditor } from './NetcattyConnectionFields'
import NetcattyLinks from './NetcattyLinks'
import { AssetPanel, AssetPanelFields, AssetPanelSave, AssetPanelSection } from './AssetPanel'
import { businessAddressOptions } from './infrastructureEditorModel'
import AssetFilterPicker, { useAssetFilterSelection } from './AssetFilterPicker'

const APP_FIELDS = textFields([['app_name', '系统名称'], ['version', '版本'], ['provider', '供应商'], ['port', '端口'], ['access_url', '访问地址'], ['middleware', '中间件'], ['database_info', '数据库'], ['owner', '负责人'], ['description', '说明', 'textarea'], ['remark', '备注', 'textarea']]).map((f) => ({ ...f, required: f.key === 'app_name' }))
const loadDirectory = () => allPages(api.infrastructure, { scope: 'infrastructure' })
const loadTaxonomy = async () => {
  const [categories, groups] = await Promise.all([api.taxonomy('application-categories'), api.taxonomy('groups')])
  return { categories: categories.list || [], groups: groups.list || [] }
}

export default function Systems({ keyword, focusTarget, meta, command, leadingControl, headerActions, onPanelOpenChange, onNavigate }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [type, setType] = useState('')
  const [groupId, setGroupId] = useState('')
  const [status, setStatus] = useState('')
  const filterItems = [{ key: 'app_type', label: '系统分类' }, { key: 'group_id', label: '资产分组' }, { key: 'status', label: '状态' }]
  const { visible: visibleFilters, toggle: toggleFilter } = useAssetFilterSelection('systems', filterItems, filterItems.map((item) => item.key), (update) => {
    const current = { app_type: type, group_id: groupId, status }
    const next = update(current)
    setType(next.app_type)
    setGroupId(next.group_id)
    setStatus(next.status)
  }, () => setPage(1))
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [deleting, setDeleting] = useState(null)
  const [detail, setDetail] = useState(null)
  const [tableRef, density] = useTableDensity()
  useEffect(() => { onPanelOpenChange?.(!!detail || !!editor) }, [detail, editor, onPanelOpenChange])
  const handledCommandId = useRef(null)
  const action = useAction()
  const netcatty = useNetcattyConnectionEditor('application')
  const beginNetcattyConnection = netcatty.begin
  const directory = useQuery(loadDirectory, [])
  const hostLoader = useCallback(() => values.cmdb_asset_id ? api.infrastructureAsset(values.cmdb_asset_id) : Promise.resolve(null), [values.cmdb_asset_id])
  const selectedHost = useQuery(hostLoader)
  const taxonomy = useDirectory(loadTaxonomy)
  const categories = useMemo(() => taxonomy.data?.categories || [], [taxonomy.data?.categories])
  const groups = useMemo(() => taxonomy.data?.groups || [], [taxonomy.data?.groups])
  const loader = useCallback(() => api.apps({ keyword, app_type: type, group_id: groupId, status, page, page_size: pageSize }), [keyword, type, groupId, status, page, pageSize])
  const query = useQuery(loader)
  const detailLoader = useCallback(async () => {
    if (!detail) return null
    const apps = await allPages(api.apps)
    const app = apps.find((item) => item.id === detail.id)
    if (!app) throw new Error('业务系统不存在')
    const host = app.cmdb_asset_id ? await api.infrastructureAsset(app.cmdb_asset_id) : null
    const ips = app.service_ip ? await api.ipEntries({ keyword: app.service_ip, page: 1, page_size: 20 }) : { list: [] }
    return { app, infrastructure: host?.asset || null, ipam: ips.list?.find(item => item.ip === app.service_ip) }
  }, [detail])
  const detailQuery = useQuery(detailLoader)
  const serverDirectory = (directory.data || []).filter((asset) => isApplicationHostInfrastructure(asset))
  useEffect(() => { setPage(1) }, [keyword])
  useEffect(() => { if (focusTarget?.tableKey === 'server_apps') setDetail(focusTarget) }, [focusTarget])
  const open = useCallback((record = {}) => { void beginNetcattyConnection(record.id || 0); setEditor({ record }); setValues({ status: '正常运行', app_type: categories[0]?.name || '', group_id: 0, ...record }) }, [beginNetcattyConnection, categories])
  const refresh = useCallback(() => { query.reload(); directory.reload(); taxonomy.reload(); detailQuery.reload() }, [detailQuery, directory, query, taxonomy])
  useEffect(() => {
    if (!command?.id || command?.tab !== 'systems' || handledCommandId.current === command.id) return
    handledCommandId.current = command.id
    if (command.type === 'create') open()
    if (command.type === 'refresh') refresh()
  }, [command, open, refresh])
  const businessOptions = businessAddressOptions({ ...selectedHost.data?.asset, interfaces: selectedHost.data?.interfaces || selectedHost.data?.asset?.interfaces || [] })
  if (values.service_ip && values.service_ip === editor?.record.service_ip && !businessOptions.some(item => item.value === values.service_ip)) businessOptions.push({ value: values.service_ip, label: `${values.service_ip} · 已关联应用 IP` })
  const fields = [
    ...APP_FIELDS, { key: 'cmdb_asset_id', label: '承载服务器（可选）', numeric: true, derive: () => ({ service_ip: '' }), options: choices(serverDirectory.map((asset) => ({ value: asset.id, label: `${asset.name || asset.asset_code} · ${asset.category_name || asset.device_type || ''}` })), '不关联服务器') },
    { key: 'service_ip', label: '业务 IP', disabled: selectedHost.loading, options: choices(businessOptions, '未关联业务 IP') },
    { key: 'app_type', label: '系统类型', required: true, searchable: true, options: choices([...new Set([...categories.map((item) => item.name), values.app_type].filter(Boolean))]) },
    { key: 'group_id', label: '所属分组', numeric: true, searchable: true, options: choices(groups.map((item) => ({ value: item.id, label: item.name })), '未分组') },
    { key: 'status', label: '状态', options: choices(meta.app_statuses || []) },
  ]
  const appColumns = [
    { key: 'app_name', label: '业务系统', render: (v, row) => <Button variant="link" className="h-auto p-0" onClick={() => setDetail({ tableKey: 'server_apps', id: row.id })}>{v}</Button> },
    { key: 'app_type', label: '分类 / 分组', render: (value, row) => <div>{value || '未分类'}<p className="text-[11px] text-muted-foreground">{row.group_name || '未分组'}</p></div> },
    ...textFields([['version', '版本'], ['provider', '供应商'], ['server_name', '承载服务器'], ['server_biz_ip', 'IP'], ['port', '端口'], ['owner', '负责人']]), { key: 'status', label: '状态', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
    { key: 'actions', label: '操作', render: (_, row) => <div className="flex"><ActionIcon label="编辑系统" onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除系统" danger onClick={() => setDeleting({ kind: 'app', record: row })}><Trash2 size={15} /></ActionIcon></div> },
  ]
  const compactColumns = [
    { key: 'app_name', label: '业务系统 / 承载', render: (value, row) => <div className="min-w-0"><Button variant="link" className="h-auto max-w-full truncate p-0" onClick={() => setDetail({ tableKey: 'server_apps', id: row.id })}>{value}</Button><p className="truncate text-[11px] text-muted-foreground">{row.app_type || '未分类'} · {row.group_name || '未分组'} · {row.server_name || '未关联服务器'} · {row.server_biz_ip || '未关联业务 IP'}</p></div> },
    { key: 'status', label: '状态', headerClassName: 'w-24', render: (value) => <StatusPill tone={statusTone(value)}>{value}</StatusPill> },
    { key: 'actions', label: '操作', headerClassName: 'w-20', render: (_, row) => <div className="flex"><ActionIcon label="编辑系统" onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除系统" danger onClick={() => setDeleting({ kind: 'app', record: row })}><Trash2 size={15} /></ActionIcon></div> },
  ]
  const mediumColumns = appColumns.filter((column) => ['app_name', 'app_type', 'server_name', 'server_biz_ip', 'status', 'actions'].includes(column.key))
  const visibleColumns = density === 'compact' ? compactColumns : density === 'medium' ? mediumColumns : appColumns
  const save = () => action.run(async () => {
    if (selectedHost.error) throw new Error(selectedHost.error)
    validateFields(fields, values)
    const result = editor.record.id ? (await api.updateApp(editor.record.id, values), { id: editor.record.id }) : await api.createApp(values)
    if (!editor.record.id) setEditor(current => ({ ...current, record: { ...values, id: result.id } }))
    await netcatty.persist(result.id)
    setEditor(null)
    refresh()
  }, '已保存')
  return <div ref={tableRef} className="flex min-h-0 flex-1 flex-col">
    {headerActions && createPortal(<><AssetFilterPicker items={filterItems} visible={visibleFilters} onToggle={toggleFilter} /><AssetTransferMenu importTitle="设备信息导入" importLabel="导入设备信息" importer={api.importSangfor} onImported={refresh} exporter={() => api.exportApps({ keyword, app_type: type, group_id: groupId, status })} /></>, headerActions)}
    <Toolbar>
    {leadingControl}
    {visibleFilters.includes('app_type') && <SelectControl className="w-36" value={type} onChange={(v) => { setType(v); setPage(1) }} options={choices(categories.map((item) => item.name), '全部系统分类')} />}{visibleFilters.includes('group_id') && <SelectControl className="w-36" value={groupId} onChange={(v) => { setGroupId(v); setPage(1) }} options={choices(groups.map((item) => ({ value: item.id, label: item.name })), '全部资产分组')} />}{visibleFilters.includes('status') && <SelectControl className="w-36" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={choices(meta.app_statuses || [], '全部状态')} />}
  </Toolbar>
    {(query.error || directory.error || taxonomy.error) && <ErrorBanner message={query.error || directory.error || taxonomy.error} onRetry={refresh} />}
    <DataTable loading={query.loading} rows={query.error ? [] : query.data?.list || []} columns={visibleColumns} compact={density !== 'wide'} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    {detail && <AssetPanel open onClose={() => setDetail(null)} title={detailQuery.data?.app?.app_name || detail.app_name || '业务系统'} subtitle={detailQuery.data?.app?.app_type} status={detailQuery.data?.app?.status} icon={Workflow} onEdit={detailQuery.data?.app ? () => open(detailQuery.data.app) : undefined}>
      {detailQuery.error && <ErrorBanner message={detailQuery.error} onRetry={detailQuery.reload} />}
      {detailQuery.data?.app && <>
        <AssetPanelSection title="系统配置" icon={Settings2}><AssetPanelFields items={[["系统名称", detailQuery.data.app.app_name], ["类型", detailQuery.data.app.app_type], ["所属分组", detailQuery.data.app.group_name], ["版本", detailQuery.data.app.version], ["供应商", detailQuery.data.app.provider], ["端口", detailQuery.data.app.port], ["访问地址", detailQuery.data.app.access_url], ["中间件", detailQuery.data.app.middleware], ["数据库", detailQuery.data.app.database_info]]} /></AssetPanelSection>
        <AssetPanelSection title="归属与承载" icon={Server}><AssetPanelFields items={[["负责人", detailQuery.data.app.owner], ["承载服务器", detailQuery.data.infrastructure?.name || '未关联'], ["说明", detailQuery.data.app.description], ["备注", detailQuery.data.app.remark]]} /></AssetPanelSection>
        <AssetPanelSection title="业务地址" icon={Link2}><p className="text-xs">{detailQuery.data.app.service_ip || '未关联业务 IP'}{detailQuery.data.app.service_ip && !detailQuery.data.ipam ? ' · 未纳入 IPAM' : ''}</p>{detailQuery.data.infrastructure ? <Button variant="link" onClick={() => onNavigate?.({ tableKey: 'cmdb_assets', id: detailQuery.data.infrastructure.id })}>查看承载服务器</Button> : null}{detailQuery.data.ipam ? <Button variant="link" onClick={() => onNavigate?.({ tableKey: 'ip_pool', id: detailQuery.data.ipam.id, title: detailQuery.data.ipam.ip, subtitle: detailQuery.data.ipam.subnet })}>查看 IPAM</Button> : null}</AssetPanelSection>
        <AssetPanelSection title="凭证中心" icon={Link2}><NetcattyLinks assetType="application" assetId={detailQuery.data.app.id} asset={{ name: detailQuery.data.app.app_name, ip: detailQuery.data.app.service_ip }} embedded /></AssetPanelSection>
      </>}
    </AssetPanel>}
    {editor && <AssetPanel open onClose={() => setEditor(null)} title={editor.record.id ? '编辑业务系统' : '新增业务系统'} subtitle={editor.record.app_name} icon={Workflow} footer={<AssetPanelSave onCancel={() => setEditor(null)} onSave={save} busy={action.busy || netcatty.loading} />}>
      <AssetPanelSection title="系统配置与承载" icon={Settings2}>{selectedHost.error ? <ErrorBanner message={selectedHost.error} onRetry={selectedHost.reload} /> : null}<Fields fields={fields} value={values} onChange={setValues} /></AssetPanelSection>
      <AssetPanelSection title="凭证中心" icon={Link2}><NetcattyConnectionFields asset={{ name: values.app_name, ip: values.service_ip }} value={netcatty.connection} onChange={netcatty.setConnection} hosts={netcatty.hosts} credentials={netcatty.credentials} loading={netcatty.loading} error={netcatty.error} /></AssetPanelSection>
    </AssetPanel>}
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="确认删除" message="确认删除此业务系统？" confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deleteApp(deleting.record.id); setDeleting(null); refresh() }, '已删除')} />
  </div>
}
