import React, { useCallback, useEffect, useState } from 'react'
import { Download, List, Lock, Pencil, Plus, RefreshCw, Settings2, Trash2, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/components/ui/toast'
import { api } from './api'
import { allPages, useAction, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { isCloudDevice } from './state'
import { ActionIcon, DataTable, DefinitionList, DetailSheet, ErrorBanner, ModalForm, Pagination, SearchBox, SelectControl, StatusPill, Toolbar } from './ui'
import Catalog from './Catalog'

const loadSubnets = async () => (await api.ipSubnets()).list || []
const loadSummary = () => api.ipSummary()
const loadAssets = () => allPages(api.assets)
const usedIP = (row) => !!row.asset_code || ['已分配', '已占用', '占用', '在用'].includes(row.status)

function UsageBar({ value = 0 }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
}

function SubnetSettings({ onChanged }) {
  return <Catalog title="网段" load={loadSubnets} defaults={{ category: '专网', sort_order: 0 }} save={(v, row) => row.id ? api.updateSubnet(row.id, v) : api.createSubnet(v)} remove={(row) => api.deleteSubnet(row.id)} onChanged={onChanged} fields={[
    { key: 'name', label: '网段名称', required: true }, { key: 'category', label: '网络类型', options: ['专网', '外网', '内网'] }, ...textFields([['prefix', '地址前缀'], ['cidr', 'CIDR'], ['gateway', '网关'], ['vlan', 'VLAN'], ['purpose', '用途'], ['sort_order', '排序', 'number'], ['remark', '备注', 'textarea']]),
  ]} columns={textFields([['name', '网段'], ['category', '网络类型'], ['cidr', 'CIDR'], ['gateway', '网关'], ['vlan', 'VLAN'], ['total', '地址数']])} />
}

function IPDetails({ record, onNavigate }) {
  const loader = useCallback(() => allPages(api.assets, { keyword: record.ip }), [record.ip])
  const related = useQuery(loader, [])
  return <div className="space-y-4"><DefinitionList items={textFields([['ip', 'IP 地址'], ['subnet', '网段'], ['status', '状态'], ['department', '部门'], ['room', '位置'], ['account', '使用人'], ['asset_code', '资产编码'], ['remark', '备注']]).map((f) => [f.label, record[f.key]])} /><h3 className="text-sm font-medium">关联设备资产</h3>{related.error && <ErrorBanner message={related.error} onRetry={related.reload} />}<DataTable rows={(related.data || []).filter((a) => a.ip === record.ip || a.terminal_ip === record.ip)} columns={[
    { key: 'asset_code', label: '资产编码', render: (v, r) => <Button variant="link" onClick={() => onNavigate({ tableKey: 'assets', id: r.id })}>{v || `#${r.id}`}</Button> }, ...textFields([['device_type', '设备类型'], ['user_name', '使用人'], ['department', '部门'], ['ip', '设备 IP']]),
  ]} /></div>
}

export default function IPAM({ focusTarget, onNavigate }) {
  const [subnet, setSubnet] = useState('')
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(256)
  const [view, setView] = useState('grid')
  const [settings, setSettings] = useState(false)
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [detail, setDetail] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const subnets = useQuery(loadSubnets, [])
  const summary = useQuery(loadSummary)
  const assets = useQuery(loadAssets, [])
  const listLoader = useCallback(() => api.ipEntries({ subnet, status, keyword: search, page, page_size: pageSize }), [subnet, status, search, page, pageSize])
  const visualLoader = useCallback(() => subnet ? api.ipVisualization({ subnet, page, page_size: pageSize }) : Promise.resolve({ list: [], total: 0 }), [subnet, page, pageSize])
  const listQuery = useQuery(listLoader)
  const visualQuery = useQuery(visualLoader)
  const query = view === 'grid' ? visualQuery : listQuery
  const action = useAction()
  useEffect(() => {
    if (!subnet && summary.data?.subnets?.length) setSubnet(summary.data.subnets[0].subnet)
  }, [subnet, summary.data])
  useEffect(() => {
    if (focusTarget?.tableKey !== 'ip_pool') return
    let active = true
    allPages(api.ipEntries, { subnet: focusTarget.subtitle || focusTarget.data?.网段 || '', keyword: focusTarget.title || '' }).then((rows) => {
      if (!active) return
      const record = rows.find((r) => r.id === focusTarget.id || r.ip === focusTarget.title)
      if (record) { setSubnet(record.subnet); setDetail(record) }
    }).catch((error) => { if (active) toast.error(error.message) })
    return () => { active = false }
  }, [focusTarget])
  const refresh = () => { listQuery.reload(); visualQuery.reload(); summary.reload(); subnets.reload(); assets.reload() }
  const open = (record = {}, allocate = false) => {
    setEditor({ record, allocate })
    setValues(allocate ? { asset_id: '', ip_field: 'ip', remark: record.remark || '' } : { subnet, ...record, status: record.status || '空闲' })
  }
  const selectedAsset = (assets.data || []).find((item) => item.id === Number(values.asset_id))
  const editFields = [
    { key: 'subnet', label: '网段', required: true, options: choices([...new Set([...(subnets.data || []).map((s) => s.name), values.subnet].filter(Boolean))]) },
    { key: 'ip', label: 'IP 地址', required: true },
    { key: 'remark', label: '备注', type: 'textarea' },
  ]
  const allocateFields = [
    { key: 'asset_id', label: '关联设备资产', required: true, numeric: true, searchable: true, options: choices((assets.data || []).map((item) => ({ value: item.id, label: [item.asset_code || `#${item.id}`, item.device_type || '未分类', item.user_name].filter(Boolean).join(' · ') }))) },
    { key: 'ip_field', label: '地址用途', required: true, options: selectedAsset && isCloudDevice(selectedAsset.device_type) ? [{ value: 'ip', label: '业务 / 虚拟机 IP' }, { value: 'terminal_ip', label: '终端物理 IP' }] : [{ value: 'ip', label: '设备 IP' }] },
    { key: 'remark', label: '备注', type: 'textarea' },
  ]
  const columns = [{ key: 'ip', label: 'IP 地址', render: (v, r) => <Button variant="link" className="h-auto p-0 font-mono" onClick={() => setDetail(r)}>{v}</Button> }, { key: 'status', label: '状态', render: (v, r) => <StatusPill tone={usedIP(r) ? 'info' : v === '空闲' ? 'success' : 'warning'}>{usedIP(r) ? '已占用' : v}</StatusPill> }, ...textFields([['subnet', '网段'], ['account', '使用人'], ['department', '部门'], ['room', '位置'], ['asset_code', '资产编码']]), { key: 'actions', label: '操作', render: (_, r) => <div className="flex"><ActionIcon label="编辑 IP" onClick={() => open(r)}><Pencil size={15} /></ActionIcon><ActionIcon label={usedIP(r) ? '释放 IP' : '分配 IP'} onClick={() => usedIP(r) ? setConfirmation({ action: 'release', record: r }) : open(r, true)}>{usedIP(r) ? <Unlock size={15} /> : <Lock size={15} />}</ActionIcon><ActionIcon label="删除 IP" danger onClick={() => setConfirmation({ action: 'delete', record: r })}><Trash2 size={15} /></ActionIcon></div> }]
  const rows = query.error ? [] : query.data?.list || []
  const activeSummary = summary.data?.subnets?.find((item) => item.subnet === subnet) || {}
  return <div className="flex h-full min-h-0">
    <aside className="flex w-72 shrink-0 flex-col border-r border-border/70">
      <div className="flex h-[62px] items-center justify-between border-b border-border/70 px-4"><div><strong className="text-sm">网络与地址空间</strong><p className="mt-0.5 text-[11px] text-muted-foreground">IP、VLAN 与 VXLAN</p></div><ActionIcon label="网段管理" onClick={() => setSettings(true)}><Settings2 size={15} /></ActionIcon></div>
      <div className="border-b border-border/70 p-2.5"><SearchBox value={keyword} onChange={setKeyword} onSearch={() => setSearch(keyword.trim())} placeholder="搜索网段、CIDR 或 VLAN" className="min-w-0 max-w-none" /></div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {(summary.data?.subnets || []).map((item) => <button type="button" key={item.subnet} onClick={() => { setSubnet(item.subnet); setPage(1) }} className={`mb-1 w-full rounded-md border px-2.5 py-2 text-left transition-colors ${subnet === item.subnet ? 'border-primary/50 bg-primary/10' : 'border-transparent hover:bg-muted/60'}`}><div className="flex items-center justify-between gap-2"><strong className="truncate text-xs">{item.subnet}</strong><span className="text-[10px] text-muted-foreground">{item.usage_rate || 0}%</span></div><div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground"><span>{item.cidr || item.prefix || '-'}</span><span>{item.vlan ? `VLAN ${item.vlan}` : ''}</span></div><div className="mt-2"><UsageBar value={item.usage_rate} /></div></button>)}
      </div>
      <div className="flex h-12 items-center gap-2 border-t border-border/70 px-3"><Button variant="ghost" size="sm" onClick={() => setSettings(true)}>导入</Button><Button variant="ghost" size="sm" onClick={() => action.run(() => api.exportIPs({ subnet, status, keyword: search }))}>导出</Button></div>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[62px] shrink-0 items-center gap-3 border-b border-border/70 px-4"><div className="w-28 shrink-0"><strong className="text-sm">IPAM/IP</strong><p className="mt-0.5 text-[11px] text-muted-foreground">地址、VLAN 与 VXLAN</p></div><SearchBox value={keyword} onChange={setKeyword} onSearch={() => { setSearch(keyword.trim()); setPage(1) }} placeholder="搜索 IP、资产、人员、部门、VLAN 或 VNI" className="max-w-[520px]" /><span className="flex-1" /><Button variant="outline" size="sm" onClick={() => action.run(() => api.exportIPs({ subnet, status, keyword: search }))}><Download size={14} className="mr-1" />导出</Button><Button size="sm" onClick={() => setSettings(true)}><Plus size={14} className="mr-1" />新增网段</Button><ActionIcon label="刷新" onClick={refresh}><RefreshCw size={15} /></ActionIcon></header>
      <div className="flex h-12 items-center gap-2 border-b border-border/70 px-4"><Button variant="secondary" size="sm">IP 地址</Button><Button variant="ghost" size="sm">VLAN</Button><Button variant="ghost" size="sm">VXLAN</Button><span className="ml-auto text-[11px] text-muted-foreground">数据与设备资产实时联动</span></div>
      <div className="grid min-h-[82px] grid-cols-[minmax(210px,1.4fr)_repeat(4,minmax(92px,.55fr))] border-b border-border/70"><div className="border-r border-border/70 px-4 py-3"><strong className="text-sm">{subnet || '请选择网段'}</strong><p className="mt-1 font-mono text-[11px] text-muted-foreground">{activeSummary.cidr || activeSummary.prefix || '-'}</p><div className="mt-3"><UsageBar value={activeSummary.usage_rate} /></div></div>{[['使用率', `${activeSummary.usage_rate || 0}%`], ['已占用', activeSummary.used || 0], ['空闲', activeSummary.free || 0], ['异常 / 保留', activeSummary.reserved || activeSummary.conflict || 0]].map(([label, value]) => <div key={label} className="border-r border-border/70 px-3 py-3 last:border-r-0"><span className="text-[10px] text-muted-foreground">{label}</span><strong className="mt-1 block font-mono text-lg tabular-nums">{value}</strong></div>)}</div>
      <Toolbar><SelectControl className="w-32" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={choices(['空闲', '在用', '保留', '不可用', '冲突'], '全部状态')} /><Button variant="outline" size="sm" onClick={() => { setView(view === 'grid' ? 'table' : 'grid'); setPage(1) }}><List size={14} className="mr-1" />{view === 'grid' ? '列表视图' : '方格视图'}</Button><Button variant="outline" size="sm" onClick={() => open()}>补录 IP</Button><span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground"><span><i className="mr-1 inline-block h-2 w-2 bg-primary/70" />已占用</span><span><i className="mr-1 inline-block h-2 w-2 border border-border" />空闲</span><span><i className="mr-1 inline-block h-2 w-2 bg-destructive/70" />异常</span></span></Toolbar>
      {(query.error || summary.error || subnets.error || assets.error) && <ErrorBanner message={query.error || summary.error || subnets.error || assets.error} onRetry={refresh} />}
      {view === 'table' ? <DataTable rows={rows} loading={query.loading} columns={columns} /> : <div className="min-h-0 flex-1 overflow-auto p-4">{query.loading ? <p className="text-sm text-muted-foreground">加载中...</p> : <div data-ipam-address-grid className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1">{rows.map((row) => {
        const used = usedIP(row)
        const abnormal = ['不可用', '冲突', '异常'].includes(row.status)
        const address = String(row.ip || '').split('.').pop()
        return <button type="button" key={row.id || row.ip} onClick={() => setDetail(row)} title={[row.ip, used ? '已占用' : row.status, row.account, row.department, row.room, row.remark].filter(Boolean).join(' · ')} aria-label={`${row.ip} ${used ? '已占用' : '未占用'}`} className={`h-9 min-w-0 rounded border px-1 text-center font-mono text-xs tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${abnormal ? 'border-destructive/70 bg-destructive/20 text-destructive-foreground' : used ? 'border-primary/60 bg-primary/15 text-primary' : 'border-border/70 bg-transparent text-muted-foreground hover:bg-muted/60'}`}><span data-ipam-address-value>{address}</span></button>
      })}</div>}</div>}
      {(view === 'table' || subnet) && <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} pageSizes={view === 'grid' ? [96, 128, 256, 500] : [20, 50, 100, 256]} onChange={(p, size) => { setPage(p); setPageSize(size) }} />}
    </section>
    <DetailSheet open={settings} onOpenChange={setSettings} title="网段管理">{settings && <SubnetSettings onChanged={refresh} />}</DetailSheet>
    <DetailSheet open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }} title="IP 地址详情" actions={detail && <><Button variant="outline" size="sm" onClick={() => open(detail)}>编辑</Button><Button size="sm" onClick={() => usedIP(detail) ? setConfirmation({ action: 'release', record: detail }) : open(detail, true)}>{usedIP(detail) ? '释放' : '分配'}</Button></>}>{detail && <IPDetails record={detail} onNavigate={(target) => { setDetail(null); onNavigate(target) }} />}</DetailSheet>
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={editor?.allocate ? `分配 ${editor.record.ip}` : editor?.record.id ? '编辑 IP' : '新增 IP'} busy={action.busy} onSubmit={() => action.run(async () => {
      const fields = editor.allocate ? allocateFields : editFields
      validateFields(fields, values)
      if (editor.allocate) {
        let id = editor.record.id
        if (!id) id = (await api.createIP({ subnet: editor.record.subnet, ip: editor.record.ip, status: '空闲' })).id
        await api.allocateIP(id, values)
      } else if (editor.record.id) await api.updateIP(editor.record.id, { ...editor.record, ...values })
      else await api.createIP({ ...values, status: '空闲' })
      setEditor(null); setDetail(null); refresh()
    }, editor?.allocate ? 'IP 已关联设备' : '已保存 IP')}><Fields fields={editor?.allocate ? allocateFields : editFields} value={values} onChange={setValues} />{editor?.allocate && selectedAsset && <DefinitionList items={[["设备类型", selectedAsset.device_type || '未分类'], ['使用人', selectedAsset.user_name], ['部门', selectedAsset.department], ['位置', selectedAsset.room]]} />}</ModalForm>
    <ConfirmDialog open={!!confirmation} onOpenChange={(v) => { if (!v) setConfirmation(null) }} title={confirmation?.action === 'release' ? '释放 IP' : '删除 IP'} message={`确认处理 ${confirmation?.record.ip || ''}？${confirmation?.action === 'release' ? '释放后会同时清除设备资产中的对应 IP。' : '该操作会删除 IP 池记录。'}`} confirmLabel="确认" destructive busy={action.busy} onConfirm={() => action.run(async () => { if (confirmation.action === 'release') await api.releaseIP(confirmation.record.id); else await api.deleteIP(confirmation.record.id); setConfirmation(null); setDetail(null); refresh() }, '操作完成')} />
  </div>
}
