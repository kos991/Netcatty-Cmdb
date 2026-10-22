import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createPortal } from 'react-dom'

import { Archive, ArrowLeftRight, Cpu, History, Image as ImageIcon, KeyRound, MapPin, Monitor, MonitorCog, Network, RotateCcw, Wrench } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'


import { Spinner } from '@/components/ui/spinner'

import { api } from './api'

import { allPages, directoryChanged, useAction, useDirectory, useQuery } from './hooks'

import { choices, Fields, textFields, validateFields } from './Fields'

import { formatDepartmentName, isCloudDevice, normalizeAsset, nowText, terminalSerialProfile } from './state'

import { ActionIcon, DataTable, EmptyState, ErrorBanner, ModalForm, SelectControl, StatusPill, statusTone, Toolbar } from './ui'

import AssetTransferMenu from './AssetTransferMenu'
import AssetRowActions from './AssetRowActions'

import NetcattyConnectionFields, { useNetcattyConnectionEditor } from './NetcattyConnectionFields'

import NetcattyLinks from './NetcattyLinks'

import DeviceImages from './DeviceImages'

import { AssetPanel, AssetPanelFields, AssetPanelSave, AssetPanelSection, useAssetPanelLayout } from './AssetPanel'
import { AssetDraftDiscardDialog, AssetFormPanel, AssetFormTabs, useAssetDraftGuard } from './AssetFormTabs'
import AssetCreateDialog from './AssetCreateDialog'

import OperatingSystemCell from './OperatingSystemCell'

import AssetFilterPicker, { useAssetFilterSelection } from './AssetFilterPicker'

import { buildDeviceWorkspaceTabs, buildLinkedHostByAssetID, operatingSystemTypeFromDetectedHost } from './deviceWorkspaceModel'
import { AssetDetailTabBar } from './AssetDetailTabs'

import { useNetcattyDirectory } from './NetcattyDirectory'

import { syncFollowingNetcattyHosts } from './NetcattyConnection'
import { networkTypeColor, terminalBrandFields, terminalBusinessNetworkType, terminalHardwareFields, terminalNetworkRows, visibleAssetColumnKeys, UNCONFIGURED_FILTER_VALUE } from './assetTableModel'
import { hardwareField, useHardwareDrafts } from './HardwareFields'
import InfrastructureQuickConnect from './InfrastructureQuickConnect'
import { VendorBrandValue } from './VendorBrandIcon'
import VendorBrandInput from './VendorBrandInput'



const loadDirectory = async () => {

  const [people, statuses, categories, meta, networkTypes] = await Promise.all([allPages(api.persons), api.config('statuses'), api.taxonomy('terminal-categories'), api.meta(), api.config('network-types')])

  return {
    people,
    statuses: [...new Set([...(statuses.list || []).map((x) => x.name), ...(meta.statuses || []), ...(meta.asset_statuses || [])])],
    categories: categories.list || [],
    departments: meta.departments || [],
    rooms: meta.rooms || [],
    networkTypes: (networkTypes.list || []),
    assetUsers: meta.asset_users || [],
    assetDeviceTypes: meta.asset_device_types || [],
    assetOSTypes: meta.asset_os_types || [],
  }

}



export function LogTimeline({ logs = [] }) {

  return logs.length ? <ol className="mt-4 space-y-4 border-l border-border pl-4">{logs.map((log) => <li key={log.id}>

    <div className="flex flex-wrap items-center gap-2"><StatusPill>{log.log_type}</StatusPill><time className="text-xs text-muted-foreground">{log.log_time}</time><span className="text-xs text-muted-foreground">{log.operator}</span></div>

    {(log.from_user || log.to_user) && <p className="mt-1 text-sm">{log.from_user || '未分配'} → {log.to_user || '未分配'}</p>}

    {(log.from_location || log.to_location) && <p className="text-xs text-muted-foreground">{log.from_location || '-'} → {log.to_location || '-'}</p>}

    {(log.old_sn || log.new_sn) && <p className="text-xs font-mono">{log.old_sn || '-'} → {log.new_sn || '-'}</p>}

    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{log.description}</p>

  </li>)}</ol> : <EmptyState label="暂无履历" />

}



const terminalOperatingSystemTypes = ['Windows 11', 'Windows 10', 'Windows', '银河麒麟', '统信 UOS', 'openEuler', '龙蜥 Anolis OS', '中科方德', 'Ubuntu', 'Debian', 'CentOS', 'Rocky Linux', 'Red Hat Enterprise Linux', 'AlmaLinux', 'Linux', 'Unix', '其他', '未知', '不适用']



const TERMINAL_TABS = buildDeviceWorkspaceTabs('terminal', true)
const TERMINAL_FORM_TABS = [
  { key: 'basic', label: '基本信息' },
  { key: 'ownership', label: '归属与位置' },
  { key: 'network', label: '网络与系统' },
  { key: 'hardware', label: '硬件信息' },
  { key: 'credentials', label: '凭证中心' },
]

