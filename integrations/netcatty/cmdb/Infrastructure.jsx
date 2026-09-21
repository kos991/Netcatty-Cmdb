import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, Copy, Download, Pencil, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from './api'
import { requestJson, exportFile } from './transport'
import { allPages, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { ActionIcon, DataTable, DefinitionList, DetailSheet, ErrorBanner, ModalForm, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'
import ImportDialog from './ImportDialog'
import InfrastructureEditor from './InfrastructureEditor'
import Taxonomy from './Taxonomy'

const TYPES = [['server', '服务器'], ['virtual_machine', '虚拟机'], ['switch', '交换机'], ['router', '路由器'], ['security_device', '安全设备'], ['storage', '存储设备']].map(([value, label]) => ({ value, label }))
const DEFAULTS = { status: '在库', asset_class: 'physical', device_type: 'server', org_id: 0, group_id: 0, category_id: 0, model_id: 0, owner_id: 0, interfaces: [] }
const directoryLoader = async () => {
  const [meta, people, filters, credentials] = await Promise.all([requestJson('/api/cmdb/meta'), allPages(api.persons), api.infrastructureFilters(), allPages(api.credentials)])
  return { meta, people, filters, credentials }
}

function InfrastructureDetails({ id }) {
  const loader = useCallback(async () => {
    const [detail, credentials] = await Promise.all([api.infrastructureAsset(id), allPages(api.credentials)])
    return { ...detail, credentials: credentials.filter((item) => item.asset_id === id) }
  }, [id])
  const query = useQuery(loader)
  if (query.error) return <ErrorBanner message={query.error} onRetry={query.reload} />
  if (!query.data) return <p className="text-sm text-muted-foreground">加载中…</p>
  const asset = query.data.asset
  const labels = [['name', '名称'], ['asset_code', '资产编码'], ['device_type', '设备类型'], ['status', '状态'], ['org_name', '组织'], ['group_name', '分组'], ['department', '部门'], ['owner', '负责人'], ['sn', '序列号'], ['vendor', '厂商'], ['model', '型号'], ['mgmt_ip', '管理 IP'], ['biz_ip', '业务 IP'], ['net_type', '网络类型'], ['mac', 'MAC'], ['os_type', '操作系统'], ['os_version', '系统版本'], ['security_software', '软件安装情况'], ['remark', '备注']]
  return <div className="space-y-4"><DefinitionList items={labels.map(([key, label]) => [label, asset[key]])} /><h3 className="text-sm font-medium">关联凭证</h3>{query.data.credentials?.length ? <DefinitionList items={query.data.credentials.map((item) => [item.name, item.cred_type || '未分类'])} /> : <p className="text-sm text-muted-foreground">未关联凭证</p>}<h3 className="text-sm font-medium">网络接口</h3><DataTable rows={query.data.interfaces || []} columns={textFields([['name', '名称'], ['ip', 'IP'], ['mask', '掩码'], ['gateway', '网关'], ['mac', 'MAC'], ['network_zone', '网络区域']])} /></div>
}

export default function Infrastructure({ keyword, focusTarget, command, leadingControl }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [filters, setFilters] = useState({ status: '', category_id: '', org_id: '', group_id: '', source_type: '', os_type: '', os_version: '' })
  const [sort, setSort] = useState('')
  const [selected, setSelected] = useState([])
  const [detail, setDetail] = useState(null)
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [confirmation, setConfirmation] = useState(null)
  const [taxonomyOpen, setTaxonomyOpen] = useState(false)
  const handledCommandId = useRef(null)
  const directory = useDirectory(directoryLoader)
  const action = useAction()
  const params = { keyword, scope: 'infrastructure', ...filters, ...(sort ? { sort_by: sort, sort_order: 'asc' } : {}) }
  const loader = useCallback(() => api.infrastructure({ keyword, scope: 'infrastructure', ...filters, ...(sort ? { sort_by: sort, sort_order: 'asc' } : {}), page, page_size: pageSize }), [keyword, filters, sort, page, pageSize])
  const query = useQuery(loader)
  const meta = directory.data?.meta || {}
  const advancedFilterCount = ['org_id', 'group_id', 'source_type', 'os_type', 'os_version'].filter((key) => filters[key]).length + (sort ? 1 : 0)
  useEffect(() => { setPage(1); setSelected([]) }, [keyword])
  useEffect(() => { if (focusTarget?.tableKey === 'cmdb_assets') setDetail(focusTarget.id) }, [focusTarget])
  const changeFilter = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); setSelected([]) }
  const options = (items) => choices((items || []).map((item) => ({ value: item.id, label: item.name })), '未分配')
  const open = useCallback((record = {}, batch = false) => {
    if (batch) { setEditor({ record, batch }); setValues({}); return }
    if (!record.id) { setEditor({ record: DEFAULTS, batch: false }); return }
    action.run(async () => {
      const detail = await api.infrastructureAsset(record.id)
      setEditor({ record: { ...DEFAULTS, ...detail.asset, interfaces: detail.interfaces || [] }, batch: false })
    })
  }, [action])
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
    { key: 'owner_id', label: '负责人', numeric: true, options: choices((directory.data?.people || []).map((p) => ({ value: p.id, label: `${p.name} · ${p.department}` }))), derive: (id) => { const person = directory.data?.people.find((p) => p.id === id); return { owner: person?.name || '', department: person?.department || '' } } },
    ...textFields([['department', '部门'], ['remark', '备注', 'textarea']]),
  ]
  const save = () => action.run(async () => {
    validateFields(fields, values)
    const changes = Object.fromEntries([...fields.map((f) => f.key), 'owner'].filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]))
    if (editor.batch) {
      const compact = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== '' && value !== undefined))
      if (!Object.keys(compact).length) throw new Error('请至少选择一个要修改的字段')
      await api.batchInfrastructure(selected, 'edit', compact)
    } else {
      if (editor.record.id) await api.updateInfrastructure(editor.record.id, changes)
      else await api.createInfrastructure({ ...values, asset_class: 'physical' })
    }
    setEditor(null); setSelected([]); query.reload()
  }, '已保存资产')
  const saveFull = (next, credentialIds) => action.run(async () => {
    const payload = { ...next, mgmt_ip: (next.interfaces || []).find((item) => item.is_primary)?.ip || next.mgmt_ip || '' }
    const result = next.id ? (await api.replaceInfrastructure(next.id, payload), { id: next.id }) : await api.createInfrastructure(payload)
    const assetId = result.id
    const selectedCredentials = new Set(credentialIds)
    const changedCredentials = (directory.data?.credentials || []).filter((item) => item.asset_id === assetId || selectedCredentials.has(item.id))
    await Promise.all(changedCredentials.map((item) => api.updateCredential(item.id, { ...item, asset_id: selectedCredentials.has(item.id) ? assetId : 0 })))
    setEditor(null); setSelected([]); query.reload(); directory.reload()
  }, '已保存完整资产档案')
  return <div className="flex min-h-0 flex-1 flex-col"><Toolbar>
    {leadingControl}
    <SelectControl className="w-36" value={filters.category_id} onChange={(v) => changeFilter('category_id', v)} options={choices((meta.categories || []).map((x) => ({ value: x.id, label: x.name })), '全部设备类型')} />
    <SelectControl className="w-32" value={filters.status} onChange={(v) => changeFilter('status', v)} options={choices(meta.statuses || [], '全部状态')} />
    <Popover><PopoverTrigger asChild><Button variant="outline" size="sm"><SlidersHorizontal size={14} className="mr-1" />更多筛选{advancedFilterCount ? ` (${advancedFilterCount})` : ''}</Button></PopoverTrigger><PopoverContent align="start" className="w-72 space-y-3">
      {[['org_id', '组织', 'orgs'], ['group_id', '分组', 'groups']].map(([key, label, kind]) => <div key={key}><p className="mb-1 text-xs text-muted-foreground">{label}</p><SelectControl className="w-full" value={filters[key]} onChange={(v) => changeFilter(key, v)} options={choices((meta[kind] || []).map((x) => ({ value: x.id, label: x.name })), `全部${label}`)} /></div>)}
      <div><p className="mb-1 text-xs text-muted-foreground">来源</p><SelectControl className="w-full" value={filters.source_type} onChange={(v) => changeFilter('source_type', v)} options={choices([{ value: 'manual', label: '手工登记' }, { value: 'legacy_server', label: '基础设施台账' }], '全部来源')} /></div>
      <div><p className="mb-1 text-xs text-muted-foreground">操作系统</p><SelectControl className="w-full" value={filters.os_type} onChange={(v) => changeFilter('os_type', v)} options={choices(directory.data?.filters.os_type || [], '全部操作系统')} /></div>
      <div><p className="mb-1 text-xs text-muted-foreground">系统版本</p><SelectControl className="w-full" value={filters.os_version} onChange={(v) => changeFilter('os_version', v)} options={choices(directory.data?.filters.os_version || [], '全部系统版本')} /></div>
      <div><p className="mb-1 text-xs text-muted-foreground">排序</p><SelectControl className="w-full" value={sort} onChange={(v) => { setSort(v); setPage(1) }} options={choices([{ value: 'name', label: '名称升序' }, { value: 'asset_code', label: '编码升序' }], '默认排序')} /></div>
      <Button variant="ghost" size="sm" className="w-full" onClick={() => { setFilters((f) => ({ ...f, org_id: '', group_id: '', source_type: '', os_type: '', os_version: '' })); setSort(''); setPage(1) }}>重置高级筛选</Button>
      <Button variant="ghost" size="sm" className="w-full" onClick={() => setTaxonomyOpen(true)}>管理资产分类与分组</Button>
    </PopoverContent></Popover>
    <div className="ml-auto flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => action.run(() => api.exportInfrastructure(params))}><Download size={14} className="mr-1" />导出</Button><Button variant="outline" size="sm" onClick={() => action.run(() => exportFile('/api/cmdb/assets/template', 'cmdb-template.xlsx'))}>模板</Button><ImportDialog importer={api.importInfrastructure} onImported={() => { query.reload(); directory.reload() }} /><ActionIcon label="同步旧台账" onClick={() => action.run(async () => { await api.syncInfrastructure(); query.reload() }, '台账同步完成')}><RefreshCw size={15} /></ActionIcon></div>
  </Toolbar>
    {selected.length > 0 && <Toolbar><span className="text-xs text-muted-foreground">已选 {selected.length} 项</span><Button variant="ghost" size="sm" onClick={() => open({}, true)}>批量编辑</Button><Button variant="ghost" size="sm" onClick={() => setConfirmation({ ids: selected, action: 'clone' })}>克隆</Button><Button variant="ghost" size="sm" onClick={() => setConfirmation({ ids: selected, action: 'archive' })}>注销归档</Button></Toolbar>}
    {(query.error || directory.error) && <ErrorBanner message={query.error || directory.error} onRetry={() => { query.reload(); directory.reload() }} />}
    <DataTable rows={query.error ? [] : query.data?.list || []} loading={query.loading} selected={selected} onSelectedChange={setSelected} columns={[
      { key: 'name', label: '资产名称 / 编码', render: (v, r) => <div><Button variant="link" className="h-auto p-0" onClick={() => setDetail(r.id)}>{v || `#${r.id}`}</Button><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.asset_code || '-'}</p></div> },
      { key: 'device_type', label: '资产类别 / 类型', render: (v, r) => <div><span className="inline-flex border border-border/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">设备资源</span><p className="mt-1 text-xs">{r.category_name || TYPES.find((t) => t.value === v)?.label || v || '未分类'}</p></div> },
      { key: 'vendor', label: '配置 / 供应商', render: (v, r) => <div><span>{[v, r.model].filter(Boolean).join(' ') || '-'}</span><p className="mt-0.5 text-[11px] text-muted-foreground">{r.device_type === 'switch' && r.port_count ? `${r.port_count} 端口` : [r.cpu_info, r.memory_mb ? `${Math.round(r.memory_mb / 1024)}GB` : '', r.disk_info].filter(Boolean).join(' · ') || r.os_type || '-'}</p></div> },
      { key: 'owner', label: '负责人 / 部门', render: (v, r) => <div><span>{v || '未分配'}</span><p className="mt-0.5 text-[11px] text-muted-foreground">{r.department || r.org_name || '-'}</p></div> },
      { key: 'mgmt_ip', label: '主要标识', render: (v, r) => <div><span className="font-mono text-xs">{v || '-'}</span><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.sn ? `SN ${r.sn}` : '-'}</p></div> },
      { key: 'status', label: '状态', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
    ]} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s); setSelected([]) }} />
    <DetailSheet title="设备资产详情" open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }} actions={detail ? <div className="flex items-center gap-1"><ActionIcon label="编辑" onClick={() => open({ id: detail })}><Pencil size={15} /></ActionIcon><ActionIcon label="克隆" onClick={() => setConfirmation({ ids: [detail], action: 'clone' })}><Copy size={15} /></ActionIcon><ActionIcon label="注销归档" danger onClick={() => setConfirmation({ ids: [detail], action: 'archive' })}><Archive size={15} /></ActionIcon></div> : null}>{detail && <InfrastructureDetails id={detail} />}</DetailSheet>
    <DetailSheet title="资产分组与分类" open={taxonomyOpen} onOpenChange={setTaxonomyOpen}>{taxonomyOpen && <Taxonomy onChanged={() => { directory.reload(); query.reload() }} />}</DetailSheet>
    {editor?.batch && <ModalForm title="批量编辑资产（留空保持不变）" open onOpenChange={(v) => { if (!v) setEditor(null) }} busy={action.busy} onSubmit={save} wide><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>}
    <InfrastructureEditor open={!!editor && !editor.batch} onOpenChange={(v) => { if (!v) setEditor(null) }} record={!editor?.batch ? editor?.record : null} directory={directory.data} busy={action.busy} onSubmit={saveFull} />
    <ConfirmDialog open={!!confirmation} onOpenChange={(v) => { if (!v) setConfirmation(null) }} title={confirmation?.action === 'clone' ? '克隆资产' : '注销归档'} message={`处理 ${confirmation?.ids.length || 0} 项资产。归档会保留资产记录。`} confirmLabel="确认" busy={action.busy} onConfirm={() => action.run(async () => { await api.batchInfrastructure(confirmation.ids, confirmation.action); setConfirmation(null); setSelected([]); query.reload() }, '操作完成')} />
  </div>
}
