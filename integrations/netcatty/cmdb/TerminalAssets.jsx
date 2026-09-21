import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, ArrowLeftRight, Download, FileSpreadsheet, History, Pencil, RotateCcw, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Spinner } from '@/components/ui/spinner'
import { api } from './api'
import { allPages, directoryChanged, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { isCloudDevice, normalizeAsset, nowText } from './state'
import { ActionIcon, DataTable, DefinitionList, DetailSheet, EmptyState, ErrorBanner, ModalForm, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'
import ImportDialog from './ImportDialog'

const loadDirectory = async () => {
  const [people, statuses, types, software, meta] = await Promise.all([allPages(api.persons), api.config('statuses'), api.config('device-types'), api.config('software'), api.meta()])
  return { people, statuses: [...new Set([...(statuses.list || []).map((x) => x.name), ...(meta.statuses || [])])], types: [...new Set((types.list || []).map((x) => x.name))], software: (software.list || []).map((x) => x.name), departments: meta.departments || [] }
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

function AssetDetails({ id, onNavigate, onEdit }) {
  const loader = useCallback(async () => {
    const [record, relations] = await Promise.all([api.asset(id), api.assetRelations(id)])
    return { ...record, relations }
  }, [id])
  const query = useQuery(loader)
  if (query.error) return <ErrorBanner message={query.error} onRetry={query.reload} />
  if (!query.data) return <Spinner />
  const { asset, logs, relations } = query.data
  const cloud = isCloudDevice(asset.device_type)
  return <div className="space-y-5">
    <DefinitionList items={[
      ['资产编码', asset.asset_code], ['设备类型', asset.device_type], ['设备状态', <StatusPill tone={statusTone(asset.status)}>{asset.status}</StatusPill>], ['当前使用人', asset.user_name], ['部门', asset.department], ['房间 / 位置', asset.room], ['终端主机 SN', asset.box_sn], ['显示器 SN', asset.display_sn], [cloud ? '业务/虚拟机 IP' : '设备 IP', asset.ip], ...(cloud ? [['终端物理 IP', asset.terminal_ip]] : []), ['IP 网络类型', asset.net_type], ['软件安装情况', asset.security_software], ['备注', asset.remark], ['建档时间', asset.created_at],
    ]} />
    <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => onEdit('edit', asset)}>编辑资产</Button><Button size="sm" variant="outline" onClick={() => onEdit('transfer', asset)}>调换使用人</Button><Button size="sm" variant="outline" onClick={() => onEdit('maintenance', asset)}>维修换件</Button></div>
    <section><h3 className="mb-2 text-sm font-medium">关联信息</h3>
      {[
        ['ips', '关联 IP', 'ip_pool', (x) => x.ip], ['servers', '关联基础设施', 'servers', (x) => x.device_name], ['apps', '关联业务系统', 'server_apps', (x) => x.app_name],
      ].map(([key, label, tableKey, name]) => <div key={key} className="flex flex-wrap items-center gap-2 py-1 text-sm"><span className="w-28 text-muted-foreground">{label}</span>{relations[key]?.length ? relations[key].map((item) => <Button key={item.id} variant="link" size="sm" onClick={() => onNavigate({ tableKey, id: item.id, title: name(item), subtitle: item.subnet })}>{name(item)}</Button>) : <span className="text-muted-foreground">未关联</span>}</div>)}
    </section>
    <section><h3 className="text-sm font-medium">运维履历</h3><LogTimeline logs={logs || []} /></section>
  </div>
}

export default function TerminalAssets({ keyword = '', focusTarget, onNavigate, command, leadingControl }) {
  const [filters, setFilters] = useState({ dept: '', status: '', security_software: '', include_archived: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [detailId, setDetailId] = useState(null)
  const [detailRevision, setDetailRevision] = useState(0)
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [archive, setArchive] = useState(null)
  const handledCommandId = useRef(null)
  const action = useAction()
  const directory = useDirectory(loadDirectory)
  const d = directory.data || { people: [], statuses: [], types: [], software: [], departments: [] }
  const loader = useCallback(() => api.assets({ keyword, ...filters, page, page_size: pageSize }), [keyword, filters, page, pageSize])
  const query = useQuery(loader)
  useEffect(() => { setPage(1) }, [keyword])
  useEffect(() => { if (focusTarget?.tableKey === 'assets') setDetailId(focusTarget.id) }, [focusTarget])
  const filter = (key, value) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1) }
  const open = useCallback((mode, record = {}) => {
    setEditor({ mode, record })
    setValues(mode === 'transfer' ? { to_room: record.room, date: nowText(), operator: '资产管理员' }
      : mode === 'maintenance' ? { part_type: 'box', maintenance_type: '更换终端主机', old_sn: record.box_sn, new_status: record.status, mark_old_as: '故障待修入库', date: nowText(), operator: '运维技术员' }
        : { device_type: '', status: '在用', net_type: '专网', ...record })
  }, [])
  useEffect(() => {
    if (!command?.id || command?.tab !== 'terminals' || handledCommandId.current === command.id) return
    handledCommandId.current = command.id
    if (command.type === 'create') open('edit')
    if (command.type === 'refresh') { query.reload(); directory.reload() }
  }, [command, directory, open, query])
  const peopleOptions = choices(d.people.map((p) => ({ value: p.id, label: [p.name, p.department, p.group_name].filter(Boolean).join(' · ') })))
  const fields = editor?.mode === 'transfer' ? [
    { key: 'to_person_id', label: '新使用人', required: true, numeric: true, options: peopleOptions, derive: (id) => ({ to_department: d.people.find((p) => p.id === id)?.department || '' }) },
    { key: 'to_department', label: '新部门', disabled: true }, ...textFields([['to_room', '新房间 / 位置'], ['new_ip', '新 IP（留空沿用当前 IP）'], ['date', '交接时间'], ['operator', '经办人'], ['description', '交接说明', 'textarea']]),
  ] : editor?.mode === 'maintenance' ? [
    { key: 'part_type', label: '维修部件', options: [{ value: 'box', label: '终端主机' }, { value: 'display', label: '显示器' }, { value: 'other', label: '整机维修排障' }], derive: (part) => ({ old_sn: part === 'box' ? editor.record.box_sn : part === 'display' ? editor.record.display_sn : '', maintenance_type: part === 'box' ? '更换终端主机' : part === 'display' ? '更换显示器' : '整机维修排障' }) },
    ...textFields([['old_sn', '换下件 SN'], ['new_sn', '换上件 SN']]),
    { key: 'new_status', label: '维修后状态', options: choices(d.statuses) }, { key: 'mark_old_as', label: '旧件处理', options: choices(['故障待修入库', '报废'], '不登记旧件') },
    ...textFields([['date', '维修时间'], ['operator', '经办人'], ['description', '维修说明', 'textarea']]),
  ] : [
    ...textFields([['asset_code', '资产编码']]), { key: 'device_type', label: '设备类型', required: true, options: choices([...new Set([...d.types, values.device_type].filter(Boolean))]) },
    ...textFields([['box_sn', '终端主机 SN'], ['display_sn', '显示器 SN']]),
    { key: 'person_id', label: '从人员目录选择', numeric: true, options: peopleOptions, derive: (id) => { const person = d.people.find((p) => p.id === id); return { user_name: person?.name || '', department: person?.department || '' } } },
    ...textFields([['user_name', '当前使用人'], ['department', '部门'], ['room', '房间 / 位置'], ['ip', isCloudDevice(values.device_type) ? '业务/虚拟机 IP' : '设备 IP']]),
    { key: 'terminal_ip', label: '终端物理 IP', hidden: !isCloudDevice(values.device_type) },
    { key: 'net_type', label: 'IP 网络类型', options: choices(['专网', '外网', '内网']) },
    { key: 'status', label: '设备状态', options: choices([...new Set([...d.statuses, values.status].filter(Boolean))]) },
    { key: 'security_software', label: '软件安装情况', options: choices([...new Set([...d.software, values.security_software].filter(Boolean))], '未登记') },
    { key: 'remark', label: '备注', type: 'textarea' },
  ]
  const save = () => action.run(async () => {
    validateFields(fields, values)
    if (editor.mode === 'transfer') {
      const person = d.people.find((p) => p.id === values.to_person_id)
      if (!person) throw new Error('请选择有效的新使用人')
      await api.transferAsset(editor.record.id, { ...values, to_user: person.name, to_department: person.department })
    } else if (editor.mode === 'maintenance') await api.maintainAsset(editor.record.id, values)
    else if (editor.record.id) await api.updateAsset(editor.record.id, normalizeAsset(values))
    else await api.createAsset(normalizeAsset(values))
    setEditor(null); query.reload(); directoryChanged(); setDetailRevision((x) => x + 1)
  }, '已保存并记录履历')
  const columns = [
    { key: 'asset_code', label: '资产 / 设备类型', render: (v, r) => <div><Button variant="link" className="h-auto p-0" onClick={() => setDetailId(r.id)}>{v || `#${r.id}`}</Button><p className="mt-1 text-xs text-muted-foreground">{r.device_type}</p></div> },
    { key: 'user_name', label: '使用人 / 部门', render: (v, r) => <div>{v || '公用 / 闲置'}<p className="text-xs text-muted-foreground">{r.department} {r.room}</p></div> },
    { key: 'box_sn', label: '终端主机 SN', className: 'font-mono text-xs' }, { key: 'display_sn', label: '显示器 SN', className: 'font-mono text-xs' },
    { key: 'ip', label: 'IP / 网络类型', render: (v, r) => <div className="whitespace-nowrap"><span className="font-mono text-xs">{v || '-'}</span>{isCloudDevice(r.device_type) && r.terminal_ip && <p className="text-xs text-muted-foreground">物理：{r.terminal_ip}</p>}<p className="mt-1 text-xs text-muted-foreground">{r.net_type || '未设置'}</p></div> },
    { key: 'security_software', label: '软件安装情况' }, { key: 'status', label: '设备状态', className: 'min-w-[110px] whitespace-nowrap', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
    { key: 'actions', label: '操作', render: (_, r) => <div className="flex"><ActionIcon label="详情与履历" onClick={() => setDetailId(r.id)}><History size={15} /></ActionIcon><ActionIcon label="编辑" onClick={() => open('edit', r)}><Pencil size={15} /></ActionIcon><ActionIcon label="调换使用人" onClick={() => open('transfer', r)}><ArrowLeftRight size={15} /></ActionIcon><ActionIcon label="维修换件" onClick={() => open('maintenance', r)}><Wrench size={15} /></ActionIcon><ActionIcon label="注销归档" danger onClick={() => setArchive(r)}><Archive size={15} /></ActionIcon></div> },
  ]
  return <div className="flex min-h-0 flex-1 flex-col">
    <Toolbar>
      {leadingControl}
      <SelectControl value={filters.dept} onChange={(v) => filter('dept', v)} options={choices(d.departments, '全部部门')} className="w-36" />
      <SelectControl value={filters.status} onChange={(v) => filter('status', v)} options={choices(d.statuses, '全部状态')} className="w-36" />
      <SelectControl value={filters.security_software} onChange={(v) => filter('security_software', v)} options={choices(d.software, '全部软件')} className="w-36" />
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!filters.include_archived} onChange={(e) => filter('include_archived', e.target.checked ? '1' : '')} />含已注销</label>
      <ActionIcon label="重置筛选" onClick={() => { setFilters({ dept: '', status: '', security_software: '', include_archived: '' }); setPage(1) }}><RotateCcw size={15} /></ActionIcon>
      <div className="ml-auto flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={action.busy} onClick={() => action.run(api.downloadAssetTemplate)}><FileSpreadsheet size={14} className="mr-1" />模板</Button><ImportDialog title="导入终端资产" importer={api.importAssets} onImported={query.reload} /><Button size="sm" variant="outline" disabled={action.busy} onClick={() => action.run(() => api.exportAssets({ keyword, ...filters }))}><Download size={14} className="mr-2" />导出</Button></div>
    </Toolbar>
    {(query.error || directory.error) && <ErrorBanner message={query.error || directory.error} onRetry={() => { query.reload(); directory.reload() }} />}
    <DataTable columns={columns} rows={query.error ? [] : query.data?.list || []} loading={query.loading} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    <DetailSheet open={!!detailId} onOpenChange={(v) => { if (!v) setDetailId(null) }} title="设备资产档案">{detailId && <AssetDetails key={`${detailId}-${detailRevision}`} id={detailId} onNavigate={(target) => { setDetailId(null); onNavigate(target) }} onEdit={open} />}</DetailSheet>
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={editor?.mode === 'transfer' ? '调换使用人' : editor?.mode === 'maintenance' ? '设备维修换件' : editor?.record.id ? '编辑终端资产' : '新增终端资产'} onSubmit={save} busy={action.busy} wide><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!archive} onOpenChange={(v) => { if (!v) setArchive(null) }} title="注销归档资产" message="资产资料和履历将保留，可通过“含已注销”查回。" confirmLabel="注销归档" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.archiveAsset(archive.id); setArchive(null); query.reload(); directoryChanged() }, '已注销归档')} />
  </div>
}
