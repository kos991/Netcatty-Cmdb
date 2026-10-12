import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createPortal } from 'react-dom'

import { Archive, ArrowLeftRight, History, Image as ImageIcon, Monitor, MoreHorizontal, Network, Pencil, RotateCcw, UserRound, Wrench } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'

import { Spinner } from '@/components/ui/spinner'

import { api } from './api'

import { allPages, directoryChanged, useAction, useDirectory, useQuery, useTableDensity } from './hooks'

import { choices, Fields, textFields, validateFields } from './Fields'

import { formatDepartmentName, isCloudDevice, normalizeAsset, nowText, terminalSerialProfile } from './state'

import { ActionIcon, DataTable, EmptyState, ErrorBanner, ModalForm, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'

import AssetTransferMenu from './AssetTransferMenu'

import NetcattyConnectionFields, { useNetcattyConnectionEditor } from './NetcattyConnectionFields'

import NetcattyLinks from './NetcattyLinks'

import DeviceImages from './DeviceImages'

import { AssetPanel, AssetPanelFields, AssetPanelSave, AssetPanelSection } from './AssetPanel'

import OperatingSystemCell from './OperatingSystemCell'

import AssetFilterPicker, { useAssetFilterSelection } from './AssetFilterPicker'

import { buildLinkedHostByAssetID, operatingSystemTypeFromDetectedHost } from './deviceWorkspaceModel'

import { useNetcattyDirectory } from './NetcattyDirectory'

import { syncFollowingNetcattyHosts } from './NetcattyConnection'
import { terminalBusinessNetworkType, terminalNetworkRows, visibleAssetColumnKeys, UNCONFIGURED_FILTER_VALUE } from './assetTableModel'



const loadDirectory = async () => {

  const [people, statuses, categories, meta, networkTypes] = await Promise.all([allPages(api.persons), api.config('statuses'), api.taxonomy('terminal-categories'), api.meta(), api.config('network-types')])

  return {
    people,
    statuses: [...new Set([...(statuses.list || []).map((x) => x.name), ...(meta.statuses || []), ...(meta.asset_statuses || [])])],
    categories: categories.list || [],
    departments: meta.departments || [],
    rooms: meta.rooms || [],
    networkTypes: [...new Set([...(networkTypes.list || []).map((item) => item.name), ...(meta.asset_network_types || [])])],
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



const terminalOperatingSystemTypes = ['Windows 11', 'Windows 10', 'Windows', '银河麒麟', '统信 UOS', 'openEuler', '龙蜥 Anolis OS', '中科方德', 'Ubuntu', 'Debian', 'CentOS', 'Rocky Linux', 'Red Hat Enterprise Linux', 'AlmaLinux', 'Linux', 'Unix', '其他', '未知']



function AssetDetails({ id, host, onEdit, onClose, onNetcattyChanged, onNavigate }) {
  const loader = useCallback(async () => {
    const [detail, relations] = await Promise.all([api.asset(id), api.assetRelations(id)])
    return { ...detail, relations }
  }, [id])

  const query = useQuery(loader)

  if (query.error) return <AssetPanel open onClose={onClose} title="终端资产"><ErrorBanner message={query.error} onRetry={query.reload} /></AssetPanel>
  if (!query.data) return <AssetPanel open onClose={onClose} title="终端资产"><Spinner /></AssetPanel>

  const { asset, logs } = query.data
  const serial = terminalSerialProfile(asset)
  const cloud = isCloudDevice(asset.device_type)
  const roomText = asset.room ? (String(asset.room).endsWith('室') ? String(asset.room) : `${asset.room}室`) : '未登记'

  return <AssetPanel open onClose={onClose} title={asset.asset_code || '未配置编码'} subtitle={asset.device_type} status={asset.status} icon={Monitor} onEdit={() => onEdit('edit', asset)}>
    <AssetPanelSection title="使用与位置" icon={UserRound} action={<div className="flex gap-1"><ActionIcon label="调换使用人" onClick={() => onEdit('transfer', asset)}><ArrowLeftRight size={15} /></ActionIcon><ActionIcon label="维修换件" onClick={() => onEdit('maintenance', asset)}><Wrench size={15} /></ActionIcon></div>}>
      <AssetPanelFields items={[
        ["当前使用人", asset.user_name || '公用 / 闲置'],
        ["部门", formatDepartmentName(asset.department) || '未分配部门'],
        ["房间 / 位置", roomText]
      ]} />
    </AssetPanelSection>

    <AssetPanelSection title="设备与网络" icon={Network}>
      <AssetPanelFields items={[
        ["资产编码", asset.asset_code || '-'],
        ["设备类型", asset.device_type || '-'],
        [serial.primaryLabel, serial.primaryValue || '-'],
        ...(serial.secondaryValue ? [[serial.secondaryLabel, serial.secondaryValue]] : []),
        ["操作系统", <OperatingSystemCell asset={asset} host={host} />],
        ...terminalNetworkRows(asset).map(({ label, ip }) => [label, ip]),
        ["网络类型", terminalBusinessNetworkType(asset)],
        ...(asset.remark ? [["备注", asset.remark]] : []),
        ["建档时间", asset.created_at || '-']
      ]} />
    </AssetPanelSection>

    <AssetPanelSection title="IPAM 地址" icon={Network}>
      {(() => {
        const ips = [asset.ip, ...(cloud ? [asset.terminal_ip] : [])].filter((ip) => ip && ip !== '外网' && !/外网/.test(ip))
        if (!ips.length) return <p className="text-xs text-muted-foreground">暂无可纳管的专网 IP</p>
        return ips.map((ip) => {
          const entry = query.data.relations?.ips?.find((item) => item.ip === ip)
          return (
            <div key={ip} className="flex items-center justify-between text-xs py-1">
              <span className="font-mono text-foreground">{ip}</span>
              <span className="text-muted-foreground">{entry ? `${entry.subnet} (${entry.status})` : '未纳入 IPAM'}</span>
              {entry ? (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onNavigate?.({ tableKey: 'ip_pool', id: entry.id, title: entry.ip, subtitle: entry.subnet })}>
                  查看
                </Button>
              ) : null}
            </div>
          )
        })
      })()}
    </AssetPanelSection>

    <AssetPanelSection title="设备照片" icon={ImageIcon}><DeviceImages kind="terminal" id={id} /></AssetPanelSection>
    <AssetPanelSection title="凭证中心" icon={Network}><NetcattyLinks asset={{ ...asset, name: asset.asset_code }} assetType="terminal" assetId={id} embedded onChanged={onNetcattyChanged} /></AssetPanelSection>
    <AssetPanelSection title="运维履历" icon={History}><LogTimeline logs={logs || []} /></AssetPanelSection>
  </AssetPanel>
}

function TerminalRowActions({ onDetail, onEdit, onTransfer, onMaintenance, onArchive }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="flex items-center gap-0.5">
      <ActionIcon label="编辑" onClick={onEdit}><Pencil size={14} /></ActionIcon>
      <ActionIcon label="调换使用人" onClick={onTransfer}><ArrowLeftRight size={14} /></ActionIcon>
      <Dropdown open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownTrigger asChild>
          <ActionIcon label="更多操作"><MoreHorizontal size={14} /></ActionIcon>
        </DropdownTrigger>
        <DropdownContent align="end" className="w-36">
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs hover:bg-secondary" onClick={() => { setMenuOpen(false); onDetail() }}><History size={14} />详情与履历</button>
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs hover:bg-secondary" onClick={() => { setMenuOpen(false); onMaintenance() }}><Wrench size={14} />维修换件</button>
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-destructive hover:bg-secondary" onClick={() => { setMenuOpen(false); onArchive() }}><Archive size={14} />注销归档</button>
        </DropdownContent>
      </Dropdown>
    </div>
  )
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

  const [tableRef, density] = useTableDensity()

  const [values, setValues] = useState({})

  const [archive, setArchive] = useState(null)
  const [selected, setSelected] = useState([])
  const [batchAction, setBatchAction] = useState(null)
  const [batchValues, setBatchValues] = useState({ device_type: '', os_type: '', os_version: '', status: '' })

  const [autoDetectError, setAutoDetectError] = useState('')

  useEffect(() => { onPanelOpenChange?.(!!detailId || !!editor) }, [detailId, editor, onPanelOpenChange])

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

  useEffect(() => { if (focusTarget?.tableKey === 'assets') setDetailId(focusTarget.id) }, [focusTarget])

  const filter = (key, value) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1) }

  const open = useCallback((mode, record = {}) => {

    if (mode === 'edit') void beginNetcattyConnection(record.id || 0)

    setEditor({ mode, record })

    setValues(mode === 'transfer' ? { to_room: record.room, date: nowText(), operator: '资产管理员' }

      : mode === 'maintenance' ? { part_type: 'box', maintenance_type: isCloudDevice(record.device_type) ? '更换终端主机' : '更换设备', old_sn: record.box_sn, new_status: record.status, mark_old_as: '故障待修入库', date: nowText(), operator: '运维技术员' }

		: { asset_name: '', device_type: '', status: '在用', net_type: '', ...record })

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

  const fields = editor?.mode === 'transfer' ? [

    { key: 'to_person_id', label: '新使用人', required: true, numeric: true, options: peopleOptions, derive: (id) => ({ to_department: d.people.find((p) => p.id === id)?.department || '' }) },

    { key: 'to_department', label: '新部门', disabled: true }, ...textFields([['to_room', '新房间 / 位置'], ['new_ip', '新 IP（留空沿用当前 IP）'], ['date', '交接时间'], ['operator', '经办人'], ['description', '交接说明', 'textarea']]),

  ] : editor?.mode === 'maintenance' ? [

    { key: 'part_type', label: '维修部件', options: maintenanceParts, derive: (part) => ({ old_sn: part === 'box' ? editor.record.box_sn : part === 'display' ? editor.record.display_sn : '', maintenance_type: part === 'box' ? maintenanceCloud ? '更换终端主机' : '更换设备' : part === 'display' ? '更换显示器' : '整机维修排障' }) },

    ...textFields([['old_sn', '换下件 SN'], ['new_sn', '换上件 SN']]),

    { key: 'new_status', label: '维修后状态', options: choices(d.statuses) }, { key: 'mark_old_as', label: '旧件处理', options: choices(['故障待修入库', '报废'], '不登记旧件') },

    ...textFields([['date', '维修时间'], ['operator', '经办人'], ['description', '维修说明', 'textarea']]),

  ] : [

		...textFields([['asset_name', '资产名称'], ['asset_code', '资产编码']]), { key: 'device_type', label: '设备类型', required: true, searchable: true, options: choices([...new Set([...d.categories.map((item) => item.name), values.device_type].filter(Boolean))]) },

    { key: 'box_sn', label: isCloudDevice(values.device_type) ? '终端主机 SN' : '设备 SN' },

    { key: 'display_sn', label: '显示器 SN', hidden: !isCloudDevice(values.device_type) },

    { key: 'person_id', label: '从人员目录选择', numeric: true, options: peopleOptions, derive: (id) => { const person = d.people.find((p) => p.id === id); return { user_name: person?.name || '', department: person?.department || '' } } },

    ...textFields([['user_name', '当前使用人'], ['department', '部门'], ['room', '房间 / 位置'], ['ip', isCloudDevice(values.device_type) ? '业务/虚拟机 IP' : '设备 IP']]),

    { key: 'terminal_ip', label: '终端物理 IP', hidden: !isCloudDevice(values.device_type) },

    { key: 'net_type', label: 'IP 网络类型', options: choices([...new Set([...d.networkTypes, values.net_type].filter(Boolean))]) },

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

    setEditor(null); query.reload(); linkQuery.reload(); directoryChanged(); setDetailRevision((x) => x + 1)

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
      key: 'asset_code', label: '资产编码', width: 170, sticky: 'left', className: 'whitespace-nowrap',
      render: (value, row) => <div className="min-w-0"><Button variant="link" title={value || '未配置编码'} className="h-auto max-w-full justify-start truncate p-0 text-left font-mono text-xs font-semibold text-foreground hover:underline" onClick={() => setDetailId(row.id)}>{value || '未配置编码'}</Button><p title={`${row.device_type || '未配置类型'} · ${terminalSerialProfile(row).primaryLabel}：${terminalSerialProfile(row).primaryValue || '未配置'}`} className="truncate text-[10px] text-muted-foreground">{row.device_type || '未配置类型'} · {terminalSerialProfile(row).primaryValue || '未配置 SN'}</p></div>,
    },
    {
      key: 'device_type', label: '设备类型', width: 100, className: 'whitespace-nowrap text-xs',
      render: (value) => value || '未配置',
    },
    {
      key: 'owner_department', label: '使用人 / 部门', width: 135, className: 'whitespace-nowrap',
      render: (_, row) => <div className="space-y-0.5 text-xs"><div>{row.user_name || '未分配使用人'}</div><div className="text-[11px] text-muted-foreground">{formatDepartmentName(row.department) || '未配置部门'}</div></div>,
    },
    {
      key: 'room', label: '房间 / 位置', width: 90, className: 'whitespace-nowrap text-xs',
      render: (value) => value || '未配置',
    },
    {
      key: 'ip', label: 'IP 地址', width: 165, className: 'whitespace-nowrap',
      render: (_, row) => { const addresses = terminalNetworkRows(row); return addresses.length ? <div className="space-y-0.5">{addresses.map((address) => <p key={address.key} className="truncate font-mono text-[11px]" title={`${address.label}：${address.ip}`}>{addresses.length > 1 ? `${address.key === 'business' ? '业务' : '终端'} ` : ''}{address.ip}</p>)}</div> : <span className="text-xs text-muted-foreground">未配置 IP</span> },
    },
    {
      key: 'network_type', label: '网络类型', width: 105, className: 'whitespace-nowrap',
      render: (_, row) => <span className="block truncate text-xs text-muted-foreground">{terminalBusinessNetworkType(row)}</span>,
    },
    { key: 'operating_system', label: '操作系统', width: 135, className: 'whitespace-nowrap', render: (_, row) => <OperatingSystemCell asset={row} host={linkedHostByAssetID.get(Number(row.id))} /> },
    { key: 'status', label: '设备状态', width: 92, sticky: 'right', className: 'whitespace-nowrap', render: (value) => <StatusPill tone={value === '闲置' ? 'warning' : statusTone(value)}>{value || '未配置'}</StatusPill> },
    { key: 'actions', label: '操作', width: 116, sticky: 'right', className: 'whitespace-nowrap', render: (_, row) => <TerminalRowActions onDetail={() => setDetailId(row.id)} onEdit={() => open('edit', row)} onTransfer={() => open('transfer', row)} onMaintenance={() => open('maintenance', row)} onArchive={() => setArchive(row)} /> },
  ]

  const columnByKey = Object.fromEntries(columns.map((column) => [column.key, column]))
  const visibleColumns = visibleAssetColumnKeys('terminal', density).map((key) => columnByKey[key]).filter(Boolean)
  const unconfiguredOption = { value: UNCONFIGURED_FILTER_VALUE, label: '未配置' }
  const deviceTypeOptions = choices([
    ...new Set([...d.assetDeviceTypes, ...d.categories.map((item) => item.name)].filter(Boolean)),
    unconfiguredOption,
  ], '全部')

  return <div ref={tableRef} className="flex min-h-0 flex-1 flex-col">

    {headerActions && createPortal(<><AssetFilterPicker expanded={filtersExpanded} onExpandedChange={onFiltersExpandedChange} items={filterItems} visible={visibleFilters} onToggle={toggleFilter} /><AssetTransferMenu importTitle="导入终端资产" importer={api.importAssets} onImported={query.reload} exporter={() => api.exportAssets({ keyword, ...filters })} /></>, headerActions)}

    <Toolbar hidden={!filtersExpanded}>

      {leadingControl}

      {visibleFilters.includes('device_type') && <SelectControl prefix="类型" value={filters.device_type} onChange={(v) => filter('device_type', v)} options={deviceTypeOptions} className="w-36" />}

      {visibleFilters.includes('dept') && <SelectControl prefix="部门" value={filters.dept} onChange={(v) => filter('dept', v)} options={choices([...d.departments, unconfiguredOption], '全部')} className="w-36" />}

      {visibleFilters.includes('user_name') && <SelectControl prefix="使用人" value={filters.user_name} onChange={(v) => filter('user_name', v)} options={choices([...d.assetUsers, { value: UNCONFIGURED_FILTER_VALUE, label: '未分配' }], '全部')} className="w-36" />}

      {visibleFilters.includes('room') && <SelectControl prefix="位置" value={filters.room} onChange={(v) => filter('room', v)} options={choices([...d.rooms, unconfiguredOption], '全部')} className="w-36" />}

      {visibleFilters.includes('net_type') && <SelectControl prefix="网络" value={filters.net_type} onChange={(v) => filter('net_type', v)} options={choices([...d.networkTypes, unconfiguredOption], '全部')} className="w-36" />}

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

    <DataTable columns={visibleColumns} pinSelection rowClassName="h-[48px]" compact={false} rows={query.error ? [] : query.data?.list || []} loading={query.loading} selected={selected} onSelectedChange={setSelected} />

    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />

    {detailId && <AssetDetails onNavigate={onNavigate} key={`${detailId}-${detailRevision}`} id={detailId} host={linkedHostByAssetID.get(Number(detailId))} onClose={() => setDetailId(null)} onEdit={open} onNetcattyChanged={linkQuery.reload} />}

    {editor && <AssetPanel open onClose={() => setEditor(null)} title={editor.mode === 'transfer' ? '调换使用人' : editor.mode === 'maintenance' ? '维修换件' : editor.record.id ? '编辑终端资产' : '新增终端资产'} subtitle={editor.record.asset_code} icon={Monitor} footer={<AssetPanelSave onCancel={() => setEditor(null)} onSave={save} busy={action.busy || netcatty.loading} />}>

      <AssetPanelSection title={editor.mode === 'transfer' ? '交接信息' : editor.mode === 'maintenance' ? '维修记录' : '设备档案'} icon={Monitor}><Fields fields={fields} value={values} onChange={setValues} /></AssetPanelSection>

      {editor.mode === 'edit' ? <AssetPanelSection title="凭证中心" icon={Network}><NetcattyConnectionFields asset={{ name: values.asset_code, ip: values.ip }} value={netcatty.connection} onChange={netcatty.setConnection} hosts={netcatty.hosts} credentials={netcatty.credentials} loading={netcatty.loading} error={netcatty.error} /></AssetPanelSection> : null}

    </AssetPanel>}

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

  </div>

}