function TerminalIPAM({ asset, relations, onNavigate }) {
  const cloud = isCloudDevice(asset.device_type)
  const ips = [asset.ip, ...(cloud ? [asset.terminal_ip] : [])].filter((ip) => ip && !/外网/.test(ip))
  if (!ips.length) return <p className="text-xs text-muted-foreground">暂无可纳管的专网 IP</p>
  return ips.map((ip) => {
    const entry = relations?.ips?.find((item) => item.ip === ip)
    return <div key={ip} className="flex items-center justify-between py-1 text-xs">
      <span className="font-mono text-foreground">{ip}</span>
      <span className="text-muted-foreground">{entry ? `${entry.subnet} (${entry.status})` : '未纳入 IPAM'}</span>
      {entry ? <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onNavigate?.({ tableKey: 'ip_pool', id: entry.id, title: entry.ip, subtitle: entry.subnet })}>查看</Button> : null}
    </div>
  })
}

function AssetDetails({ id, host, onEdit, onArchive, onClose, onNetcattyChanged, onNavigate, expanded, onExpandedChange, onWidthChange }) {
  const loader = useCallback(async () => {
    const [detail, relations] = await Promise.all([api.asset(id), api.assetRelations(id)])
    return { ...detail, relations }
  }, [id])
  const query = useQuery(loader)
  const [tab, setTab] = useState(TERMINAL_TABS.defaultTab)
  useEffect(() => { setTab(TERMINAL_TABS.defaultTab) }, [id])

  if (query.error) return <AssetPanel open expanded={expanded} onExpandedChange={onExpandedChange} onWidthChange={onWidthChange} onClose={onClose} title="终端资产"><ErrorBanner message={query.error} onRetry={query.reload} /></AssetPanel>
  if (!query.data) return <AssetPanel open expanded={expanded} onExpandedChange={onExpandedChange} onWidthChange={onWidthChange} onClose={onClose} title="终端资产"><Spinner /></AssetPanel>

  const { asset, logs } = query.data
  const serial = terminalSerialProfile(asset)
  const roomText = asset.room ? (String(asset.room).endsWith('室') ? String(asset.room) : `${asset.room}室`) : '未登记'
  const ownerActions = <><ActionIcon label="调换使用人" onClick={() => onEdit('transfer', asset)}><ArrowLeftRight size={15} /></ActionIcon><ActionIcon label="维修换件" onClick={() => onEdit('maintenance', asset)}><Wrench size={15} /></ActionIcon><ActionIcon label="注销归档" onClick={() => onArchive(asset)}><Archive size={15} /></ActionIcon></>

  return <AssetPanel open expanded={expanded} onExpandedChange={onExpandedChange} onWidthChange={onWidthChange} onClose={onClose} title={asset.asset_name || asset.asset_code || '未命名设备'} subtitle={[asset.asset_code, asset.device_type].filter(Boolean).join(' · ')} status={asset.status} icon={Monitor} onEdit={() => onEdit('edit', asset)} actions={ownerActions} tabs={<AssetDetailTabBar tabs={TERMINAL_TABS.tabs} value={tab} onChange={setTab} panelId="terminal-detail-content" dataSection="terminal-detail-tabs" />}>
    <div id="terminal-detail-content" role="tabpanel" aria-labelledby={`terminal-detail-tabs-${tab}`} className="space-y-3">
    {tab === 'hardware' ? <AssetPanelSection title="硬件信息" icon={Cpu}><AssetPanelFields items={[
      ['设备名称', asset.asset_name || '-'],
      ['资产编号', asset.asset_code || '未配置'],
      ['设备类型', asset.device_type || '-'],
      [serial.primaryLabel, serial.primaryValue || '-'],
      ...(serial.secondaryValue ? [[serial.secondaryLabel, serial.secondaryValue]] : []),
      ...terminalBrandFields(asset.device_type).map(({ key, label }) => [label, key === 'vendor' ? <VendorBrandValue value={asset.vendor} model={asset.model} /> : asset[key]]),
      ...terminalHardwareFields(asset.device_type).filter(({ key }) => !['vendor', 'model'].includes(key)).map(({ key, label }) => [label, asset[key]]),
      ['设备状态', asset.status || '-'],
      ['建档时间', asset.created_at || '-'],
    ]} /></AssetPanelSection> : null}
    {tab === 'network' ? <>
      <AssetPanelSection title="网络配置" icon={Network}><AssetPanelFields items={[
        ...terminalNetworkRows(asset).map(({ label, ip }) => [label, <span className="inline-flex items-center gap-1 font-mono">{ip}<InfrastructureQuickConnect asset={asset} address={ip} assetType="terminal" /></span>]),
        ['网络类型', terminalBusinessNetworkType(asset)],
      ]} /></AssetPanelSection>
      <AssetPanelSection title="IPAM 地址" icon={Network}><TerminalIPAM asset={asset} relations={query.data.relations} onNavigate={onNavigate} /></AssetPanelSection>
    </> : null}
    {tab === 'usage' ? <AssetPanelSection title="使用与位置" icon={MapPin}><AssetPanelFields items={[
      ['当前使用人', asset.user_name || '公用 / 闲置'],
      ['部门', formatDepartmentName(asset.department) || '未分配部门'],
      ['房间 / 位置', roomText],
    ]} /></AssetPanelSection> : null}
    {tab === 'system' ? <AssetPanelSection title="系统信息" icon={MonitorCog}><AssetPanelFields items={[
      ['操作系统', <OperatingSystemCell asset={asset} host={host} />],
      ['系统版本', asset.os_version || '-'],
      ['备注', asset.remark || '-'],
    ]} /></AssetPanelSection> : null}
    {tab === 'photos' ? <AssetPanelSection title="设备照片" icon={ImageIcon}><DeviceImages kind="terminal" id={id} /></AssetPanelSection> : null}
    {tab === 'records' ? <AssetPanelSection title="设备履历" icon={History}><LogTimeline logs={logs || []} /></AssetPanelSection> : null}
    {tab === 'relations' ? <AssetPanelSection title="凭证中心" icon={KeyRound}><NetcattyLinks asset={{ ...asset, name: asset.asset_code }} assetType="terminal" assetId={id} embedded onChanged={onNetcattyChanged} /></AssetPanelSection> : null}
    </div>
  </AssetPanel>
}


