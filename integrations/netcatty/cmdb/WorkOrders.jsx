import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, ChevronDown, Download, FileDown, Filter, Link2, Paperclip, Pencil, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toast'
import { VaultHeaderSearch, VaultPageHeader, vaultHeaderIconButtonClass, vaultHeaderSecondaryButtonClass } from '@/components/vault/VaultPageHeader'
import { api } from './api'
import { allPages, useAction, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { formatLocalDateTimeInput, normalizeWorkOrderFilters, workOrderDeskFilters } from './state'
import { ActionIcon, DataTable, DefinitionList, ErrorBanner, Field, ModalForm, Pagination, SearchBox, SelectControl, StatusPill, statusTone, Toolbar } from './ui'
import WorkOrderList from './WorkOrderList'

const BIZ_TYPES = ['故障处理', '日常维护', '变更操作', '资产调配']
const OPERATION_TYPES = ['排障', '优化', '响应', '值守']
const STATUSES = ['新建', '已分配', '处理中', '已解决', '已关闭', '已取消']
const RESULTS = ['处理成功', '临时规避', '未发现异常', '未解决', '已升级处理', '需二次维护']
const PRIORITIES = ['P1（紧急）', 'P2（较高）', 'P3（普通）', 'P4（较低）']

const HANDLER_KEY = 'netcatty_cmdb_work_order_handler'
const emptyFilters = () => ({ biz_type: '', operation_type: '', priority: '', status: '', result: '', owner: '', maintainer: '', asset_keyword: '', keyword: '' })
const orderBody = (values) => ({ ...values, asset_id: (values.assets || []).find((item) => item.asset_type === 'infrastructure')?.asset_id || 0, plan_time: String(values.plan_time || '').replace('T', ' '), actual_time: String(values.actual_time || '').replace('T', ' ') })
const loadAssets = async () => {
  const [terminals, infrastructure, applications] = await Promise.all([
    allPages(api.assets), allPages(api.infrastructure, { scope: 'infrastructure' }), allPages(api.apps),
  ])
  return [
    ...terminals.map((asset) => ({ key: `terminal:${asset.id}`, asset_type: 'terminal', asset_id: asset.id, asset_name: asset.asset_code || asset.device_type || `终端 #${asset.id}`, meta: [asset.device_type, asset.ip || asset.terminal_ip].filter(Boolean).join(' · ') })),
    ...infrastructure.map((asset) => ({ key: `infrastructure:${asset.id}`, asset_type: 'infrastructure', asset_id: asset.id, asset_name: asset.name || asset.asset_code || `基础设施 #${asset.id}`, meta: [asset.device_type, asset.mgmt_ip].filter(Boolean).join(' · ') })),
    ...applications.map((asset) => ({ key: `application:${asset.id}`, asset_type: 'application', asset_id: asset.id, asset_name: asset.app_name || `业务系统 #${asset.id}`, meta: [asset.app_type, asset.server_biz_ip].filter(Boolean).join(' · ') })),
  ]
}
const loadWorkConfig = async () => {
  const [categories, operationTypes, priorities] = await Promise.all([
    api.config('work-order-categories'), api.config('work-order-types'), api.config('work-order-priorities'),
  ])
  return {
    categories: categories.list?.map((item) => item.name) || [],
    operationTypes: operationTypes.list?.map((item) => item.name) || [],
    priorities: priorities.list?.map((item) => item.name) || [],
  }
}
const newOrderDefaults = () => ({
  order_no: '',
  project_name: '',
  priority: 'P3（普通）',
  status: '新建',
  biz_type: '故障处理',
  operation_type: '排障',
  work_minutes: 10,
  plan_time: formatLocalDateTimeInput(),
  maintainer: typeof window === 'undefined' ? '' : window.localStorage.getItem(HANDLER_KEY) || '',
  asset_id: 0,
})

function AssetPicker({ options = [], value = [], onChange, floating = false }) {
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState('all')
  const selected = new Set((value || []).map((item) => `${item.asset_type}:${item.asset_id}`))
  const visible = options.filter((item) => (type === 'all' || item.asset_type === type) && (!keyword.trim() || `${item.asset_name} ${item.meta}`.toLowerCase().includes(keyword.trim().toLowerCase())))
  const toggle = (item, checked) => onChange(checked
    ? [...(value || []), { asset_type: item.asset_type, asset_id: item.asset_id, asset_name: item.asset_name }]
    : (value || []).filter((current) => `${current.asset_type}:${current.asset_id}` !== item.key))
  const picker = <Popover><PopoverTrigger asChild><Button type="button" variant="outline" size={floating ? 'icon' : 'default'} aria-label={floating ? '筛选关联资源' : undefined} title={floating ? '筛选关联资源' : undefined} className={floating ? 'relative h-9 w-9 rounded-full' : 'h-9 w-full justify-start text-xs font-normal'}>{floating ? <><Link2 size={16} />{value.length > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{value.length}</span>}</> : value.length ? `已选 ${value.length} 项资源 · 点击修改` : '搜索并选择资源（可不选）'}</Button></PopoverTrigger>
    <PopoverContent align={floating ? 'end' : 'start'} side="bottom" className="w-[min(400px,calc(100vw-32px))] p-0">
      <div className="border-b border-border/60 px-3 py-2 text-xs font-semibold">关联资源 <span className="ml-1 font-normal text-muted-foreground">已选 {value.length} 项</span></div>
      <div className="flex flex-wrap gap-1 border-b border-border/60 p-2">{[['all', '全部'], ['terminal', '终端资产'], ['infrastructure', '基础设施'], ['application', '业务系统']].map(([key, label]) => <Button key={key} type="button" variant={type === key ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setType(key)}>{label}</Button>)}</div>
      <div className="border-b border-border/60 p-2"><SearchBox value={keyword} onChange={setKeyword} placeholder="搜索关联资源" className="min-w-0 max-w-none" /></div>
      <div className="max-h-56 overflow-auto p-1.5">{visible.length ? visible.map((item) => <label key={item.key} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-xs hover:bg-muted/60"><input type="checkbox" checked={selected.has(item.key)} onChange={(event) => toggle(item, event.target.checked)} /><span className="min-w-0 flex-1"><strong className="block truncate font-medium">{item.asset_name}</strong><span className="block truncate text-[11px] text-muted-foreground">{{ terminal: '终端资产', infrastructure: '基础设施', application: '业务系统' }[item.asset_type]}{item.meta ? ` · ${item.meta}` : ''}</span></span></label>) : <p className="px-3 py-5 text-center text-xs text-muted-foreground">没有匹配资源</p>}</div>
    </PopoverContent></Popover>
  if (floating) return picker
  return <Field label="关联资源" className="sm:col-span-2">{picker}{value.length > 0 && <p className="truncate text-[11px] text-muted-foreground">{value.map((item) => item.asset_name).join('、')}</p>}</Field>
}

function AttachmentPanel({ workOrderId, stagedFiles = [], onAddFiles, onRemoveStagedFile, busy = false, refreshKey = 0, className }) {
  const fileInput = useRef(null)
  const loader = useCallback(() => {
    void refreshKey
    return workOrderId ? api.workOrderAttachments(workOrderId) : Promise.resolve({ list: [], total: 0 })
  }, [workOrderId, refreshKey])
  const query = useQuery(loader)
  const action = useAction()
  if (!workOrderId && !onAddFiles) return <div className="sm:col-span-2 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">保存工单后可上传附件</div>
  return <Field label="附件" className={className || 'sm:col-span-2'}><div className="rounded-md border border-border">
    <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2"><span className="text-xs text-muted-foreground">{stagedFiles.length ? `待上传 ${stagedFiles.length} 个` : `${query.data?.total || 0} 个附件`} · 单个不超过 50 MiB</span>{onAddFiles ? <><input ref={fileInput} data-work-order-attachments type="file" multiple className="sr-only" onChange={(event) => { onAddFiles(Array.from(event.target.files || [])); event.target.value = '' }} /><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip size={14} className="mr-1" />选择附件</Button></> : <Button type="button" variant="outline" size="sm" disabled={action.busy} onClick={() => action.run(async () => { const result = await api.uploadWorkOrderAttachment(workOrderId); if (!result?.cancelled) query.reload() })}><Upload size={14} className="mr-1" />上传附件</Button>}</div>
    <div className="divide-y divide-border/50">{stagedFiles.map((file) => <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-2 px-3 py-2 text-xs"><Paperclip size={14} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="text-[11px] text-muted-foreground">待上传</span><ActionIcon label={`移除附件 ${file.name}`} disabled={busy} onClick={() => onRemoveStagedFile(file)}><Trash2 size={14} /></ActionIcon></div>)}{(query.data?.list || []).map((item) => <div key={item.id} className="flex items-center gap-2 px-3 py-2 text-xs"><Paperclip size={14} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{item.file_name}</span><span className="text-[11px] text-muted-foreground">{Math.max(1, Math.ceil(item.size_bytes / 1024))} KiB</span><ActionIcon label="下载附件" onClick={() => api.downloadWorkOrderAttachment(workOrderId, item)}><FileDown size={14} /></ActionIcon><ActionIcon label="删除附件" danger onClick={() => action.run(async () => { await api.deleteWorkOrderAttachment(workOrderId, item.id); query.reload() }, '附件已删除')}><Trash2 size={14} /></ActionIcon></div>)}</div>
    {query.error ? <ErrorBanner message={query.error} onRetry={query.reload} /> : null}
  </div></Field>
}

export default function WorkOrders({ mode = 'create', onModeChange }) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [filters, setFilters] = useState({ biz_type: '', operation_type: '', priority: '', status: '', result: '', owner: '', maintainer: '', date_from: '', date_to: '', asset_keyword: '', keyword: '' })
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [editor, setEditor] = useState(null)
  const [statsValues, setStatsValues] = useState({})
  const [values, setValues] = useState(newOrderDefaults)
  const [stagedFiles, setStagedFiles] = useState([])
  const [attachmentRefresh, setAttachmentRefresh] = useState(0)
  const [deskDateScope, setDeskDateScope] = useState(() => ({ mode: 'day', day: formatLocalDateTimeInput().slice(0, 10), from: '', to: '' }))
  const [deskFilters, setDeskFilters] = useState(emptyFilters)
  const [deskKeyword, setDeskKeyword] = useState('')
  const [deskPage, setDeskPage] = useState(1)
  const [deskPane, setDeskPane] = useState('editor')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [detailValues, setDetailValues] = useState({})
  const [detailEditing, setDetailEditing] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const action = useAction()
  const assets = useQuery(loadAssets, [])
  const workConfig = useQuery(loadWorkConfig, [])
  const projects = useQuery(api.projects)
  const normalizedFilters = normalizeWorkOrderFilters(filters)
  const loader = useCallback(() => api.workOrders({ ...normalizeWorkOrderFilters(filters), page, page_size: pageSize }), [filters, page, pageSize])
  const query = useQuery(loader)
  const deskQueryFilters = workOrderDeskFilters(deskFilters, deskDateScope)
  const deskLoader = useCallback(() => api.workOrders({ ...workOrderDeskFilters(deskFilters, deskDateScope), page: deskPage, page_size: 20 }), [deskFilters, deskDateScope, deskPage])
  const deskQuery = useQuery(deskLoader)
  const reloadWorkOrders = query.reload
  const reloadDesk = deskQuery.reload
  useEffect(() => {
    const refresh = () => { reloadWorkOrders(); reloadDesk() }
    window.addEventListener('cmdb:refresh-work-orders', refresh)
    return () => window.removeEventListener('cmdb:refresh-work-orders', refresh)
  }, [reloadWorkOrders, reloadDesk])
  useEffect(() => {
    if (mode !== 'create') return
    setValues((current) => ({ ...newOrderDefaults(), ...current, project_name: projects.data?.list?.[0]?.name || current.project_name || '当前项目' }))
  }, [mode, projects.data])
  const change = (key, value) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1) }
  const deskChange = (key, value) => { setDeskFilters((old) => ({ ...old, [key]: value })); setDeskPage(1) }
  const submitSearch = () => mode === 'create' ? deskChange('keyword', deskKeyword.trim()) : change('keyword', keyword.trim())
  const clearSearch = () => { if (mode === 'create') { setDeskKeyword(''); deskChange('keyword', '') } else { setKeyword(''); change('keyword', '') } }
  const changeDeskDate = (next) => { setDeskDateScope(next); setDeskPage(1) }
  const open = (record = {}) => { setEditor(record); setStatsValues({ priority: 'P3（普通）', status: '新建', ...record, plan_time: String(record.plan_time || '').replace(' ', 'T'), actual_time: String(record.actual_time || '').replace(' ', 'T') }) }
  const selectOrder = (record) => { setSelectedOrder(record); setDetailValues({ ...record, plan_time: String(record.plan_time || '').replace(' ', 'T'), actual_time: String(record.actual_time || '').replace(' ', 'T') }); setDetailEditing(false); setDeskPane('editor') }
  const configuredCategories = workConfig.data?.categories?.length ? workConfig.data.categories : BIZ_TYPES
  const configuredOperationTypes = workConfig.data?.operationTypes?.length ? workConfig.data.operationTypes : OPERATION_TYPES
  const configuredPriorities = workConfig.data?.priorities?.length ? workConfig.data.priorities : PRIORITIES
  const createFields = [
    { key: 'order_no', label: '工单号', disabled: true },
    { key: 'project_name', label: '当前项目', disabled: true },
    { key: 'biz_type', label: '工单类别', required: true, options: choices(configuredCategories) },
    { key: 'priority', label: '优先级', required: true, options: choices(configuredPriorities) },
    ...textFields([['plan_time', '发生时间', 'datetime-local']]),
    { key: 'operation_type', label: '运维类型', required: true, options: choices(configuredOperationTypes) },
    ...textFields([['maintainer', '经办人'], ['work_minutes', '工时（分钟）', 'number']]),
    { key: 'subject', label: '工单主题', required: true, wide: true },
    { key: 'remark', label: '故障内容', type: 'textarea' },
    { key: 'result', label: '处理结果', type: 'textarea' },
  ]
  const fields = [...createFields, { key: 'status', label: '工单状态', options: choices(STATUSES) }, ...textFields([['actual_time', '完成时间', 'datetime-local']])]
  const saveDraft = () => action.run(async () => {
    validateFields(createFields, values)
    const body = orderBody(values)
    let workOrderId = values.id
    if (workOrderId) await api.updateWorkOrder(workOrderId, body)
    else {
      const created = await api.createWorkOrder(body)
      workOrderId = created.id
      setValues((current) => ({ ...current, id: created.id, order_no: created.order_no }))
    }
    deskQuery.reload()
    query.reload()
    if (stagedFiles.length && workOrderId) {
      let uploaded = 0
      try {
        for (const file of stagedFiles) {
          await api.uploadWorkOrderAttachment(workOrderId, file)
          uploaded += 1
          setStagedFiles((current) => current.slice(1))
          setAttachmentRefresh((current) => current + 1)
        }
      } catch (error) {
        throw new Error(`工单已保存，${uploaded} 个附件已上传，剩余附件上传失败：${error.message}`)
      }
    }
    if (values.maintainer && typeof window !== 'undefined') window.localStorage.setItem(HANDLER_KEY, values.maintainer)
    setValues({ ...newOrderDefaults(), project_name: values.project_name })
    setStagedFiles([])
  }, values.id ? '工单已保存' : '工单已创建')
  const saveExisting = () => action.run(async () => {
    const source = mode === 'create' ? detailValues : statsValues
    validateFields(fields, source)
    const id = mode === 'create' ? selectedOrder?.id : editor?.id
    if (id) await api.updateWorkOrder(id, orderBody(source))
    else await api.createWorkOrder(orderBody(source))
    if (mode === 'create') { setSelectedOrder({ ...selectedOrder, ...source }); setDetailEditing(false) }
    else setEditor(null)
    deskQuery.reload()
    query.reload()
  }, '工单已保存')
  const searchValue = mode === 'create' ? deskKeyword : keyword
  const header = <VaultPageHeader dataSection="cmdb-operations-header" contentClassName="h-auto min-h-14 flex-wrap">
    <Dropdown open={modeMenuOpen} onOpenChange={setModeMenuOpen}><DropdownTrigger asChild><Button data-work-order-mode-trigger type="button" variant="secondary" className={vaultHeaderSecondaryButtonClass}><Plus size={15} />新建工单<ChevronDown size={14} /></Button></DropdownTrigger><DropdownContent align="start" sideOffset={8} className="w-40">
      {[["create", "新建工单", Plus], ["stats", "工单统计", BarChart3]].map(([key, label, Icon]) => <button type="button" data-work-order-mode-option={key} key={key} onClick={() => { setModeMenuOpen(false); onModeChange(key) }} className="flex h-10 w-full items-center gap-3 rounded px-3 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"><Icon size={16} className="text-primary" /><span>{label}</span></button>)}
    </DropdownContent></Dropdown>
    <VaultHeaderSearch className="min-w-[180px] max-w-[520px] flex-1" value={searchValue} onChange={(event) => { const value = event.target.value; if (mode === 'create') { setDeskKeyword(value); if (!value) deskChange('keyword', '') } else { setKeyword(value); if (!value) change('keyword', '') } }} onKeyDown={(event) => { if (event.key === 'Enter') submitSearch() }} placeholder="搜索工单号或主题" rightAdornment={searchValue ? <button type="button" aria-label="清除工单搜索" title="清除工单搜索" className="grid h-6 w-6 place-items-center rounded hover:bg-foreground/10" onClick={clearSearch}><X size={13} /></button> : null} />
    <span className="min-w-0 flex-1" />
    <Button type="button" variant="secondary" aria-label="导出工单" className="h-10 w-10 bg-foreground/5 p-0 text-foreground hover:bg-foreground/10 sm:w-auto sm:gap-2 sm:px-3" onClick={() => action.run(() => api.exportWorkOrders(mode === 'create' ? deskQueryFilters : normalizedFilters))}><Download size={14} /><span className="hidden sm:inline">导出</span></Button>
    <ActionIcon className={vaultHeaderIconButtonClass} label="刷新当前页面" onClick={() => window.dispatchEvent(new Event('cmdb:refresh-work-orders'))}><RefreshCw size={15} /></ActionIcon>
  </VaultPageHeader>
  if (mode === 'create') return <div className="flex min-h-0 flex-1 flex-col">{header}{workConfig.error && <ErrorBanner message={workConfig.error} onRetry={workConfig.reload} />}
    <div className="flex shrink-0 gap-1 border-b border-border/60 p-2 xl:hidden"><Button type="button" variant={deskPane === 'list' ? 'secondary' : 'ghost'} size="sm" onClick={() => setDeskPane('list')}>工单列表</Button><Button data-work-order-mobile-new type="button" variant={deskPane === 'editor' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setSelectedOrder(null); setDeskPane('editor') }}>新建工单</Button></div>
    <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[312px_minmax(0,1fr)]">
      <div className={`${deskPane === 'list' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col xl:flex`}><WorkOrderList dateScope={deskDateScope} onDateScopeChange={changeDeskDate} filters={deskFilters} onFilterChange={deskChange} onResetFilters={() => { setDeskFilters(emptyFilters()); setDeskKeyword(''); setDeskPage(1) }} page={deskPage} onPageChange={setDeskPage} query={deskQuery} selectedId={selectedOrder?.id} onSelect={selectOrder} categories={configuredCategories} operationTypes={configuredOperationTypes} priorities={configuredPriorities} statuses={STATUSES} results={RESULTS} /></div>
      <div data-work-order-editor className={`${deskPane === 'editor' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col xl:flex`}>
        {selectedOrder ? <>
          <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/40 px-5 py-2"><div className="min-w-0"><h2 className="text-sm font-semibold">工单详情</h2><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{selectedOrder.order_no || '-'} · {selectedOrder.plan_time || '-'}</p></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => { setSelectedOrder(null); setDetailEditing(false) }}><Plus size={14} className="mr-1" />新建工单</Button>{!detailEditing ? <Button type="button" size="sm" onClick={() => setDetailEditing(true)}><Pencil size={14} className="mr-1" />编辑</Button> : null}</div></header>
          <div data-work-order-scroll className="min-h-0 flex-1 overflow-y-auto"><div className="w-full max-w-[960px] px-5">
            {detailEditing ? <form id="cmdb-work-order-detail-form" onSubmit={(event) => { event.preventDefault(); saveExisting() }} className="grid gap-4 py-4"><Fields fields={fields.slice(2)} value={detailValues} onChange={setDetailValues} className="gap-3" /><AssetPicker options={assets.data || []} value={detailValues.assets || []} onChange={(next) => setDetailValues({ ...detailValues, assets: next })} /></form> : <><section className="border-b border-border/60 py-4"><DefinitionList items={[["工单类别", selectedOrder.biz_type], ["运维类型", selectedOrder.operation_type], ["优先级", selectedOrder.priority], ["状态", selectedOrder.status], ["发生时间", selectedOrder.plan_time], ["经办人", selectedOrder.maintainer], ["工时（分钟）", selectedOrder.work_minutes], ["关联资源", (selectedOrder.assets || []).map((item) => item.asset_name).join('、')]]} /></section><section className="grid gap-4 border-b border-border/60 py-4"><div><h3 className="text-sm font-semibold">{selectedOrder.subject || '未命名工单'}</h3><p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{selectedOrder.remark || '暂无故障内容'}</p></div><div><h3 className="text-xs font-medium">处理结果</h3><p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{selectedOrder.result || '暂无处理结果'}</p></div></section></>}
            <section className="py-4"><AttachmentPanel workOrderId={selectedOrder.id} /></section>
          </div></div>
          {detailEditing ? <div className="shrink-0 border-t border-border/70 bg-background px-5 py-3"><div className="flex w-full max-w-[920px] justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDetailEditing(false)}>取消</Button><Button type="submit" form="cmdb-work-order-detail-form" disabled={action.busy}>{action.busy ? '保存中…' : '保存修改'}</Button></div></div> : null}
        </> : <>
          <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/40 px-5 py-2"><h2 className="text-sm font-semibold">新建工单</h2><div className="min-w-0 truncate text-xs text-muted-foreground"><span>{values.project_name || '当前项目'}</span><span className="mx-2 text-border">/</span><span>{values.order_no || '待生成编号'}</span></div></header>
          <div data-work-order-scroll className="min-h-0 flex-1 overflow-y-auto"><form id="cmdb-work-order-form" onSubmit={(event) => { event.preventDefault(); saveDraft() }} className="w-full max-w-[960px] px-5">
            <section className="border-b border-border/60 py-4"><h3 className="mb-3 text-sm font-semibold">受理信息</h3><Fields fields={createFields.slice(2, 8)} value={values} onChange={setValues} className="gap-3" /></section>
            <section className="border-b border-border/60 py-4"><h3 className="mb-3 text-sm font-semibold">处理内容</h3><Fields fields={createFields.slice(8)} value={values} onChange={setValues} className="gap-3" /></section>
            <section className="py-4"><h3 className="mb-3 text-sm font-semibold">资源与附件</h3><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="关联资源"><div className="flex min-w-0 items-center gap-2"><AssetPicker floating options={assets.data || []} value={values.assets || []} onChange={(next) => setValues({ ...values, assets: next })} /><span className="min-w-0 truncate text-xs text-muted-foreground">{values.assets?.length ? `已关联 ${values.assets.length} 项 · ${values.assets.map((item) => item.asset_name).join('、')}` : '未关联资源'}</span></div></Field><AttachmentPanel workOrderId={values.id} refreshKey={attachmentRefresh} stagedFiles={stagedFiles} onAddFiles={(files) => { const accepted = files.filter((file) => file.size <= 50 * 1024 * 1024); if (accepted.length !== files.length) toast.error('超过 50 MiB 的附件未加入'); setStagedFiles((current) => [...current, ...accepted]) }} onRemoveStagedFile={(file) => setStagedFiles((current) => current.filter((item) => item !== file))} busy={action.busy} className="sm:col-span-1" /></div></section>
          </form></div>
          <div className="shrink-0 border-t border-border/70 bg-background px-5 py-3"><div className="flex w-full max-w-[920px] justify-end gap-2"><Button type="button" variant="outline" disabled={action.busy} onClick={() => { setValues((current) => ({ ...newOrderDefaults(), project_name: current.project_name })); setStagedFiles([]) }}>清空</Button><Button type="submit" form="cmdb-work-order-form" disabled={action.busy}>{action.busy ? '保存中…' : values.id ? '继续保存' : '创建工单'}</Button></div></div>
        </>}
      </div>
    </div>
  </div>
  return <div className="flex min-h-0 flex-1 flex-col">{header}
    <Toolbar>
      <SelectControl value={filters.biz_type} onChange={(v) => change('biz_type', v)} options={choices(configuredCategories, '全部类型')} className="w-36" />
      <SelectControl value={filters.status} onChange={(v) => change('status', v)} options={choices(STATUSES, '全部状态')} className="w-36" />
      <Button variant={showAdvanced ? 'secondary' : 'outline'} size="sm" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((current) => !current)}><Filter size={14} className="mr-1" />更多筛选</Button>
    </Toolbar>
    {showAdvanced && <Toolbar className="bg-background"><SelectControl value={filters.operation_type} onChange={(v) => change('operation_type', v)} options={choices(configuredOperationTypes, '全部运维类型')} className="w-36" /><SelectControl value={filters.priority} onChange={(v) => change('priority', v)} options={choices(configuredPriorities, '全部优先级')} className="w-36" /><SelectControl value={filters.result} onChange={(v) => change('result', v)} options={choices(RESULTS, '全部结果')} className="w-40" /><Input type="date" aria-label="开始日期" className="h-8 w-36 text-xs" value={filters.date_from} onChange={(event) => change('date_from', event.target.value)} /><Input type="date" aria-label="结束日期" className="h-8 w-36 text-xs" value={filters.date_to} onChange={(event) => change('date_to', event.target.value)} /><Input aria-label="负责人" className="h-8 w-28 text-xs" placeholder="负责人" value={filters.owner} onChange={(event) => change('owner', event.target.value)} /><Input aria-label="经办人" className="h-8 w-28 text-xs" placeholder="经办人" value={filters.maintainer} onChange={(event) => change('maintainer', event.target.value)} /><Input aria-label="关联资产" className="h-8 w-36 text-xs" placeholder="关联资产" value={filters.asset_keyword} onChange={(event) => change('asset_keyword', event.target.value)} /></Toolbar>}
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <DataTable loading={query.loading} rows={query.error ? [] : query.data?.list || []} columns={[
      { key: 'order_no', label: '工单号' }, { key: 'priority', label: '优先级', render: (v) => <StatusPill tone={v === '高' ? 'danger' : v === '中' ? 'warning' : 'neutral'}>{v}</StatusPill> },
      ...textFields([['subject', '工单主题'], ['biz_type', '工单类别'], ['operation_type', '运维类型']]), { key: 'status', label: '状态', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
      { key: 'assets', label: '关联资产', render: (v) => (v || []).map((item) => item.asset_name).join('、') || '-' }, ...textFields([['plan_time', '计划时间'], ['result', '结果'], ['owner', '负责人'], ['maintainer', '维护人员']]),
      { key: 'actions', label: '操作', render: (_, row) => <div className="flex"><ActionIcon label="编辑工单" onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除工单" danger onClick={() => setDeleting(row)}><Trash2 size={15} /></ActionIcon></div> },
    ]} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={editor?.id ? '编辑工单' : '新增工单'} onSubmit={saveExisting} busy={action.busy} wide><Fields fields={fields} value={statsValues} onChange={setStatsValues} /><AssetPicker options={assets.data || []} value={statsValues.assets || []} onChange={(next) => setStatsValues({ ...statsValues, assets: next })} /><AttachmentPanel workOrderId={editor?.id || statsValues.id} /></ModalForm>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="删除工单" message={`确认删除“${deleting?.subject || ''}”？`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deleteWorkOrder(deleting.id); setDeleting(null); query.reload() }, '工单已删除')} />
  </div>
}
