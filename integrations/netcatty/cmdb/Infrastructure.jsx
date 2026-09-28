import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Download, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AsidePanel } from '@/components/ui/aside-panel'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from './api'
import DeviceWorkspace from './DeviceWorkspace'
import DeviceWorkspaceErrorBoundary from './DeviceWorkspaceErrorBoundary'
import { requestJson, exportFile } from './transport'
import { allPages, useAction, useDirectory, useQuery, useTableDensity } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { DataTable, ErrorBanner, ModalForm, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'
import ImportDialog from './ImportDialog'
import InfrastructureEditor from './InfrastructureEditor'
import InfrastructureQuickConnect from './InfrastructureQuickConnect'
import OperatingSystemCell from './OperatingSystemCell'
import { infrastructureSavePayload, saveInfrastructureDraftPhotos } from './infrastructureEditorModel'
import { deviceTypeLabel, infrastructureListPresentation, resolveOperatingSystemPresentation } from './deviceWorkspaceModel'
import { buildNetcattyLinkPayload } from './NetcattyConnection'
import { useNetcattyConnectionEditor } from './NetcattyConnectionFields'
import { supportsInfrastructurePhotos } from './state'
import { VendorBrandValue } from './VendorBrandIcon'
import { resolveVendorBrand } from './vendorBrandModel'

const TYPES = [['server', '服务器'], ['virtual_machine', '虚拟机'], ['hyperconverged', '超融合'], ['switch', '交换机'], ['router', '路由器'], ['security_device', '安全设备'], ['storage', '存储设备']].map(([value, label]) => ({ value, label }))
const DEFAULTS = { status: '在库', asset_class: 'physical', device_type: 'server', org_id: 0, group_id: 0, category_id: 0, model_id: 0, owner_id: 0, interfaces: [] }
const directoryLoader = async () => {
  const [meta, people, filters, deviceTypes, customFields] = await Promise.all([requestJson('/api/cmdb/meta'), allPages(api.persons), api.infrastructureFilters(), api.taxonomy('infrastructure-categories'), api.customFields()])
  return { meta, people, filters, deviceTypes: deviceTypes.list || [], customFields: customFields.list || [] }
}

function InfrastructureTechnicalCell({ record }) {
  const presentation = infrastructureListPresentation(record)
  const hasModelIdentity = Boolean(presentation.vendor || presentation.model)
  const operatingSystem = resolveOperatingSystemPresentation(record)
  const hideOperatingSystemIcon = hasModelIdentity && resolveVendorBrand(presentation.vendor, { model: presentation.model }) === operatingSystem.distro
  return <div data-infrastructure-technical-cell className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs">
    {hasModelIdentity ? <VendorBrandValue value={presentation.vendor} model={presentation.model} className="min-w-0 max-w-[55%]" /> : null}
    {hasModelIdentity && presentation.showOperatingSystem ? <span className="shrink-0 text-muted-foreground">/</span> : null}
    {presentation.showOperatingSystem ? <div className="min-w-0 flex-1"><OperatingSystemCell asset={record} compact hideIcon={hideOperatingSystemIcon} /></div> : null}
    {!hasModelIdentity && !presentation.showOperatingSystem ? <span className="text-muted-foreground">未录入</span> : null}
  </div>
}

export default function Infrastructure({ keyword, focusTarget, onNavigate, command, leadingControl, meta: workspaceMeta, onPanelOpenChange }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [filters, setFilters] = useState({ status: '', category_id: '', org_id: '', group_id: '', source_type: '', os_type: '', os_version: '' })
  const [sort, setSort] = useState('')
  const [selected, setSelected] = useState([])
  const [selectedDeviceID, setSelectedDeviceID] = useState(null)
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false)
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0)
  const [editor, setEditor] = useState(null)
  const [photoDraft, setPhotoDraft] = useState({})
  const [tableRef, density] = useTableDensity()
  const [values, setValues] = useState({})
  const [confirmation, setConfirmation] = useState(null)
  useEffect(() => { onPanelOpenChange?.(!!selectedDeviceID || !!editor, editor && !editor.batch ? 720 : workspaceExpanded ? 'full' : 420) }, [selectedDeviceID, editor, workspaceExpanded, onPanelOpenChange])
  const handledCommandId = useRef(null)
  const directory = useDirectory(directoryLoader)
  const action = useAction()
  const netcatty = useNetcattyConnectionEditor('infrastructure')
  const beginNetcattyConnection = netcatty.begin
  const params = { keyword, scope: 'infrastructure', ...filters, ...(sort ? { sort_by: sort, sort_order: 'asc' } : {}) }
  const loader = useCallback(() => api.infrastructure({ keyword, scope: 'infrastructure', ...filters, ...(sort ? { sort_by: sort, sort_order: 'asc' } : {}), page, page_size: pageSize }), [keyword, filters, sort, page, pageSize])
  const query = useQuery(loader)
  const meta = directory.data?.meta || {}
  const advancedFilterCount = ['org_id', 'source_type', 'os_type', 'os_version'].filter((key) => filters[key]).length + (sort ? 1 : 0)
  useEffect(() => { setPage(1); setSelected([]) }, [keyword])
  const showAsset = useCallback((recordOrID) => setSelectedDeviceID(typeof recordOrID === 'object' ? recordOrID.id : recordOrID), [])
  const closeWorkspace = () => { setSelectedDeviceID(null); setWorkspaceExpanded(false) }
  useEffect(() => { if (focusTarget?.tableKey === 'cmdb_assets') showAsset(focusTarget.id) }, [focusTarget, showAsset])
  const changeFilter = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); setSelected([]) }
  const options = (items) => choices((items || []).map((item) => ({ value: item.id, label: item.name })), '未分配')
  const open = useCallback((record = {}, batch = false) => {
    if (batch) { setEditor({ record, batch }); setValues({}); return }
    setPhotoDraft({})
    void beginNetcattyConnection(record.id || 0)
    if (!record.id) { setEditor({ record: DEFAULTS, batch: false }); return }
    action.run(async () => {
      const detail = await api.infrastructureAsset(record.id)
      setEditor({ record: { ...DEFAULTS, ...detail.asset, interfaces: detail.interfaces || [] }, batch: false })
    })
  }, [action, beginNetcattyConnection])
  useEffect(() => {
    if (!command?.id || command?.tab !== 'infrastructure' || handledCommandId.current === command.id) return
    handledCommandId.current = command.id
    if (command.type === 'create') open()
    if (command.type === 'refresh') { query.reload(); directory.reload() }
  }, [command, directory, open, query])
  const fields = [
    { key: 'name', label: '设备名称', required: !editor?.batch, hidden: editor?.batch }, { key: 'device_type', label: '设备类型', options: choices(TYPES), hidden: editor?.batch },
    { key: 'status', label: '状态', options: choices(meta.statuses || ['在线', '在库', '报废', '维护中', '离线', '故障'], editor?.batch ? '保持不变' : '请选择') },
    ...[['category_id', '设备分类', 'categories'], ['org_id', '所属组织', 'orgs'], ['group_id', '所属分组', 'groups']].map(([key, label, kind]) => ({ key, label, numeric: true, options: options(meta[kind]) })),
    { key: 'owner_id', label: '负责人', numeric: true, options: choices((directory.data?.people || []).map((person) => ({ value: person.id, label: `${person.name} · ${person.department}` }))), derive: (id) => { const person = directory.data?.people.find((item) => item.id === id); return { owner: person?.name || '', department: person?.department || '' } } },
    ...textFields([['department', '部门'], ['remark', '备注', 'textarea']]),
  ]
  const save = () => action.run(async () => {
    validateFields(fields, values)
    const changes = Object.fromEntries([...fields.map((field) => field.key), 'owner'].filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]))
    if (editor.batch) {
      const compact = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== '' && value !== undefined))
      if (!Object.keys(compact).length) throw new Error('请至少选择一个要修改的字段')
      await api.batchInfrastructure(selected, 'edit', compact)
    } else if (editor.record.id) await api.updateInfrastructure(editor.record.id, changes)
    else await api.createInfrastructure({ ...values, asset_class: 'physical' })
    setEditor(null); setSelected([]); query.reload()
  }, '已保存资产')
  const saveFull = (next) => action.run(async () => {
    if (netcatty.error) throw new Error(netcatty.error)
    buildNetcattyLinkPayload('infrastructure', next.id || 1, netcatty.connection, netcatty.hosts, netcatty.credentials)
    const payload = infrastructureSavePayload(next)
    const result = next.id ? (await api.replaceInfrastructure(next.id, payload), { id: next.id }) : await api.createInfrastructure(payload)
    if (!next.id) setEditor(current => ({ ...current, record: { ...next, id: result.id } }))
    await netcatty.persist(result.id)
    if (supportsInfrastructurePhotos(next)) await saveInfrastructureDraftPhotos(result.id, photoDraft, api.saveAssetImage)
    setEditor(null); setPhotoDraft({}); setSelected([]); query.reload(); directory.reload(); setWorkspaceRefresh((value) => value + 1)
  }, '已保存完整资产档案')
  const compactColumns = [
    { key: 'name', label: '资产 / 管理 IP', render: (value, record) => <div className="min-w-0"><Button variant="link" className="h-auto max-w-full truncate p-0" onClick={() => showAsset(record)}>{value || `#${record.id}`}</Button><p className="truncate text-[11px] text-muted-foreground">{record.category_name || deviceTypeLabel(record)} · {record.group_name || '未分组'}</p><div className="flex min-w-0 items-center gap-1"><span className="truncate font-mono text-[11px]">{record.mgmt_ip || record.manage_ip || '无管理 IP'}</span><InfrastructureQuickConnect asset={record} /></div></div> },
    { key: 'status', label: '状态', headerClassName: 'w-24', render: (value) => <StatusPill tone={statusTone(value)}>{value}</StatusPill> },
  ]
  const mediumColumns = [
    { key: 'name', label: '资产名称 / 编码', render: (value, record) => <div className="min-w-0"><Button variant="link" className="h-auto max-w-full truncate p-0" onClick={() => showAsset(record)}>{value || `#${record.id}`}</Button><p className="truncate font-mono text-[11px] text-muted-foreground">{record.asset_code || '-'}</p></div> },
    { key: 'device_type', label: '分类 / 分组', render: (_value, record) => <div><span className="text-xs">{record.category_name || deviceTypeLabel(record)}</span><p className="text-[11px] text-muted-foreground">{record.group_name || '未分组'}</p></div> },
    { key: 'vendor', label: '型号 / 系统', className: 'min-w-[210px]', render: (_value, record) => <InfrastructureTechnicalCell record={record} /> },
    { key: 'mgmt_ip', label: '管理 IP', render: (value, record) => <div className="flex min-w-0 items-center gap-1"><span className="truncate font-mono text-xs">{value || record.manage_ip || '-'}</span><InfrastructureQuickConnect asset={record} /></div> },
    { key: 'status', label: '状态', headerClassName: 'w-24', render: (value) => <StatusPill tone={statusTone(value)}>{value}</StatusPill> },
  ]
  return <div ref={tableRef} className="flex min-h-0 flex-1 flex-col">
    <Toolbar>
      {leadingControl}
      <SelectControl className="w-36" value={filters.category_id} onChange={(value) => changeFilter('category_id', value)} options={choices((meta.categories || []).map((item) => ({ value: item.id, label: item.name })), '全部设备类型')} />
      <SelectControl className="w-32" value={filters.status} onChange={(value) => changeFilter('status', value)} options={choices(meta.statuses || [], '全部状态')} />
      <SelectControl className="w-36" value={filters.group_id} onChange={(value) => changeFilter('group_id', value)} options={choices((meta.groups || []).map((item) => ({ value: item.id, label: item.name })), '全部资产分组')} />
      <Popover><PopoverTrigger asChild><Button variant="outline" size="sm"><SlidersHorizontal size={14} className="mr-1" />更多筛选{advancedFilterCount ? ` (${advancedFilterCount})` : ''}</Button></PopoverTrigger><PopoverContent align="start" className="w-72 space-y-3">
        {[['org_id', '组织', 'orgs']].map(([key, label, kind]) => <div key={key}><p className="mb-1 text-xs text-muted-foreground">{label}</p><SelectControl className="w-full" value={filters[key]} onChange={(value) => changeFilter(key, value)} options={choices((meta[kind] || []).map((item) => ({ value: item.id, label: item.name })), `全部${label}`)} /></div>)}
        <div><p className="mb-1 text-xs text-muted-foreground">来源</p><SelectControl className="w-full" value={filters.source_type} onChange={(value) => changeFilter('source_type', value)} options={choices([{ value: 'manual', label: '手工登记' }, { value: 'legacy_server', label: '基础设施台账' }], '全部来源')} /></div>
        <div><p className="mb-1 text-xs text-muted-foreground">操作系统</p><SelectControl className="w-full" value={filters.os_type} onChange={(value) => changeFilter('os_type', value)} options={choices(directory.data?.filters.os_type || [], '全部操作系统')} /></div>
        <div><p className="mb-1 text-xs text-muted-foreground">系统版本</p><SelectControl className="w-full" value={filters.os_version} onChange={(value) => changeFilter('os_version', value)} options={choices(directory.data?.filters.os_version || [], '全部系统版本')} /></div>
        <div><p className="mb-1 text-xs text-muted-foreground">排序</p><SelectControl className="w-full" value={sort} onChange={(value) => { setSort(value); setPage(1) }} options={choices([{ value: 'name', label: '名称升序' }, { value: 'asset_code', label: '编码升序' }], '默认排序')} /></div>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => { setFilters((current) => ({ ...current, org_id: '', source_type: '', os_type: '', os_version: '' })); setSort(''); setPage(1) }}>重置高级筛选</Button>
      </PopoverContent></Popover>
      <div className="ml-auto flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => action.run(() => api.exportInfrastructure(params))}><Download size={14} className="mr-1" />导出</Button><Button variant="outline" size="sm" onClick={() => action.run(() => exportFile('/api/cmdb/assets/template', 'cmdb-template.xlsx'))}>模板</Button><ImportDialog importer={api.importInfrastructure} onImported={() => { query.reload(); directory.reload() }} /></div>
    </Toolbar>
    {selected.length > 0 && <Toolbar><span className="text-xs text-muted-foreground">已选 {selected.length} 项</span><Button variant="ghost" size="sm" onClick={() => open({}, true)}>批量编辑</Button><Button variant="ghost" size="sm" onClick={() => setConfirmation({ ids: selected, action: 'clone' })}>克隆</Button><Button variant="ghost" size="sm" onClick={() => setConfirmation({ ids: selected, action: 'archive' })}>注销归档</Button></Toolbar>}
    {(query.error || directory.error) && <ErrorBanner message={query.error || directory.error} onRetry={() => { query.reload(); directory.reload() }} />}
    <DataTable rows={query.error ? [] : query.data?.list || []} loading={query.loading} selected={selected} onSelectedChange={setSelected} compact={density !== 'wide'} columns={density === 'compact' ? compactColumns : density === 'medium' ? mediumColumns : [
      { key: 'name', label: '资产名称 / 编码', render: (value, record) => <div><Button variant="link" className="h-auto p-0" onClick={() => showAsset(record)}>{value || `#${record.id}`}</Button><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{record.asset_code || '-'}</p></div> },
      { key: 'device_type', label: '分类 / 分组', render: (_value, record) => <div><p className="text-xs">{record.category_name || deviceTypeLabel(record)}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{record.group_name || '未分组'}</p></div> },
      { key: 'vendor', label: '型号 / 系统', className: 'min-w-[230px]', render: (_value, record) => <InfrastructureTechnicalCell record={record} /> },
      { key: 'owner', label: '负责人 / 部门', render: (value, record) => <div><span>{value || '未分配'}</span><p className="mt-0.5 text-[11px] text-muted-foreground">{record.department || record.org_name || '-'}</p></div> },
      { key: 'mgmt_ip', label: '管理 IP', render: (value, record) => <div className="flex items-center gap-1 whitespace-nowrap"><span className="font-mono text-xs">{value || record.manage_ip || '-'}</span><InfrastructureQuickConnect asset={record} /></div> },
      { key: 'status', label: '状态', render: (value) => <StatusPill tone={statusTone(value)}>{value}</StatusPill> },
    ]} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); setSelected([]) }} />
    <AsidePanel open={!!selectedDeviceID} onClose={closeWorkspace} width={workspaceExpanded ? 'w-full' : 'w-[420px]'} dataSection="device-workspace-panel">{selectedDeviceID ? <DeviceWorkspaceErrorBoundary resetKey={`${selectedDeviceID}-${workspaceRefresh}`} onRetry={() => setWorkspaceRefresh((value) => value + 1)} onClose={closeWorkspace}><DeviceWorkspace key={`${selectedDeviceID}-${workspaceRefresh}`} id={selectedDeviceID} projects={workspaceMeta?.projects || []} expanded={workspaceExpanded} onExpandedChange={setWorkspaceExpanded} onClose={closeWorkspace} onEdit={() => open({ id: selectedDeviceID })} onClone={() => setConfirmation({ ids: [selectedDeviceID], action: 'clone' })} onArchive={() => setConfirmation({ ids: [selectedDeviceID], action: 'archive' })} onOpenAsset={showAsset} onOpenIP={(item) => { closeWorkspace(); onNavigate?.({ tableKey: 'ip_pool', id: item.id, title: item.ip, subtitle: item.subnet }) }} onOpenApplication={(applicationID) => { closeWorkspace(); onNavigate?.({ tableKey: 'server_apps', id: applicationID }) }} /></DeviceWorkspaceErrorBoundary> : null}</AsidePanel>
    {editor?.batch && <ModalForm title="批量编辑资产（留空保持不变）" open onOpenChange={(value) => { if (!value) setEditor(null) }} busy={action.busy} onSubmit={save} wide><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>}
    <InfrastructureEditor open={!!editor && !editor.batch} onOpenChange={(value) => { if (!value) setEditor(null) }} record={!editor?.batch ? editor?.record : null} directory={directory.data} busy={action.busy || netcatty.loading} onSubmit={saveFull} netcatty={netcatty} photoDraft={photoDraft} onPhotoDraftChange={setPhotoDraft} />
    <ConfirmDialog open={!!confirmation} onOpenChange={(value) => { if (!value) setConfirmation(null) }} title={confirmation?.action === 'clone' ? '克隆资产' : '注销归档'} message={`处理 ${confirmation?.ids.length || 0} 项资产。归档会保留资产记录。`} confirmLabel="确认" busy={action.busy} onConfirm={() => action.run(async () => { await api.batchInfrastructure(confirmation.ids, confirmation.action); if (confirmation.action === 'archive' && confirmation.ids.includes(selectedDeviceID)) closeWorkspace(); setConfirmation(null); setSelected([]); query.reload() }, '操作完成')} />
  </div>
}
