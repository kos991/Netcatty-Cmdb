import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArrowLeftRight, Download, FileSpreadsheet, History, Image as ImageIcon, Monitor, MoreHorizontal, Network, Pencil, RotateCcw, UserRound, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { Spinner } from '@/components/ui/spinner'
import { api } from './api'
import { allPages, directoryChanged, useAction, useDirectory, useQuery, useTableDensity } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { isCloudDevice, normalizeAsset, nowText, terminalSerialProfile } from './state'
import { ActionIcon, DataTable, EmptyState, ErrorBanner, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'
import ImportDialog from './ImportDialog'
import NetcattyConnectionFields, { useNetcattyConnectionEditor } from './NetcattyConnectionFields'
import NetcattyLinks from './NetcattyLinks'
import DeviceImages from './DeviceImages'
import { AssetPanel, AssetPanelFields, AssetPanelSave, AssetPanelSection } from './AssetPanel'
import OperatingSystemCell from './OperatingSystemCell'
import { buildLinkedHostByAssetID, operatingSystemTypeFromDetectedHost } from './deviceWorkspaceModel'
import { useNetcattyDirectory } from './NetcattyDirectory'

const loadDirectory = async () => {
  const [people, statuses, categories, groups, meta] = await Promise.all([allPages(api.persons), api.config('statuses'), api.taxonomy('terminal-categories'), api.taxonomy('groups'), api.meta()])
  return { people, statuses: [...new Set([...(statuses.list || []).map((x) => x.name), ...(meta.statuses || [])])], categories: categories.list || [], groups: groups.list || [], departments: meta.departments || [] }
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

function AssetDetails({ id, host, onEdit, onClose, onNetcattyChanged }) {
  const loader = useCallback(async () => {
    return api.asset(id)
  }, [id])
  const query = useQuery(loader)
  if (query.error) return <AssetPanel open onClose={onClose} title="终端资产"><ErrorBanner message={query.error} onRetry={query.reload} /></AssetPanel>
  if (!query.data) return <AssetPanel open onClose={onClose} title="终端资产"><Spinner /></AssetPanel>
  const { asset, logs } = query.data
  const cloud = isCloudDevice(asset.device_type)
  const serial = terminalSerialProfile(asset)
  return <AssetPanel open onClose={onClose} title={asset.asset_code || `终端资产 #${id}`} subtitle={asset.device_type} status={asset.status} icon={Monitor} onEdit={() => onEdit('edit', asset)}>
    <AssetPanelSection title="使用与位置" icon={UserRound} action={<div className="flex gap-1"><ActionIcon label="调换使用人" onClick={() => onEdit('transfer', asset)}><ArrowLeftRight size={15} /></ActionIcon><ActionIcon label="维修换件" onClick={() => onEdit('maintenance', asset)}><Wrench size={15} /></ActionIcon></div>}><AssetPanelFields items={[["当前使用人", asset.user_name], ["部门", asset.department], ["房间 / 位置", asset.room]]} /></AssetPanelSection>
    <AssetPanelSection title="设备与网络" icon={Network}><AssetPanelFields items={[["资产编码", asset.asset_code], ["设备类型", asset.device_type], ["所属分组", asset.group_name], [serial.primaryLabel, serial.primaryValue], ...(serial.secondaryLabel ? [[serial.secondaryLabel, serial.secondaryValue]] : []), ["操作系统", <OperatingSystemCell asset={asset} host={host} />], [cloud ? '业务/虚拟机 IP' : '设备 IP', asset.ip], ...(cloud ? [['终端物理 IP', asset.terminal_ip]] : []), ["IP 网络类型", asset.net_type], ["备注", asset.remark], ["建档时间", asset.created_at]]} /></AssetPanelSection>
    <AssetPanelSection title="设备照片" icon={ImageIcon}><DeviceImages kind="terminal" id={id} /></AssetPanelSection>
    <AssetPanelSection title="凭证中心" icon={Network}><NetcattyLinks assetType="terminal" assetId={id} embedded onChanged={onNetcattyChanged} /></AssetPanelSection>
    <AssetPanelSection title="运维履历" icon={History}><LogTimeline logs={logs || []} /></AssetPanelSection>
  </AssetPanel>
}

function TerminalRowActions({ record, compact, onDetail, onEdit, onTransfer, onMaintenance, onArchive }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const actions = [
    ['详情与履历', History, onDetail], ['编辑', Pencil, onEdit], ['调换使用人', ArrowLeftRight, onTransfer],
    ['维修换件', Wrench, onMaintenance], ['注销归档', Archive, onArchive],
  ]
  if (!compact) return <div className="flex">{actions.map(([label, Icon, handler]) => <ActionIcon key={label} label={label} danger={label === '注销归档'} onClick={handler}><Icon size={15} /></ActionIcon>)}</div>
  return <Dropdown open={menuOpen} onOpenChange={setMenuOpen}>
    <DropdownTrigger asChild><ActionIcon label={`操作 ${record.asset_code || record.id}`}><MoreHorizontal size={16} /></ActionIcon></DropdownTrigger>
    <DropdownContent align="end" className="w-40">{actions.map(([label, Icon, handler]) => <button type="button" key={label} className={`flex h-8 w-full items-center gap-2 rounded px-2 text-xs hover:bg-secondary ${label === '注销归档' ? 'text-destructive' : ''}`} onClick={() => { setMenuOpen(false); handler() }}><Icon size={14} />{label}</button>)}</DropdownContent>
  </Dropdown>
}

export default function TerminalAssets({ keyword = '', focusTarget, command, leadingControl, onPanelOpenChange }) {
  const [filters, setFilters] = useState({ device_type: '', group_id: '', dept: '', status: '', include_archived: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [detailId, setDetailId] = useState(null)
  const [detailRevision, setDetailRevision] = useState(0)
  const [editor, setEditor] = useState(null)
  const [tableRef, density] = useTableDensity()
  const [values, setValues] = useState({})
  const [archive, setArchive] = useState(null)
  const [autoDetectError, setAutoDetectError] = useState('')
  useEffect(() => { onPanelOpenChange?.(!!detailId || !!editor) }, [detailId, editor, onPanelOpenChange])
  const handledCommandId = useRef(null)
  const action = useAction()
  const { hosts: netcattyHosts } = useNetcattyDirectory()
  const netcatty = useNetcattyConnectionEditor('terminal')
  const beginNetcattyConnection = netcatty.begin
  const directory = useDirectory(loadDirectory)
  const d = directory.data || { people: [], statuses: [], categories: [], groups: [], departments: [] }
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
        : { device_type: '', group_id: 0, status: '在用', net_type: '专网', ...record })
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
    ...textFields([['asset_code', '资产编码']]), { key: 'device_type', label: '设备类型', required: true, searchable: true, options: choices([...new Set([...d.categories.map((item) => item.name), values.device_type].filter(Boolean))]) },
    { key: 'group_id', label: '所属分组', numeric: true, searchable: true, options: choices(d.groups.map((item) => ({ value: item.id, label: item.name })), '未分组') },
    { key: 'box_sn', label: isCloudDevice(values.device_type) ? '终端主机 SN' : '设备 SN' },
    { key: 'display_sn', label: '显示器 SN', hidden: !isCloudDevice(values.device_type) },
    { key: 'person_id', label: '从人员目录选择', numeric: true, options: peopleOptions, derive: (id) => { const person = d.people.find((p) => p.id === id); return { user_name: person?.name || '', department: person?.department || '' } } },
    ...textFields([['user_name', '当前使用人'], ['department', '部门'], ['room', '房间 / 位置'], ['ip', isCloudDevice(values.device_type) ? '业务/虚拟机 IP' : '设备 IP']]),
    { key: 'terminal_ip', label: '终端物理 IP', hidden: !isCloudDevice(values.device_type) },
    { key: 'net_type', label: 'IP 网络类型', options: choices(['专网', '外网', '内网']) },
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
    } else if (editor.mode === 'maintenance') await api.maintainAsset(editor.record.id, values)
    else {
      const result = editor.record.id ? (await api.updateAsset(editor.record.id, normalizeAsset(values)), { id: editor.record.id }) : await api.createAsset(normalizeAsset(values))
      await netcatty.persist(result.id)
    }
    setEditor(null); query.reload(); linkQuery.reload(); directoryChanged(); setDetailRevision((x) => x + 1)
  }, '已保存并记录履历')
  const columns = [
    { key: 'asset_code', label: '资产 / 分类 / 分组', render: (v, r) => <div><Button variant="link" className="h-auto p-0" onClick={() => setDetailId(r.id)}>{v || `#${r.id}`}</Button><p className="mt-1 text-xs text-muted-foreground">{r.device_type || '未分类'} · {r.group_name || '未分组'}</p></div> },
    { key: 'user_name', label: '使用人 / 部门', render: (v, r) => <div>{v || '公用 / 闲置'}<p className="text-xs text-muted-foreground">{r.department} {r.room}</p></div> },
    { key: 'box_sn', label: '设备 SN', render: (_, r) => { const serial = terminalSerialProfile(r); return <div className="font-mono text-xs"><span>{serial.primaryValue || '-'}</span>{serial.secondaryLabel && <p className="mt-1 text-muted-foreground">显示器：{serial.secondaryValue || '-'}</p>}</div> } },
    { key: 'operating_system', label: '操作系统', className: 'min-w-[150px]', render: (_, r) => <OperatingSystemCell asset={r} host={linkedHostByAssetID.get(Number(r.id))} /> },
    { key: 'ip', label: 'IP / 网络类型', render: (v, r) => <div className="whitespace-nowrap"><span className="font-mono text-xs">{v || '-'}</span>{isCloudDevice(r.device_type) && r.terminal_ip && <p className="text-xs text-muted-foreground">物理：{r.terminal_ip}</p>}<p className="mt-1 text-xs text-muted-foreground">{r.net_type || '未设置'}</p></div> },
    { key: 'status', label: '设备状态', className: 'min-w-[110px] whitespace-nowrap', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
    { key: 'actions', label: '操作', render: (_, r) => <TerminalRowActions record={r} compact={false} onDetail={() => setDetailId(r.id)} onEdit={() => open('edit', r)} onTransfer={() => open('transfer', r)} onMaintenance={() => open('maintenance', r)} onArchive={() => setArchive(r)} /> },
  ]
  const compactColumns = [
    { key: 'asset_code', label: '资产 / IP', render: (v, r) => <div className="min-w-0"><Button variant="link" className="h-auto max-w-full truncate p-0" onClick={() => setDetailId(r.id)}>{v || `#${r.id}`}</Button><p className="truncate text-[11px] text-muted-foreground">{r.device_type || '未分类'} · {r.group_name || '未分组'} · {r.ip || '无 IP'}</p></div> },
    { key: 'status', label: '状态', headerClassName: 'w-24', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
    { key: 'actions', label: '操作', headerClassName: 'w-14', render: (_, r) => <TerminalRowActions record={r} compact onDetail={() => setDetailId(r.id)} onEdit={() => open('edit', r)} onTransfer={() => open('transfer', r)} onMaintenance={() => open('maintenance', r)} onArchive={() => setArchive(r)} /> },
  ]
  const mediumColumns = columns.filter((column) => ['asset_code', 'operating_system', 'ip', 'status', 'actions'].includes(column.key))
  const visibleColumns = density === 'compact' ? compactColumns : density === 'medium' ? mediumColumns : columns
  return <div ref={tableRef} className="flex min-h-0 flex-1 flex-col">
    <Toolbar>
      {leadingControl}
      <SelectControl value={filters.device_type} onChange={(v) => filter('device_type', v)} options={choices(d.categories.map((item) => item.name), '全部设备分类')} className="w-36" />
      <SelectControl value={filters.group_id} onChange={(v) => filter('group_id', v)} options={choices(d.groups.map((item) => ({ value: item.id, label: item.name })), '全部资产分组')} className="w-36" />
      <SelectControl value={filters.dept} onChange={(v) => filter('dept', v)} options={choices(d.departments, '全部部门')} className="w-36" />
      <SelectControl value={filters.status} onChange={(v) => filter('status', v)} options={choices(d.statuses, '全部状态')} className="w-36" />
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!filters.include_archived} onChange={(e) => filter('include_archived', e.target.checked ? '1' : '')} />含已注销</label>
      <ActionIcon label="重置筛选" onClick={() => { setFilters({ device_type: '', group_id: '', dept: '', status: '', include_archived: '' }); setPage(1) }}><RotateCcw size={15} /></ActionIcon>
      <div className="ml-auto flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={action.busy} onClick={() => action.run(api.downloadAssetTemplate)}><FileSpreadsheet size={14} className="mr-1" />模板</Button><ImportDialog title="导入终端资产" importer={api.importAssets} onImported={query.reload} /><Button size="sm" variant="outline" disabled={action.busy} onClick={() => action.run(() => api.exportAssets({ keyword, ...filters }))}><Download size={14} className="mr-2" />导出</Button></div>
    </Toolbar>
    {(query.error || directory.error || linkQuery.error || autoDetectError) && <ErrorBanner message={query.error || directory.error || linkQuery.error || autoDetectError} onRetry={() => { setAutoDetectError(''); query.reload(); directory.reload(); linkQuery.reload() }} />}
    <DataTable columns={visibleColumns} compact={density !== 'wide'} rows={query.error ? [] : query.data?.list || []} loading={query.loading} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    {detailId && <AssetDetails key={`${detailId}-${detailRevision}`} id={detailId} host={linkedHostByAssetID.get(Number(detailId))} onClose={() => setDetailId(null)} onEdit={open} onNetcattyChanged={linkQuery.reload} />}
    {editor && <AssetPanel open onClose={() => setEditor(null)} title={editor.mode === 'transfer' ? '调换使用人' : editor.mode === 'maintenance' ? '维修换件' : editor.record.id ? '编辑终端资产' : '新增终端资产'} subtitle={editor.record.asset_code} icon={Monitor} footer={<AssetPanelSave onCancel={() => setEditor(null)} onSave={save} busy={action.busy || netcatty.loading} />}>
      <AssetPanelSection title={editor.mode === 'transfer' ? '交接信息' : editor.mode === 'maintenance' ? '维修记录' : '设备档案'} icon={Monitor}><Fields fields={fields} value={values} onChange={setValues} /></AssetPanelSection>
      {editor.mode === 'edit' ? <AssetPanelSection title="凭证中心" icon={Network}><NetcattyConnectionFields asset={{ name: values.asset_code, ip: values.ip }} value={netcatty.connection} onChange={netcatty.setConnection} hosts={netcatty.hosts} credentials={netcatty.credentials} loading={netcatty.loading} error={netcatty.error} /></AssetPanelSection> : null}
    </AssetPanel>}
    <ConfirmDialog open={!!archive} onOpenChange={(v) => { if (!v) setArchive(null) }} title="注销归档资产" message="资产资料和履历将保留，可通过“含已注销”查回。" confirmLabel="注销归档" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.archiveAsset(archive.id); setArchive(null); query.reload(); directoryChanged() }, '已注销归档')} />
  </div>
}
