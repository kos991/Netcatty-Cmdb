import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AsidePanel } from '@/components/ui/aside-panel'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import DeviceWorkspace from './DeviceWorkspace'
import DeviceWorkspaceErrorBoundary from './DeviceWorkspaceErrorBoundary'
import { requestJson } from './transport'
import { allPages, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { ActionIcon, AssetNameCell, DataTable, ErrorBanner, ModalForm, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'
import AssetTransferMenu from './AssetTransferMenu'
import InfrastructureEditor from './InfrastructureEditor'
import InfrastructureQuickConnect from './InfrastructureQuickConnect'
import { infrastructureSavePayload, saveInfrastructureDraftPhotos } from './infrastructureEditorModel'
import { deviceTypeLabel, infrastructureListPresentation } from './deviceWorkspaceModel'
import { infrastructureLocationPresentation, infrastructureNamePresentation, infrastructureNetworkSummary } from './infrastructureTableModel'
import { buildNetcattyLinkPayload } from './NetcattyConnection'
import { useNetcattyConnectionEditor } from './NetcattyConnectionFields'
import { infrastructureListFilterParams, infrastructureTypeFilterOptions, supportsInfrastructurePhotos } from './state'
import { VendorBrandValue } from './VendorBrandIcon'
import AssetFilterPicker, { useAssetFilterSelection } from './AssetFilterPicker'
import { visibleAssetColumnKeys, UNCONFIGURED_FILTER_VALUE } from './assetTableModel'

const TYPES = [['server', '服务器'], ['virtual_machine', '虚拟机'], ['hyperconverged', '超融合'], ['switch', '交换机'], ['router', '路由器'], ['security_device', '安全设备'], ['storage', '存储设备']].map(([value, label]) => ({ value, label }))
const DEFAULTS = { status: '在库', asset_class: 'physical', device_type: 'server', org_id: 0, category_id: 0, model_id: 0, owner_id: 0, interfaces: [] }
const directoryLoader = async () => {
  const [meta, people, filters, deviceTypes, customFields] = await Promise.all([requestJson('/api/cmdb/meta'), allPages(api.persons), api.infrastructureFilters(), api.taxonomy('infrastructure-categories'), api.customFields()])
  return { meta, people, filters, deviceTypes: deviceTypes.list || [], customFields: customFields.list || [] }
}

function InfrastructureVendorModelCell({ record }) {
  const presentation = infrastructureListPresentation(record)
  const hasModelIdentity = Boolean(presentation.vendor || presentation.model)
  return <div data-infrastructure-technical-cell className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs">
    {hasModelIdentity ? <VendorBrandValue value={presentation.vendor} model={presentation.model} className="min-w-0" compact /> : <span className="text-muted-foreground">未配置</span>}
  </div>
}

function InfrastructureNameCell({ record }) {
  const presentation = infrastructureNamePresentation(record)
  return <AssetNameCell title={presentation.name} subtitle={presentation.secondary} onOpen={() => record.onOpen?.()} />
}

function InfrastructureManagementIPCell({ record }) {
  const presentation = infrastructureNetworkSummary(record)
  return <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
    {presentation.management.ip ? <div className="flex min-w-0 items-center gap-1"><span className="truncate font-mono text-xs" title={presentation.management.ip}>{presentation.management.ip}</span><InfrastructureQuickConnect asset={record} address={presentation.management.ip} /></div> : <span className="text-xs text-muted-foreground">未配置管理 IP</span>}
    {presentation.secondary.slice(0, 2).map((item) => <div key={`${item.purpose}-${item.ip}`} className="flex min-w-0 items-center gap-1"><span title={`${item.purpose} IP：${item.ip}`} className="truncate font-mono text-[11px] text-muted-foreground">{item.purpose} {item.ip}</span><InfrastructureQuickConnect asset={record} address={item.ip} /></div>)}
    {presentation.secondary.length > 2 ? <p className="text-[11px] text-muted-foreground">另有 {presentation.secondary.length - 2} 个地址</p> : null}
  </div>
}

function InfrastructureNetworkTypeCell({ record }) {
  const presentation = infrastructureNetworkSummary(record)
  return <span className="block truncate text-xs text-muted-foreground" title={presentation.businessNetworkType}>{presentation.businessNetworkType}</span>
}

function InfrastructureLocationCell({ record }) {
  const presentation = infrastructureLocationPresentation(record)
  const unconfigured = presentation.primary === '未配置位置' || presentation.primary === '无实体位置'
  return <div className="min-w-0 text-xs">
    <div className={unconfigured ? 'truncate text-muted-foreground' : 'truncate'} title={presentation.primary}>{presentation.primary}</div>
    {presentation.secondary ? <div className="truncate text-[11px] text-muted-foreground" title={presentation.secondary}>{presentation.secondary}</div> : null}
  </div>
}

export default function Infrastructure({ keyword, focusTarget, onNavigate, command, leadingControl, headerActions, filtersExpanded = true, onFiltersExpandedChange, meta: workspaceMeta, onPanelOpenChange }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [filters, setFilters] = useState({ status: '', type_filter: '', owner: '', department: '', vendor: '', model: '', os_type: '', location: '', net_type: '' })
  const [sort, setSort] = useState('')
  const [selected, setSelected] = useState([])
  const filterItems = [{ key: 'type_filter', label: '设备类型' }, { key: 'owner', label: '负责人' }, { key: 'department', label: '部门' }, { key: 'vendor', label: '品牌' }, { key: 'model', label: '型号' }, { key: 'os_type', label: '操作系统' }, { key: 'location', label: '位置' }, { key: 'net_type', label: '网络类型' }, { key: 'status', label: '设备状态' }]
  const { visible: visibleFilters, toggle: toggleFilter } = useAssetFilterSelection('infrastructure', filterItems, ['type_filter', 'status'], setFilters, () => { setPage(1); setSelected([]) })
  const [selectedDeviceID, setSelectedDeviceID] = useState(null)
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false)
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0)
  const [editor, setEditor] = useState(null)
  const [photoDraft, setPhotoDraft] = useState({})
  const [values, setValues] = useState({})
  const [confirmation, setConfirmation] = useState(null)
  useEffect(() => { onPanelOpenChange?.(!!selectedDeviceID || !!editor, editor && !editor.batch && !editor.record.id ? 0 : workspaceExpanded ? 'full' : 420) }, [selectedDeviceID, editor, workspaceExpanded, onPanelOpenChange])
  const handledCommandId = useRef(null)
  const directory = useDirectory(directoryLoader)
  const action = useAction()
  const netcatty = useNetcattyConnectionEditor('infrastructure')
  const beginNetcattyConnection = netcatty.begin
  const params = { keyword, scope: 'infrastructure', ...infrastructureListFilterParams(filters), ...(sort ? { sort_by: sort, sort_order: 'asc' } : {}) }
  const loader = useCallback(() => api.infrastructure({ keyword, scope: 'infrastructure', ...infrastructureListFilterParams(filters), ...(sort ? { sort_by: sort, sort_order: 'asc' } : {}), page, page_size: pageSize }), [keyword, filters, sort, page, pageSize])
  const query = useQuery(loader)
  const meta = directory.data?.meta || {}
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
    ...[['category_id', '设备类型', 'categories'], ['org_id', '所属组织', 'orgs']].map(([key, label, kind]) => ({ key, label, numeric: true, options: options(meta[kind]) })),
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
  const columns = [
    { key: 'asset_code', label: '设备名 / 资产编号', width: 190, sticky: 'left', className: 'whitespace-nowrap', render: (_value, record) => <InfrastructureNameCell record={{ ...record, onOpen: () => showAsset(record) }} /> },
    { key: 'device_type', label: '设备类型', width: 90, className: 'whitespace-nowrap text-xs', render: (_value, record) => deviceTypeLabel(record) },
    { key: 'vendor_model', label: '品牌 / 型号', width: 135, className: 'whitespace-nowrap', render: (_value, record) => <InfrastructureVendorModelCell record={record} /> },
    { key: 'owner_department', label: '负责人', width: 105, render: (_value, record) => <span className="block truncate text-xs" title={record.owner || '未分配负责人'}>{record.owner || '未分配负责人'}</span> },
    { key: 'location', label: '位置', width: 135, render: (_value, record) => <InfrastructureLocationCell record={record} /> },
    { key: 'management_ip', label: 'IP 地址', width: 165, render: (_value, record) => <InfrastructureManagementIPCell record={record} /> },
    { key: 'network_type', label: '网络类型', width: 105, render: (_value, record) => <InfrastructureNetworkTypeCell record={record} /> },
    { key: 'status', label: '设备状态', width: 78, sticky: 'right', className: 'whitespace-nowrap', render: (value) => <StatusPill tone={statusTone(value)}>{value || '未配置'}</StatusPill> },
    { key: 'actions', label: '操作', width: 48, sticky: 'right', className: 'whitespace-nowrap', render: (_value, record) => <ActionIcon label="编辑资产" onClick={() => open(record)}><Pencil size={14} /></ActionIcon> },
  ]
  const columnsByKey = Object.fromEntries(columns.map((column) => [column.key, column]))
  const visibleColumns = visibleAssetColumnKeys('infrastructure').map((key) => columnsByKey[key]).filter(Boolean)
  return <div className="flex min-h-0 flex-1 flex-col">
    {headerActions && createPortal(<><AssetFilterPicker expanded={filtersExpanded} onExpandedChange={onFiltersExpandedChange} items={filterItems} visible={visibleFilters} onToggle={toggleFilter} /><AssetTransferMenu importTitle="导入基础设施" importer={api.importInfrastructure} onImported={() => { query.reload(); directory.reload() }} exporter={() => api.exportInfrastructure(params)} /></>, headerActions)}
    <Toolbar hidden={!filtersExpanded}>
      {leadingControl}
      {visibleFilters.includes('type_filter') && <SelectControl prefix="类型" className="w-36" value={filters.type_filter} onChange={(value) => changeFilter('type_filter', value)} options={choices(infrastructureTypeFilterOptions(meta.categories || [], directory.data?.filters.device_type || []), '全部')} />}
      {visibleFilters.includes('owner') && <SelectControl prefix="负责人" className="w-36" value={filters.owner} onChange={(value) => changeFilter('owner', value)} options={choices([...(directory.data?.filters.owner || []), { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
      {visibleFilters.includes('department') && <SelectControl prefix="部门" className="w-36" value={filters.department} onChange={(value) => changeFilter('department', value)} options={choices([...(directory.data?.filters.department || []), { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
      {visibleFilters.includes('vendor') && <SelectControl prefix="品牌" className="w-36" value={filters.vendor} onChange={(value) => changeFilter('vendor', value)} options={choices([...(directory.data?.filters.vendor || []), { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
      {visibleFilters.includes('model') && <SelectControl prefix="型号" className="w-36" value={filters.model} onChange={(value) => changeFilter('model', value)} options={choices([...(directory.data?.filters.model || []), { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
      {visibleFilters.includes('os_type') && <SelectControl prefix="系统" className="w-36" value={filters.os_type} onChange={(value) => changeFilter('os_type', value)} options={choices([...(directory.data?.filters.os_type || []), { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
      {visibleFilters.includes('location') && <SelectControl prefix="位置" className="w-40" value={filters.location} onChange={(value) => changeFilter('location', value)} options={choices([...(directory.data?.filters.location || []), { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
      {visibleFilters.includes('net_type') && <SelectControl prefix="网络" className="w-36" value={filters.net_type} onChange={(value) => changeFilter('net_type', value)} options={choices([...(directory.data?.filters.net_type || []), { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
      {visibleFilters.includes('status') && <SelectControl prefix="状态" className="w-36" value={filters.status} onChange={(value) => changeFilter('status', value)} options={choices([...(meta.statuses || []), { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }], '全部')} />}
      <SelectControl className="w-32" value={sort} onChange={(value) => { setSort(value); setPage(1) }} options={choices([{ value: 'name', label: '名称升序' }, { value: 'asset_code', label: '编码升序' }], '默认排序')} aria-label="排序" />
      <Button variant="ghost" size="icon" title="重置筛选与排序" aria-label="重置筛选与排序" onClick={() => { setFilters({ status: '', type_filter: '', owner: '', department: '', vendor: '', model: '', os_type: '', location: '', net_type: '' }); setSort(''); setPage(1); setSelected([]) }}><RotateCcw size={15} /></Button>
    </Toolbar>
    {selected.length > 0 && <Toolbar><span className="text-xs text-muted-foreground">已选 {selected.length} 项</span><Button variant="ghost" size="sm" onClick={() => open({}, true)}>批量编辑</Button><Button variant="ghost" size="sm" onClick={() => setConfirmation({ ids: selected, action: 'clone' })}>克隆</Button><Button variant="ghost" size="sm" onClick={() => setConfirmation({ ids: selected, action: 'archive' })}>注销归档</Button></Toolbar>}
    {(query.error || directory.error) && <ErrorBanner message={query.error || directory.error} onRetry={() => { query.reload(); directory.reload() }} />}
    <DataTable rows={query.error ? [] : query.data?.list || []} loading={query.loading} selected={selected} onSelectedChange={setSelected} compact columns={visibleColumns} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); setSelected([]) }} />
    <AsidePanel open={!!selectedDeviceID} onClose={closeWorkspace} width={workspaceExpanded ? 'w-full' : 'w-[420px]'} dataSection="device-workspace-panel">
      {selectedDeviceID ? <DeviceWorkspaceErrorBoundary resetKey={`${selectedDeviceID}-${workspaceRefresh}`} onRetry={() => setWorkspaceRefresh((value) => value + 1)} onClose={closeWorkspace}>
        <DeviceWorkspace key={`${selectedDeviceID}-${workspaceRefresh}`} id={selectedDeviceID} projects={workspaceMeta?.projects || []} expanded={workspaceExpanded} onExpandedChange={setWorkspaceExpanded} onClose={closeWorkspace}
          onEdit={() => open({ id: selectedDeviceID })}
          onClone={() => setConfirmation({ ids: [selectedDeviceID], action: 'clone' })}
          onArchive={() => setConfirmation({ ids: [selectedDeviceID], action: 'archive' })}
          onOpenAsset={showAsset}
          onOpenCabinet={(cabinet) => { closeWorkspace(); onNavigate?.({ tableKey: 'rack_cabinet', ...cabinet }) }}
          onOpenIP={(item) => { closeWorkspace(); onNavigate?.({ tableKey: 'ip_pool', id: item.id, title: item.ip, subtitle: item.subnet }) }}
          onOpenApplication={(applicationID) => { closeWorkspace(); onNavigate?.({ tableKey: 'server_apps', id: applicationID }) }}
        />
      </DeviceWorkspaceErrorBoundary> : null}
    </AsidePanel>
    {editor?.batch && <ModalForm title="批量编辑资产（留空保持不变）" open onOpenChange={(value) => { if (!value) setEditor(null) }} busy={action.busy} onSubmit={save} wide><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>}
    <InfrastructureEditor open={!!editor && !editor.batch} onOpenChange={(value) => { if (!value) setEditor(null) }} record={!editor?.batch ? editor?.record : null} directory={directory.data} busy={action.busy || netcatty.loading} onSubmit={saveFull} netcatty={netcatty} photoDraft={photoDraft} onPhotoDraftChange={setPhotoDraft} />
    <ConfirmDialog open={!!confirmation} onOpenChange={(value) => { if (!value) setConfirmation(null) }} title={confirmation?.action === 'clone' ? '克隆资产' : '注销归档'} message={`处理 ${confirmation?.ids.length || 0} 项资产。归档会保留资产记录。`} confirmLabel="确认" busy={action.busy} onConfirm={() => action.run(async () => { await api.batchInfrastructure(confirmation.ids, confirmation.action); if (confirmation.action === 'archive' && confirmation.ids.includes(selectedDeviceID)) closeWorkspace(); setConfirmation(null); setSelected([]); query.reload() }, '操作完成')} />
  </div>
}