export default function TerminalAssets({ keyword = '', focusTarget, command, leadingControl, headerActions, filtersExpanded = true, onFiltersExpandedChange, onPanelOpenChange, onNavigate }) {

	const [filters, setFilters] = useState({ device_type: '', dept: '', user_name: '', room: '', net_type: '', os_type: '', status: '', include_archived: '' })

  const [page, setPage] = useState(1)

  const [pageSize, setPageSize] = useState(20)

	const filterItems = [{ key: 'device_type', label: '设备类型' }, { key: 'dept', label: '部门' }, { key: 'user_name', label: '使用人' }, { key: 'room', label: '位置' }, { key: 'net_type', label: '网络类型' }, { key: 'os_type', label: '操作系统' }, { key: 'status', label: '设备状态' }, { key: 'include_archived', label: '含已注销' }]

	const { visible: visibleFilters, toggle: toggleFilter } = useAssetFilterSelection('terminals', filterItems, ['device_type', 'dept', 'status'], setFilters, () => setPage(1))

  const [detailId, setDetailId] = useState(null)

  const [detailRevision, setDetailRevision] = useState(0)

  const [editor, setEditor] = useState(null)
  const [editorBaseline, setEditorBaseline] = useState(null)
  const [formTab, setFormTab] = useState('basic')
  const [panelExpanded, setPanelExpanded] = useState(false)

  const [values, setValues] = useState({})

  const [archive, setArchive] = useState(null)
  const [selected, setSelected] = useState([])
  const [batchAction, setBatchAction] = useState(null)
  const [batchValues, setBatchValues] = useState({ device_type: '', os_type: '', os_version: '', status: '' })

  const [autoDetectError, setAutoDetectError] = useState('')

  useEffect(() => { setPanelExpanded(false) }, [detailId, editor])
  const hasSidePanel = !!detailId || !!editor && (editor.mode !== 'edit' || !!editor.record.id)
  const panelLayout = useAssetPanelLayout(hasSidePanel, panelExpanded, onPanelOpenChange)
  const closeEditor = useCallback(() => { setEditor(null); setEditorBaseline(null) }, [])
  const draftGuard = useAssetDraftGuard(editorBaseline, values, closeEditor)

  const handledCommandId = useRef(null)

  const action = useAction()

  const { hosts: netcattyHosts, updateHostAddress } = useNetcattyDirectory()

  const netcatty = useNetcattyConnectionEditor('terminal')

  const beginNetcattyConnection = netcatty.begin

  const directory = useDirectory(loadDirectory)

	const d = directory.data || { people: [], statuses: [], categories: [], departments: [], rooms: [], networkTypes: [], assetUsers: [], assetDeviceTypes: [], assetNetworkTypes: [], assetOSTypes: [] }

  const loader = useCallback(() => api.assets({ keyword, ...filters, page, page_size: pageSize }), [keyword, filters, page, pageSize])

  const query = useQuery(loader)

  const linkLoader = useCallback(() => api.netcattyLinks({ asset_type: 'terminal' }), [])

  const linkQuery = useQuery(linkLoader)

  const linkedHostByAssetID = useMemo(() => buildLinkedHostByAssetID(linkQuery.data?.list || [], netcattyHosts), [linkQuery.data, netcattyHosts])

  const assetRows = query.data?.list

  const reloadAssets = query.reload

  const autoDetectedAssetKeys = useRef(new Set())

  useEffect(() => {

    const pending = (assetRows || []).flatMap((asset) => {

      const host = linkedHostByAssetID.get(Number(asset.id))

      const osType = operatingSystemTypeFromDetectedHost(host, asset)

      const key = `${asset.id}:${host?.id || ''}:${host?.distro || ''}`

      if (!osType || autoDetectedAssetKeys.current.has(key)) return []

      autoDetectedAssetKeys.current.add(key)

      return [{ asset, osType, key }]

    })

    if (!pending.length) return undefined

    let active = true

    void Promise.allSettled(pending.map(({ asset, osType }) => api.updateAsset(asset.id, normalizeAsset({ ...asset, os_type: osType })))).then((results) => {

      if (!active) return

      results.forEach((result, index) => {

        if (result.status === 'rejected') autoDetectedAssetKeys.current.delete(pending[index].key)

      })

      const failed = results.find((result) => result.status === 'rejected')

      if (failed) setAutoDetectError(`自动写入识别到的操作系统失败：${failed.reason?.message || failed.reason}`)

      if (results.some((result) => result.status === 'fulfilled')) {

        if (!failed) setAutoDetectError('')

        reloadAssets()

        setDetailRevision((x) => x + 1)

      }

    })

    return () => { active = false }

  }, [assetRows, linkedHostByAssetID, reloadAssets])

  useEffect(() => { setPage(1) }, [keyword])

  const [focusedRowID, setFocusedRowID] = useState(null)
  useEffect(() => {
    if (focusTarget?.tableKey !== 'assets') return undefined
    setDetailId(focusTarget.id)
    setFocusedRowID(focusTarget.id)
    // 目标可能不在当前筛选或分页内：清空条件后逐页查找。
    setFilters({ device_type: '', dept: '', user_name: '', room: '', net_type: '', os_type: '', status: '', include_archived: '' })
    setPage(1)
    const timer = setTimeout(() => setFocusedRowID(null), 8000)
    return () => clearTimeout(timer)
  }, [focusTarget])
  useEffect(() => {
    if (focusedRowID == null) return undefined
    const list = query.data?.list || []
    if (!list.length) return undefined
    if (list.some((row) => String(row.id) === String(focusedRowID))) {
      const frame = requestAnimationFrame(() => {
        document.querySelector(`[data-row-key="${focusedRowID}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
      return () => cancelAnimationFrame(frame)
    }
    // 目标不在当前页：一次取全量定位真实页码，避免逐页翻动。
    let active = true
    const locate = async () => {
      const total = query.data?.total || 0
      const response = await api.assets({ page: 1, page_size: Math.max(total, pageSize) })
      if (!active) return
      const index = (response.list || []).findIndex((row) => String(row.id) === String(focusedRowID))
      if (index >= 0) setPage(Math.floor(index / pageSize) + 1)
    }
    void locate().catch(() => {})
    return () => { active = false }
  }, [focusedRowID, query.data, page, pageSize])

  const filter = (key, value) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1) }

  const open = useCallback((mode, record = {}) => {
    if (mode === 'edit') void beginNetcattyConnection(record.id || 0)
    const next = mode === 'transfer' ? { to_room: record.room, date: nowText(), operator: '资产管理员' }
      : mode === 'maintenance' ? { part_type: 'box', maintenance_type: isCloudDevice(record.device_type) ? '更换终端主机' : '更换设备', old_sn: record.box_sn, new_status: record.status, mark_old_as: '故障待修入库', date: nowText(), operator: '运维技术员' }
        : { asset_name: '', device_type: '', status: '在用', net_type: '', ...record }
    setEditor({ mode, record })
    setEditorBaseline(next)
    setValues(next)
    setFormTab('basic')
  }, [beginNetcattyConnection])

  useEffect(() => {

    if (!command?.id || command?.tab !== 'terminals' || handledCommandId.current === command.id) return

    handledCommandId.current = command.id

    if (command.type === 'create') open('edit')

    if (command.type === 'refresh') { query.reload(); directory.reload() }

  }, [command, directory, open, query])

  const peopleOptions = choices(d.people.map((p) => ({ value: p.id, label: [p.name, p.department, p.group_name].filter(Boolean).join(' · ') })))

  const maintenanceCloud = isCloudDevice(editor?.record?.device_type)

  const maintenanceParts = maintenanceCloud

    ? [{ value: 'box', label: '终端主机' }, { value: 'display', label: '显示器' }, { value: 'other', label: '整机维修排障' }]

    : [{ value: 'box', label: '设备' }, { value: 'other', label: '整机维修排障' }]

  const hardwareDrafts = useHardwareDrafts(`${editor ? 'open' : 'closed'}:${editor?.record?.id || 'new-terminal'}`)
  const fields = editor?.mode === 'transfer' ? [

    { key: 'to_person_id', label: '新使用人', required: true, numeric: true, options: peopleOptions, derive: (id) => ({ to_department: d.people.find((p) => p.id === id)?.department || '' }) },

    { key: 'to_department', label: '新部门', disabled: true }, ...textFields([['to_room', '新房间 / 位置'], ['new_ip', '新 IP（留空沿用当前 IP）'], ['date', '交接时间'], ['operator', '经办人'], ['description', '交接说明', 'textarea']]),

  ] : editor?.mode === 'maintenance' ? [

    { key: 'part_type', label: '维修部件', options: maintenanceParts, derive: (part) => ({ old_sn: part === 'box' ? editor.record.box_sn : part === 'display' ? editor.record.display_sn : '', maintenance_type: part === 'box' ? maintenanceCloud ? '更换终端主机' : '更换设备' : part === 'display' ? '更换显示器' : '整机维修排障' }) },

    ...textFields([['old_sn', '换下件 SN'], ['new_sn', '换上件 SN']]),

    { key: 'new_status', label: '维修后状态', options: choices(d.statuses) }, { key: 'mark_old_as', label: '旧件处理', options: choices(['故障待修入库', '报废'], '不登记旧件') },

    ...textFields([['date', '维修时间'], ['operator', '经办人'], ['description', '维修说明', 'textarea']]),

  ] : [

    { key: 'asset_name', label: '设备名称', placeholder: '留空自动生成：项目-简称-流水号' }, { key: 'asset_code', label: '资产编号' }, { key: 'device_type', label: '设备类型', required: true, searchable: true, options: choices([...new Set([...d.categories.map((item) => item.name), values.device_type].filter(Boolean))]) },

    { key: 'box_sn', label: isCloudDevice(values.device_type) ? '终端主机 SN' : '设备 SN' },

    { key: 'display_sn', label: '显示器 SN', hidden: !isCloudDevice(values.device_type) },

    ...(/台式|笔记本/.test(String(values.device_type || '')) && !isCloudDevice(values.device_type) ? [hardwareField('cpu_info', 'CPU 配置', hardwareDrafts), hardwareField('memory_mb', '内存', hardwareDrafts), hardwareField('disk_info', '硬盘 / 磁盘配置', hardwareDrafts)] : []),
    ...terminalBrandFields(values.device_type).map(({ key, label }) => ({ key, label, render: key === 'vendor' ? ({ current, onChange, props }) => <VendorBrandInput {...props} value={current} onChange={onChange} /> : undefined })),

    { key: 'person_id', label: '从人员目录选择', numeric: true, options: peopleOptions, derive: (id) => { const person = d.people.find((p) => p.id === id); return { user_name: person?.name || '', department: person?.department || '' } } },

    ...textFields([['user_name', '当前使用人'], ['department', '部门'], ['room', '房间 / 位置'], ['ip', isCloudDevice(values.device_type) ? '业务/虚拟机 IP' : '设备 IP']]),

    { key: 'terminal_ip', label: '终端物理 IP', hidden: !isCloudDevice(values.device_type) },

    { key: 'net_type', label: 'IP 网络类型', options: choices([...new Set([...d.networkTypes.map((item) => item.name), values.net_type].filter(Boolean))]) },

    { key: 'os_type', label: '操作系统类型', searchable: true, options: choices([...new Set([...terminalOperatingSystemTypes, values.os_type].filter(Boolean))]) },

    { key: 'os_version', label: '操作系统版本' },

    { key: 'status', label: '设备状态', options: choices([...new Set([...d.statuses, values.status].filter(Boolean))]) },

    { key: 'remark', label: '备注', type: 'textarea' },

  ]

  const save = () => action.run(async () => {

    validateFields(fields, values)

    if (editor.mode === 'transfer') {

      const person = d.people.find((p) => p.id === values.to_person_id)

      if (!person) throw new Error('请选择有效的新使用人')

      await api.transferAsset(editor.record.id, { ...values, to_user: person.name, to_department: person.department })

      await syncFollowingNetcattyHosts(api, { assetType: 'terminal', assetId: editor.record.id, hosts: netcattyHosts, updateHostAddress })

    } else if (editor.mode === 'maintenance') await api.maintainAsset(editor.record.id, values)

    else {

      const result = editor.record.id ? (await api.updateAsset(editor.record.id, normalizeAsset(values)), { id: editor.record.id }) : await api.createAsset(normalizeAsset(values))

      if (!editor.record.id) setEditor(current => ({ ...current, record: { ...values, id: result.id } }))

      await netcatty.persist(result.id)

    }

    closeEditor(); query.reload(); linkQuery.reload(); directoryChanged(); setDetailRevision((x) => x + 1)

  }, '已保存并记录履历')

  const openBatch = (type) => {
    setBatchAction(type)
    setBatchValues({ device_type: '', os_type: '', os_version: '', status: '' })
  }

  const batchFields = useMemo(() => {
    const fields = []
    if (!batchAction || batchAction === 'all' || batchAction === 'category') {
      fields.push({
        key: 'device_type',
        label: '设备类型',
        searchable: true,
        options: choices([
          { value: '', label: '（保持原设备类型不变）' },
          ...d.categories.map((item) => ({ value: item.name, label: item.name })),
        ]),
      })
    }
    if (!batchAction || batchAction === 'all' || batchAction === 'os') {
      fields.push({
        key: 'os_type',
        label: '操作系统类型',
        searchable: true,
        options: choices([
          { value: '', label: '（保持原操作系统不变）' },
          ...terminalOperatingSystemTypes.filter((t) => t !== '未知').map((item) => ({ value: item, label: item })),
        ]),
      })
      fields.push({
        key: 'os_version',
        label: '系统版本号',
        placeholder: '如：专业版 1050u2、22H2（选填，留空不修改）',
      })
    }
    if (batchAction === 'all') {
      fields.push({
        key: 'status',
        label: '设备状态',
        options: choices([
          { value: '', label: '（保持原状态不变）' },
          ...d.statuses.map((item) => ({ value: item, label: item })),
        ]),
      })
    }
    return fields
  }, [batchAction, d.categories, d.statuses])

  const saveBatch = async () => {
    const count = selected.length
    if (count === 0) return
    const changes = {}
    if (batchValues.device_type) {
      changes.device_type = batchValues.device_type
    }
    if (batchValues.os_type) {
      changes.os_type = batchValues.os_type
    }
    if (batchValues.os_version) {
      changes.os_version = batchValues.os_version
    }
    if (batchValues.status) {
      changes.status = batchValues.status
    }
    if (Object.keys(changes).length === 0) {
      setBatchAction(null)
      return
    }

    await action.run(async () => {
      await api.batchUpdateAssets(selected.map(Number), changes)
      setBatchAction(null)
      setSelected([])
      query.reload()
      directoryChanged()
      setDetailRevision((x) => x + 1)
    }, `已批量更新 ${count} 台终端信息`)
  }

  const columns = [
    {
      key: 'asset_code', label: '设备名称 / 资产编码 / SN', headerTitle: '设备名称 / 资产编码 / SN', width: 220, sticky: 'left', className: 'whitespace-nowrap', headerClassName: 'cmdb-asset-identity-header',
      render: (value, row) => {
        const name = (row.asset_name || '').trim()
        const code = (value || '').trim()
        const serial = terminalSerialProfile(row)
        const boxSN = (serial.primaryValue || '').trim()
        const displaySN = (serial.secondaryValue || '').trim()
        const serialValue = boxSN || displaySN
        const title = name || code || serialValue || '未命名设备'
        // 首行已展示名称或编号时，副行不再重复编号；无名称时编号即首行，副行只保留 SN。
        const lines = name
          ? [code && code !== title ? code : '', serialValue].filter(Boolean)
          : [serialValue].filter(Boolean)
        const subtitle = lines.length ? lines.join(' · ') : '未配置 SN'
        return <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <Button type="button" variant="link" title={title} className="h-auto min-w-0 max-w-full justify-start truncate whitespace-nowrap p-0 text-left text-xs font-semibold" onClick={() => setDetailId(row.id)}>{title}</Button>
            <span className="h-2 w-2 shrink-0 rounded-full border border-border/70" style={{ backgroundColor: networkTypeColor(terminalBusinessNetworkType(row), d.networkTypes) }} title={`网络类型：${terminalBusinessNetworkType(row)}`} aria-label={`网络类型：${terminalBusinessNetworkType(row)}`} />
          </div>
          {subtitle ? <p title={subtitle} className="mt-1 truncate text-[10px] leading-[1.45] text-muted-foreground">{subtitle}</p> : null}
        </div>
      },
    },
    {
      key: 'device_type', label: '设备类型', width: 90, className: 'whitespace-nowrap text-xs',
      render: (value) => value || '未配置',
    },
    {
      key: 'vendor_model', label: '品牌 / 型号', width: 165, className: 'whitespace-nowrap',
      render: (_, row) => <VendorBrandValue value={row.vendor} model={row.model} stacked className="text-xs" />,
    },
    {
      key: 'owner_department', label: '使用人 / 部门', width: 140, className: 'whitespace-nowrap',
      render: (_, row) => <div className="min-w-0 text-xs"><div className="truncate" title={row.user_name || '未分配使用人'}>{row.user_name || '未分配使用人'}</div><div className="mt-1 truncate text-[10px] leading-[1.45] text-muted-foreground" title={formatDepartmentName(row.department) || '未配置部门'}>{formatDepartmentName(row.department) || '未配置部门'}</div></div>,
    },
    {
      key: 'room', label: '房间号', width: 80, className: 'whitespace-nowrap text-xs',
      render: (value) => <span className="block truncate" title={value || '未配置'}>{value || '未配置'}</span>,
    },
    {
      key: 'ip', label: 'IP 地址', width: 145, className: 'whitespace-nowrap',
      render: (_, row) => { const addresses = terminalNetworkRows(row); return addresses.length ? <div className="space-y-0.5">{addresses.map((address) => <div key={address.key} className="flex min-w-0 items-center gap-1"><span className="truncate font-mono text-[11px]" title={`${address.label}：${address.ip}`}>{addresses.length > 1 ? `${address.key === 'business' ? '业务' : '终端'} ` : ''}{address.ip}</span><InfrastructureQuickConnect asset={row} address={address.ip} assetType="terminal" /></div>)}</div> : <span className="text-xs text-muted-foreground">未配置 IP</span> },
    },
    {
      key: 'network_type', label: '网络类型', width: 85, className: 'whitespace-nowrap',
      render: (_, row) => <span title={terminalBusinessNetworkType(row)} className="block truncate text-xs text-muted-foreground">{terminalBusinessNetworkType(row)}</span>,
    },
    { key: 'operating_system', label: '操作系统', width: 145, className: 'whitespace-nowrap', render: (_, row) => <OperatingSystemCell asset={row} host={linkedHostByAssetID.get(Number(row.id))} /> },
    { key: 'status', label: '设备状态', width: 80, sticky: 'right', className: 'whitespace-nowrap', render: (value) => <StatusPill tone={value === '闲置' ? 'warning' : statusTone(value)}>{value || '未配置'}</StatusPill> },
    { key: 'actions', label: '操作', width: 80, sticky: 'right', className: 'whitespace-nowrap', render: (_, row) => <AssetRowActions name={row.asset_name || row.asset_code || ''} onDetail={() => setDetailId(row.id)} onEdit={() => open('edit', row)} onTransfer={() => open('transfer', row)} onMaintenance={() => open('maintenance', row)} onArchive={() => setArchive(row)} /> },
  ]

  const columnByKey = Object.fromEntries(columns.map((column) => [column.key, column]))
  const visibleColumns = visibleAssetColumnKeys('terminal').map((key) => columnByKey[key]).filter(Boolean)
  const unconfiguredOption = { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }
  const deviceTypeOptions = choices([
    ...new Set([...d.assetDeviceTypes, ...d.categories.map((item) => item.name)].filter(Boolean)),
    unconfiguredOption,
  ], '全部')

  const editorMode = editor?.mode
  const editorTabs = editorMode === 'edit' ? TERMINAL_FORM_TABS : [{ key: 'basic', label: editorMode === 'transfer' ? '交接信息' : '维修记录' }]
  const editorBody = editor ? <>
    {editorMode === 'edit' ? <>
      <AssetFormPanel active={formTab === 'basic'} section="basic">
        <AssetPanelSection title="基本信息" icon={Monitor}><Fields fields={fields.filter(({ key }) => ['asset_name', 'asset_code', 'device_type', 'box_sn', 'display_sn', 'status'].includes(key))} value={values} onChange={setValues} /></AssetPanelSection>
      </AssetFormPanel>
      <AssetFormPanel active={formTab === 'ownership'} section="ownership">
        <AssetPanelSection title="归属与位置" icon={MapPin}><Fields fields={fields.filter(({ key }) => ['person_id', 'user_name', 'department', 'room'].includes(key))} value={values} onChange={setValues} /></AssetPanelSection>
      </AssetFormPanel>
      <AssetFormPanel active={formTab === 'network'} section="network">
        <AssetPanelSection title="网络与系统" icon={Network}><Fields fields={fields.filter(({ key }) => ['ip', 'terminal_ip', 'net_type', 'os_type', 'os_version', 'remark'].includes(key))} value={values} onChange={setValues} /></AssetPanelSection>
      </AssetFormPanel>
      <AssetFormPanel active={formTab === 'hardware'} section="hardware">
        <AssetPanelSection title="硬件信息" icon={Cpu}>{fields.some(field => ['vendor', 'model', 'cpu_info', 'memory_mb', 'disk_info'].includes(field.key)) ? <Fields fields={fields.filter(field => ['vendor', 'model', 'cpu_info', 'memory_mb', 'disk_info'].includes(field.key))} value={values} onChange={setValues} /> : <p className="text-xs text-muted-foreground">选择设备类型后可填写品牌与型号；CPU、内存和磁盘按适用设备类型显示。</p>}</AssetPanelSection>
      </AssetFormPanel>
      <AssetFormPanel active={formTab === 'credentials'} section="credentials">
        <AssetPanelSection title="凭证中心" icon={KeyRound}><NetcattyConnectionFields asset={{ name: values.asset_name || values.asset_code, ip: values.ip }} value={netcatty.connection} onChange={netcatty.setConnection} hosts={netcatty.hosts} credentials={netcatty.credentials} loading={netcatty.loading} error={netcatty.error} /></AssetPanelSection>
      </AssetFormPanel>
    </> : <AssetFormPanel active section="basic"><AssetPanelSection title={editorMode === 'transfer' ? '交接信息' : '维修记录'} icon={Monitor}><Fields fields={fields} value={values} onChange={setValues} /></AssetPanelSection></AssetFormPanel>}
  </> : null

  return <div className="cmdb-asset-page cmdb-terminal-assets flex min-h-0 min-w-0 flex-1 flex-col">

    {headerActions && createPortal(<><AssetFilterPicker expanded={filtersExpanded} onExpandedChange={onFiltersExpandedChange} items={filterItems} visible={visibleFilters} onToggle={toggleFilter} /><AssetTransferMenu importTitle="导入终端资产" importer={api.importAssets} onImported={query.reload} exporter={() => api.exportAssets({ keyword, ...filters })} /></>, headerActions)}

    <Toolbar className="cmdb-asset-toolbar" hidden={!filtersExpanded}>

      {leadingControl}

      {visibleFilters.includes('device_type') && <SelectControl prefix="类型" value={filters.device_type} onChange={(v) => filter('device_type', v)} options={deviceTypeOptions} className="w-36" />}

      {visibleFilters.includes('dept') && <SelectControl prefix="部门" value={filters.dept} onChange={(v) => filter('dept', v)} options={choices([...d.departments, unconfiguredOption], '全部')} className="w-36" />}

      {visibleFilters.includes('user_name') && <SelectControl prefix="使用人" value={filters.user_name} onChange={(v) => filter('user_name', v)} options={choices([...d.assetUsers, { value: UNCONFIGURED_FILTER_VALUE, label: '未分配' }], '全部')} className="w-36" />}

      {visibleFilters.includes('room') && <SelectControl prefix="位置" value={filters.room} onChange={(v) => filter('room', v)} options={choices([...d.rooms, unconfiguredOption], '全部')} className="w-36" />}

      {visibleFilters.includes('net_type') && <SelectControl prefix="网络" value={filters.net_type} onChange={(v) => filter('net_type', v)} options={choices([...d.networkTypes.map((item) => item.name), unconfiguredOption], '全部')} className="w-36" />}

      {visibleFilters.includes('os_type') && <SelectControl prefix="操作系统" value={filters.os_type} onChange={(v) => filter('os_type', v)} options={choices([...new Set([...terminalOperatingSystemTypes, ...d.assetOSTypes])].concat([unconfiguredOption]), '全部')} className="w-40" />}

      {visibleFilters.includes('status') && <SelectControl prefix="状态" value={filters.status} onChange={(v) => filter('status', v)} options={choices([...d.statuses, unconfiguredOption], '全部')} className="w-36" />}

      {visibleFilters.includes('include_archived') && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!filters.include_archived} onChange={(e) => filter('include_archived', e.target.checked ? '1' : '')} />含已注销</label>}

      <ActionIcon label="重置筛选" onClick={() => { setFilters({ device_type: '', dept: '', user_name: '', room: '', net_type: '', os_type: '', status: '', include_archived: '' }); setPage(1) }}><RotateCcw size={15} /></ActionIcon>

    </Toolbar>

    {(query.error || directory.error || linkQuery.error || autoDetectError) && <ErrorBanner message={query.error || directory.error || linkQuery.error || autoDetectError} onRetry={() => { setAutoDetectError(''); query.reload(); directory.reload(); linkQuery.reload() }} />}

    {selected.length > 0 && (
      <div className="my-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs shadow-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">已选中 <strong className="text-primary">{selected.length}</strong> 台终端设备</span>
          <span className="text-muted-foreground">|</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openBatch('all')}>批量修改属性</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openBatch('category')}>批量设置设备类型</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openBatch('os')}>批量设置操作系统</Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>取消选中</Button>
        </div>
      </div>
    )}

    <DataTable columns={visibleColumns} pinSelection assetLayout rows={query.error ? [] : query.data?.list || []} loading={query.loading} selected={selected} onSelectedChange={setSelected} highlightKey={focusedRowID} />

    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">
      <span>{`共 ${query.data?.total || 0} 条 · 第 ${page} / ${Math.max(1, Math.ceil((query.data?.total || 0) / pageSize))} 页`}</span>
      <div className="flex items-center gap-2">
        <SelectControl value={pageSize} onChange={(value) => { setPage(1); setPageSize(Number(value)) }} options={[10, 20, 50, 100].map((value) => ({ value, label: `${value} 条 / 页` }))} className="w-[108px] min-w-0" />
        <Button type="button" variant="outline" className="h-[30px] px-3 text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <Button type="button" variant="outline" className="h-[30px] px-3 text-xs" disabled={page >= Math.max(1, Math.ceil((query.data?.total || 0) / pageSize))} onClick={() => setPage(page + 1)}>下一页</Button>
      </div>
    </footer>

    {editor && (editor.mode === 'edit' && !editor.record.id
      ? <AssetCreateDialog open title="新增终端资产" onOpenChange={(value) => { if (!value) draftGuard.requestClose() }} busy={action.busy || netcatty.loading} icon={Monitor} tabs={editorTabs} tab={formTab} onTabChange={setFormTab} footer={<AssetPanelSave onCancel={draftGuard.requestClose} onSave={save} busy={action.busy || netcatty.loading} />}>{editorBody}</AssetCreateDialog>
      : <AssetPanel open expanded={panelExpanded} onExpandedChange={setPanelExpanded} onWidthChange={panelLayout.onWidthChange} onClose={draftGuard.requestClose} title={editor.mode === 'transfer' ? '调换使用人' : editor.mode === 'maintenance' ? '维修换件' : '编辑终端资产'} subtitle={editor.record.asset_code} icon={Monitor} tabs={<AssetFormTabs tabs={editorTabs} value={formTab} onChange={setFormTab} dataSection="terminal-form-tabs" />} footer={<AssetPanelSave onCancel={draftGuard.requestClose} onSave={save} busy={action.busy || netcatty.loading} />}>{editorBody}</AssetPanel>)}

    {batchAction && (
      <ModalForm
        title={batchAction === 'category' ? `批量设置设备类型（已选 ${selected.length} 台）` : batchAction === 'os' ? `批量设置操作系统（已选 ${selected.length} 台）` : `批量修改属性（已选 ${selected.length} 台）`}
        open={!!batchAction}
        onOpenChange={(v) => { if (!v) setBatchAction(null) }}
        busy={action.busy}
        onSubmit={saveBatch}
      >
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            请选择要批量应用的属性值，未填或保持不变的字段不会修改选中终端的既有数据。
          </p>
          <Fields fields={batchFields} value={batchValues} onChange={setBatchValues} />
        </div>
      </ModalForm>
    )}

    <ConfirmDialog open={!!archive} onOpenChange={(v) => { if (!v) setArchive(null) }} title="注销归档资产" message="资产资料和履历将保留，可通过“含已注销”查回。" confirmLabel="注销归档" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.archiveAsset(archive.id); setArchive(null); query.reload(); directoryChanged() }, '已注销归档')} />
    <AssetDraftDiscardDialog guard={draftGuard} busy={action.busy} />

  {detailId && !editor && <AssetDetails expanded={panelExpanded} onExpandedChange={setPanelExpanded} onWidthChange={panelLayout.onWidthChange} onNavigate={onNavigate} key={`${detailId}-${detailRevision}`} id={detailId} host={linkedHostByAssetID.get(Number(detailId))} onClose={() => setDetailId(null)} onEdit={open} onArchive={setArchive} onNetcattyChanged={linkQuery.reload} />}
  </div>

}
