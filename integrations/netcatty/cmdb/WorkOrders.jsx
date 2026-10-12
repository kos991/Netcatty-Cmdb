import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, CheckCircle2, ChevronDown, ChevronRight, Cloud, CloudDownload, Download, Eye, FileDown, Filter, Link2, Paperclip, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toast'
import { VaultHeaderSearch, VaultPageHeader, vaultHeaderIconButtonClass, vaultHeaderSecondaryButtonClass } from '@/components/vault/VaultPageHeader'
import { api } from './api'
import { downloadCmdbAttachmentFromCloud } from '../../application/CmdbCloudSync'
import { allPages, useAction, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { formatLocalDateTimeInput, normalizeWorkOrderFilters } from './state'
import { canBulkCloseWorkOrders, getEditableWorkOrderStatuses, getNextWorkOrderStatus, summarizeWorkOrders } from './workOrderStatsModel'
import { chooseWorkOrderDefault, includeCurrentWorkOrderValue, resolveWorkOrderEditValues } from './workOrderFormModel'
import { ActionIcon, DataTable, ErrorBanner, Field, Pagination, SearchBox, SelectControl, StatusPill, statusTone } from './ui'

const BIZ_TYPES = ['故障处理', '日常维护', '变更操作', '资产调配']
const OPERATION_TYPES = ['排障', '优化', '响应', '值守']
const STATUSES = ['新建', '处理中', '已解决', '已关闭', '已分配', '已取消']
const RESULTS = ['处理成功', '临时规避', '未发现异常', '未解决', '已升级处理', '需二次维护']
const PRIORITIES = ['P1（紧急）', 'P2（较高）', 'P3（普通）', 'P4（较低）']

const HANDLER_KEY = 'netcatty_cmdb_work_order_handler'
const emptyFilters = () => ({ biz_type: '', operation_type: '', priority: '', status: '', result: '', owner: '', maintainer: '', date_from: '', date_to: '', asset_keyword: '', keyword: '' })
const orderBody = (values) => ({ ...values, asset_id: (values.assets || []).find((item) => item.asset_type === 'infrastructure')?.asset_id || 0, plan_time: String(values.plan_time || '').replace('T', ' '), actual_time: String(values.actual_time || '').replace('T', ' ') })
const formatWorkOrderTime = (value) => String(value || '').replace('T', ' ').slice(0, 16) || '—'
const imageMimeType = (item) => item.content_type?.startsWith('image/') ? item.content_type : ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[String(item.file_name || '').split('.').pop().toLowerCase()] || '')
const loadAssets = async () => {
  const [terminals, infrastructure, applications] = await Promise.all([
    allPages(api.assets), allPages(api.infrastructure, { scope: 'infrastructure' }), allPages(api.apps),
  ])
  return [
    ...terminals.map((asset) => ({ key: `terminal:${asset.id}`, asset_type: 'terminal', asset_id: asset.id, asset_name: asset.asset_code || asset.device_type || `终端 #${asset.id}`, meta: [asset.device_type, asset.ip || asset.terminal_ip].filter(Boolean).join(' · ') })),
    ...infrastructure.map((asset) => ({ key: `infrastructure:${asset.id}`, asset_type: 'infrastructure', asset_id: asset.id, asset_name: asset.asset_code || '未配置编码', meta: [asset.name, asset.device_type, asset.mgmt_ip].filter(Boolean).join(' · ') })),
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
const newOrderDefaults = (config = {}) => ({
  order_no: '',
  project_name: '',
  priority: chooseWorkOrderDefault(config.priorities, 'P3（普通）'),
  status: '新建',
  biz_type: chooseWorkOrderDefault(config.categories, '故障处理'),
  operation_type: chooseWorkOrderDefault(config.operationTypes, '排障'),
  work_minutes: 0,
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
  const [previewImage, setPreviewImage] = useState(null)
  const loader = useCallback(() => {
    void refreshKey
    return workOrderId ? api.workOrderAttachments(workOrderId) : Promise.resolve({ list: [], total: 0 })
  }, [workOrderId, refreshKey])
  const query = useQuery(loader)
  const action = useAction()
  const downloadAttachment = (item) => action.run(async () => {
    if (item.local_exists === false && item.s3_status === 'synced') {
      await downloadCmdbAttachmentFromCloud(item)
    }
    await api.downloadWorkOrderAttachment(workOrderId, item)
    query.reload()
  }, '附件已下载')
  const previewAttachment = (item) => action.run(async () => {
    if (item.local_exists === false && item.s3_status === 'synced') await downloadCmdbAttachmentFromCloud(item)
    const result = await api.previewWorkOrderAttachment(workOrderId, { ...item, content_type: imageMimeType(item) })
    setPreviewImage({ name: item.file_name, source: `data:${result.contentType};base64,${result.data}` })
    query.reload()
  })
  if (!workOrderId && !onAddFiles) return <div className="sm:col-span-2 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">保存工单后可上传附件</div>
  return <Field label="附件" className={className || 'sm:col-span-2'}><div className="rounded-md border border-border">
    <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2"><span className="text-xs text-muted-foreground">{stagedFiles.length ? `待上传 ${stagedFiles.length} 个` : `${query.data?.total || 0} 个附件`} · 单个不超过 50 MiB</span>{onAddFiles ? <><input ref={fileInput} data-work-order-attachments type="file" multiple className="sr-only" onChange={(event) => { onAddFiles(Array.from(event.target.files || [])); event.target.value = '' }} /><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip size={14} className="mr-1" />选择附件</Button></> : <Button type="button" variant="outline" size="sm" disabled={action.busy} onClick={() => action.run(async () => { const result = await api.uploadWorkOrderAttachment(workOrderId); if (!result?.cancelled) query.reload() })}><Upload size={14} className="mr-1" />上传附件</Button>}</div>
    <div className="divide-y divide-border/50">{stagedFiles.map((file) => <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-2 px-3 py-2 text-xs"><Paperclip size={14} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="text-[11px] text-muted-foreground">待上传</span>{imageMimeType({ file_name: file.name, content_type: file.type }) ? <ActionIcon label={`预览图片 ${file.name}`} onClick={() => setPreviewImage({ name: file.name, source: URL.createObjectURL(file) })}><Eye size={14} /></ActionIcon> : null}<ActionIcon label={`移除附件 ${file.name}`} disabled={busy} onClick={() => onRemoveStagedFile(file)}><Trash2 size={14} /></ActionIcon></div>)}{(query.data?.list || []).map((item) => { const cloudOnly = item.local_exists === false && item.s3_status === 'synced'; const statusLabel = cloudOnly ? '仅云端' : item.s3_status === 'synced' ? '已同步' : item.s3_status === 'failed' ? '同步失败' : item.s3_status === 'pending' ? '等待上传' : '本地'; return <div key={item.id} className="flex items-center gap-2 px-3 py-2 text-xs"><Paperclip size={14} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{item.file_name}</span><span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">{cloudOnly ? <CloudDownload size={12} /> : item.s3_status === 'synced' ? <Cloud size={12} /> : null}{statusLabel} · {Math.max(1, Math.ceil(item.size_bytes / 1024))} KiB</span>{imageMimeType(item) ? <ActionIcon label={`预览图片 ${item.file_name}`} disabled={action.busy || (item.local_exists === false && !cloudOnly)} onClick={() => previewAttachment(item)}><Eye size={14} /></ActionIcon> : null}<ActionIcon label={cloudOnly ? '从云端下载附件' : '下载附件'} disabled={action.busy || (item.local_exists === false && !cloudOnly)} onClick={() => downloadAttachment(item)}><FileDown size={14} /></ActionIcon><ActionIcon label="删除附件" danger onClick={() => action.run(async () => { await api.deleteWorkOrderAttachment(workOrderId, item.id); query.reload() }, '附件已删除')}><Trash2 size={14} /></ActionIcon></div> })}</div>
    {query.error ? <ErrorBanner message={query.error} onRetry={query.reload} /> : null}
  </div><Dialog open={!!previewImage} onOpenChange={(open) => { if (!open) { if (previewImage?.source.startsWith('blob:')) URL.revokeObjectURL(previewImage.source); setPreviewImage(null) } }}><DialogContent className="w-[min(880px,calc(100vw-32px))] max-w-none p-4 sm:max-w-none"><DialogHeader><DialogTitle className="truncate text-sm">{previewImage?.name}</DialogTitle></DialogHeader>{previewImage ? <img alt={previewImage.name} src={previewImage.source} className="max-h-[75vh] w-full object-contain" /> : null}</DialogContent></Dialog></Field>
}

export default function WorkOrders({ mode = 'stats', onModeChange }) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [filters, setFilters] = useState(emptyFilters)
  const [filterOpen, setFilterOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [editor, setEditor] = useState(null)
  const [viewingOrder, setViewingOrder] = useState(null)
  const [statsValues, setStatsValues] = useState({})
  const [values, setValues] = useState(newOrderDefaults)
  const [stagedFiles, setStagedFiles] = useState([])
  const [attachmentRefresh, setAttachmentRefresh] = useState(0)
  const [deleting, setDeleting] = useState(null)
  const [completing, setCompleting] = useState([])
  const [selectedOrderIds, setSelectedOrderIds] = useState([])
  const action = useAction()
  const assets = useQuery(loadAssets, [])
  const workConfig = useQuery(loadWorkConfig, [])
  const projects = useQuery(api.projects)
  const normalizedFilters = normalizeWorkOrderFilters(filters)
  const loader = useCallback(() => api.workOrders({ ...normalizeWorkOrderFilters(filters), page, page_size: pageSize }), [filters, page, pageSize])
  const query = useQuery(loader)
  const statsLoader = useCallback(() => allPages(api.workOrders, normalizeWorkOrderFilters({ ...filters, status: '' })).then(summarizeWorkOrders), [filters])
  const statsQuery = useQuery(statsLoader, { total: 0, pending: 0, processing: 0, completedThisMonth: 0 })
  const reloadWorkOrders = query.reload
  const reloadWorkOrderStats = statsQuery.reload
  useEffect(() => {
    const refresh = () => { reloadWorkOrders(); reloadWorkOrderStats() }
    window.addEventListener('cmdb:refresh-work-orders', refresh)
    return () => window.removeEventListener('cmdb:refresh-work-orders', refresh)
  }, [reloadWorkOrders, reloadWorkOrderStats])
  const change = (key, value) => {
    setFilters((old) => ({ ...old, [key]: value }))
    setPage(1)
    setSelectedOrderIds([])
  }
  const resetFilters = () => {
    const next = emptyFilters()
    setFilters(next)
    setKeyword('')
    setPage(1)
    setSelectedOrderIds([])
  }
  const configuredCategories = workConfig.data?.categories?.length ? workConfig.data.categories : BIZ_TYPES
  const configuredOperationTypes = workConfig.data?.operationTypes?.length ? workConfig.data.operationTypes : OPERATION_TYPES
  const configuredPriorities = workConfig.data?.priorities?.length ? workConfig.data.priorities : PRIORITIES
  const configuredWorkOrderOptions = { categories: configuredCategories, operationTypes: configuredOperationTypes, priorities: configuredPriorities }
  const open = (record = {}) => { setEditor(record); setStatsValues(resolveWorkOrderEditValues(record, projects.data?.list || [])) }
  useEffect(() => {
    if (!createOpen) return
    setValues((current) => {
      const defaults = newOrderDefaults({ categories: configuredCategories, operationTypes: configuredOperationTypes, priorities: configuredPriorities })
      return {
        ...defaults,
        ...current,
        biz_type: current.id ? current.biz_type : chooseWorkOrderDefault(configuredCategories, current.biz_type),
        operation_type: current.id ? current.operation_type : chooseWorkOrderDefault(configuredOperationTypes, current.operation_type),
        priority: current.id ? current.priority : chooseWorkOrderDefault(configuredPriorities, current.priority),
        project_name: projects.data?.list?.[0]?.name || current.project_name || '当前项目',
      }
    })
  }, [createOpen, projects.data, configuredCategories, configuredOperationTypes, configuredPriorities])
  const renderFilterFields = (valuesToFilter, update, reset) => <>
    <div className="mb-3 flex items-center justify-between"><strong className="text-xs">筛选条件</strong><Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={reset}>重置</Button></div>
    <div className="grid gap-3">
      <SelectControl aria-label="工单类别" value={valuesToFilter.biz_type} onChange={(value) => update('biz_type', value)} options={choices(configuredCategories, '全部类别')} className="w-full" />
      <SelectControl aria-label="运维类型" value={valuesToFilter.operation_type} onChange={(value) => update('operation_type', value)} options={choices(configuredOperationTypes, '全部运维类型')} className="w-full" />
      <SelectControl aria-label="优先级" value={valuesToFilter.priority} onChange={(value) => update('priority', value)} options={choices(configuredPriorities, '全部优先级')} className="w-full" />
      <SelectControl aria-label="工单状态" value={valuesToFilter.status} onChange={(value) => update('status', value)} options={choices(STATUSES, '全部状态')} className="w-full" />
      <SelectControl aria-label="处理结果" value={valuesToFilter.result} onChange={(value) => update('result', value)} options={choices(RESULTS, '全部结果')} className="w-full" />
      <Input aria-label="经办人" className="h-8 text-xs" placeholder="经办人" value={valuesToFilter.maintainer} onChange={(event) => update('maintainer', event.target.value)} />
      <Input aria-label="负责人" className="h-8 text-xs" placeholder="负责人" value={valuesToFilter.owner} onChange={(event) => update('owner', event.target.value)} />
      <Input aria-label="关联资产" className="h-8 text-xs" placeholder="关联资产名称" value={valuesToFilter.asset_keyword} onChange={(event) => update('asset_keyword', event.target.value)} />
      <div className="grid grid-cols-2 gap-2"><Input type="date" aria-label="开始日期" className="h-8 min-w-0 text-xs" value={valuesToFilter.date_from || ''} onChange={(event) => update('date_from', event.target.value)} /><Input type="date" aria-label="结束日期" className="h-8 min-w-0 text-xs" value={valuesToFilter.date_to || ''} onChange={(event) => update('date_to', event.target.value)} /></div>
    </div>
  </>
  const createFields = [
    { key: 'order_no', label: '工单号', disabled: true },
    { key: 'project_name', label: '当前项目', disabled: true },
    { key: 'biz_type', label: '工单类别', required: true, options: choices(configuredCategories) },
    { key: 'priority', label: '优先级', required: true, options: choices(configuredPriorities) },
    ...textFields([['plan_time', '发生时间', 'datetime-local']]),
    { key: 'operation_type', label: '运维类型', required: true, options: choices(configuredOperationTypes) },
    ...textFields([['maintainer', '经办人']]),
    { key: 'subject', label: '工单主题', required: true, wide: true },
    { key: 'remark', label: '故障内容', type: 'textarea' },
  ]
  const fields = [
    ...createFields.map((field) => field.key === 'biz_type'
      ? { ...field, options: choices(includeCurrentWorkOrderValue(configuredCategories, statsValues.biz_type)) }
      : field.key === 'operation_type'
        ? { ...field, options: choices(includeCurrentWorkOrderValue(configuredOperationTypes, statsValues.operation_type)) }
        : field.key === 'priority'
          ? { ...field, options: choices(includeCurrentWorkOrderValue(configuredPriorities, statsValues.priority)) }
          : field),
    { key: 'status', label: '维护状态', options: choices(getEditableWorkOrderStatuses(editor?.status || statsValues.status || '新建')) },
    ...(['已解决', '已关闭'].includes(statsValues.status) ? [{ key: 'result', label: '处理结果', type: 'textarea' }] : []),
    ...(['已解决', '已关闭'].includes(statsValues.status) ? textFields([['actual_time', '完成时间', 'datetime-local']]) : []),
    ...(['已关闭'].includes(statsValues.status) ? [{ key: 'work_minutes', label: '工时（分钟）', disabled: true }] : []),
  ]
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
    await Promise.all([query.reload(), statsQuery.reload()])
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
    setValues({ ...newOrderDefaults(configuredWorkOrderOptions), project_name: values.project_name })
    setStagedFiles([])
    setCreateOpen(false)
  }, values.id ? '工单已保存' : '工单已创建')
  const saveExisting = () => action.run(async () => {
    const source = { ...statsValues }
    if (['已解决', '已关闭'].includes(source.status) && !source.actual_time) source.actual_time = formatLocalDateTimeInput().replace('T', ' ')
    validateFields(fields, source)
    const id = editor?.id
    if (id) await api.updateWorkOrder(id, orderBody(source))
    else await api.createWorkOrder(orderBody(source))
    setEditor(null)
    await Promise.all([query.reload(), statsQuery.reload()])
  }, '工单已保存')
  const searchValue = keyword
  const completeWorkOrders = (ids) => {
    const validIds = ids.filter(Boolean)
    if (!canBulkCloseWorkOrders(query.data?.list || [], validIds)) {
      toast.error('只能关闭“已解决”状态的工单，请先完成处理并标记解决')
      return
    }
    setCompleting(validIds)
  }
  const advanceWorkOrder = (row) => {
    const nextStatus = getNextWorkOrderStatus(row.status)
    if (!nextStatus) return
    if (nextStatus === '已关闭') {
      completeWorkOrders([row.id])
      return
    }
    action.run(async () => {
      const body = { ...row, status: nextStatus }
      if (nextStatus === '已解决' && !body.actual_time) body.actual_time = formatLocalDateTimeInput().replace('T', ' ')
      await api.updateWorkOrder(row.id, body)
      await Promise.all([query.reload(), statsQuery.reload()])
    }, nextStatus === '处理中' ? '工单已开始处理' : '工单已标记解决')
  }
  const header = <VaultPageHeader dataSection="cmdb-operations-header" contentClassName="h-auto min-h-14 flex-wrap">
    <Dropdown open={modeMenuOpen} onOpenChange={setModeMenuOpen}><DropdownTrigger asChild><Button data-work-order-mode-trigger type="button" variant="secondary" className={vaultHeaderSecondaryButtonClass}><Plus size={15} />新建工单<ChevronDown size={14} /></Button></DropdownTrigger><DropdownContent align="start" sideOffset={8} className="w-44 p-1">
      {[["create", "新建工单", Plus], ["stats", "统计与查询", BarChart3]].map(([key, label, Icon]) => <button type="button" data-work-order-mode-option={key} key={key} onClick={() => { setModeMenuOpen(false); if (key === 'create') setCreateOpen(true); else onModeChange?.('stats') }} className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary"><Icon size={14} /><span>{label}</span></button>)}
    </DropdownContent></Dropdown>
    {mode === 'stats' ? <VaultHeaderSearch className="min-w-[180px] max-w-[520px] flex-1" value={searchValue} onChange={(event) => { const value = event.target.value; setKeyword(value); if (!value) change('keyword', '') }} onKeyDown={(event) => { if (event.key === 'Enter') change('keyword', keyword.trim()) }} placeholder="搜索工单号或主题" rightAdornment={searchValue ? <button type="button" aria-label="清除工单搜索" title="清除工单搜索" className="grid h-6 w-6 place-items-center rounded hover:bg-foreground/10" onClick={() => { setKeyword(''); change('keyword', '') }}><X size={13} /></button> : null} /> : null}
    <span className="min-w-0 flex-1" />
    {mode === 'stats' ? <>
      <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><Button data-work-orders-filter type="button" variant="ghost" size="icon" className={vaultHeaderIconButtonClass} aria-label="选择筛选项" title="选择筛选项"><Filter size={16} /></Button></PopoverTrigger><PopoverContent align="end" sideOffset={8} className="max-h-[min(70vh,560px)] w-[min(320px,calc(100vw-32px))] overflow-y-auto p-3">{renderFilterFields(filters, change, resetFilters)}</PopoverContent></Popover>
      <Button type="button" variant="ghost" size="icon" aria-label="导出工单" title="导出工单" className={vaultHeaderIconButtonClass} onClick={() => action.run(() => api.exportWorkOrders(normalizedFilters))}><Download size={16} /></Button>
    </> : <span className="text-xs text-muted-foreground">新建工单</span>}
  </VaultPageHeader>
  const currentRows = query.error ? [] : query.data?.list || []
  const selectedCloseAllowed = canBulkCloseWorkOrders(currentRows, selectedOrderIds)
  const workOrderColumns = [
    { key: 'order_no', label: '工单号', width: 132, sticky: 'left', className: 'whitespace-nowrap font-mono text-[11px]', render: (value, row) => <button type="button" aria-label={`查看工单 ${value || ''}`} className="block max-w-full truncate text-left text-primary hover:underline" title={`查看工单 ${value || ''}`} onClick={() => setViewingOrder(row)}>{value || '查看详情'}</button> },
    { key: 'priority', label: '优先级', width: 78, className: 'whitespace-nowrap', render: (value) => <StatusPill tone={String(value).startsWith('P1') || value === '高' ? 'danger' : String(value).startsWith('P2') || value === '中' ? 'warning' : 'neutral'}>{value || '-'}</StatusPill> },
    { key: 'subject', label: '维护主题', width: 180, className: 'min-w-0', render: (value) => <span className="block truncate font-medium" title={value || ''}>{value || '-'}</span> },
    { key: 'maintenance_type', label: '维护类型', width: 142, className: 'min-w-0', render: (_, row) => <div className="min-w-0"><span className="block truncate" title={row.biz_type || ''}>{row.biz_type || '-'}</span><span className="block truncate text-[10px] text-muted-foreground" title={row.operation_type || ''}>{row.operation_type || '-'}</span></div> },
    { key: 'assets', label: '关联资产', width: 148, className: 'min-w-0', render: (value) => { const names = (value || []).map((item) => item.asset_name).filter(Boolean).join('、'); return <span className="block truncate" title={names}>{names || '-'}</span> } },
    { key: 'processing_time', label: '处理时间', width: 132, className: 'whitespace-nowrap text-[11px]', render: (_, row) => { const value = row.actual_time || row.plan_time; return <div><span className="block" title={value ? `${row.actual_time ? '解决时间' : '发生时间'}：${value}` : ''}>{formatWorkOrderTime(value)}</span>{row.status === '已关闭' ? <span className="block text-[10px] text-muted-foreground">{row.work_minutes || 0} 分钟</span> : null}</div> } },
    { key: 'maintainer', label: '维护人员', width: 112, className: 'min-w-0', render: (value) => <span className="block truncate" title={value || ''}>{value || '-'}</span> },
    { key: 'status', label: '维护状态', width: 128, className: 'whitespace-nowrap', render: (value, row) => { const next = getNextWorkOrderStatus(value); const label = next === '处理中' ? '开始处理' : next === '已解决' ? '标记解决' : next === '已关闭' ? '关闭工单' : ''; return <div className="flex flex-col items-start gap-0.5"><StatusPill tone={statusTone(value)}>{value || '-'}</StatusPill>{next ? <Button data-work-order-next-status={next} type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" disabled={action.busy} onClick={() => advanceWorkOrder(row)}>{label}<ChevronRight size={12} className="ml-0.5" /></Button> : null}</div> } },
    { key: 'actions', label: '操作', width: 80, sticky: 'right', className: 'whitespace-nowrap', render: (_, row) => <div className="flex"><ActionIcon label="编辑工单" onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除工单" danger onClick={() => setDeleting(row)}><Trash2 size={15} /></ActionIcon></div> },
  ]
  return <div className="flex min-h-0 flex-1 flex-col">{header}
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    {statsQuery.error && <ErrorBanner message={`统计加载失败：${statsQuery.error}`} onRetry={statsQuery.reload} />}
    {mode === 'stats' ? <section data-work-order-stats aria-label="工单处理流程" className="shrink-0 border-b border-border/70 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        {[
          ['new', '新建', statsQuery.data?.new || 0],
          ['processing', '处理中', statsQuery.data?.processing || 0],
          ['resolved', '已解决', statsQuery.data?.resolved || 0],
          ['closed', '已关闭', statsQuery.data?.closed || 0],
        ].map(([key, label, value], index) => <React.Fragment key={key}>
          {index > 0 ? <ChevronRight size={14} className="shrink-0 text-muted-foreground/60" /> : null}
          <div className="flex min-w-[95px] flex-1 items-center gap-2 py-1">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-[10px] text-muted-foreground">{index + 1}</span>
            <span className="min-w-0"><span className="block truncate text-[10px] text-muted-foreground">{label}</span><strong data-work-order-stat={key} className="block font-mono text-sm leading-4 tabular-nums">{statsQuery.loading || statsQuery.error ? '—' : value}</strong></span>
          </div>
        </React.Fragment>)}
        <span className="ml-auto shrink-0 border-l border-border/60 pl-3 text-[10px] text-muted-foreground">本月完成 <strong data-work-order-stat="completedThisMonth" className="ml-1 font-mono text-xs tabular-nums text-foreground">{statsQuery.loading || statsQuery.error ? '—' : statsQuery.data?.completedThisMonth || 0}</strong></span>
      </div>
    </section> : null}
    {selectedOrderIds.length ? <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-2 text-xs"><span className="flex items-center gap-3"><span>已选 {selectedOrderIds.length} 张工单</span><span className="text-muted-foreground">批量关闭仅适用于全部已解决的工单</span></span><Button data-work-order-bulk-close type="button" size="sm" onClick={() => completeWorkOrders(selectedOrderIds)} disabled={action.busy || !selectedCloseAllowed}><CheckCircle2 size={14} className="mr-1" />批量关闭</Button></div> : null}
    <DataTable compact pinSelection loading={query.loading} rows={currentRows} selected={selectedOrderIds} onSelectedChange={setSelectedOrderIds} columns={workOrderColumns} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s); setSelectedOrderIds([]) }} />
    <Dialog open={createOpen} onOpenChange={(next) => { if (!action.busy) setCreateOpen(next) }}>
      <DialogContent data-work-order-create-dialog className="flex h-[min(680px,calc(100vh-40px))] w-[min(900px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><DialogTitle className="flex items-center gap-2 text-sm tracking-normal"><Plus size={16} />新建工单</DialogTitle><div className="flex min-w-0 flex-wrap gap-2 text-xs text-muted-foreground"><span>{values.project_name || '当前项目'}</span><span>/</span><span>{values.order_no || '待生成编号'}</span></div></DialogHeader>
        {createOpen && <>
          {workConfig.error && <ErrorBanner message={workConfig.error} onRetry={workConfig.reload} />}
          {assets.error && <ErrorBanner message={assets.error} onRetry={assets.reload} />}
          <div data-work-order-editor className="min-h-0 flex-1 overflow-y-auto px-5">
            <form id="cmdb-work-order-form" onSubmit={(event) => { event.preventDefault(); saveDraft() }}>
              <fieldset disabled={action.busy} className="min-w-0">
                <section className="border-b border-border/60 py-4"><h3 className="mb-3 text-sm font-semibold">受理信息</h3><Fields fields={createFields.slice(2, 7)} value={values} onChange={setValues} className="gap-3" /></section>
                <section className="border-b border-border/60 py-4"><h3 className="mb-3 text-sm font-semibold">处理内容</h3><Fields fields={createFields.slice(7)} value={values} onChange={setValues} className="gap-3" /></section>
                <section className="py-4"><h3 className="mb-3 text-sm font-semibold">资源与附件</h3><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="关联资源"><div className="flex min-w-0 items-center gap-2"><AssetPicker floating options={assets.data || []} value={values.assets || []} onChange={(next) => setValues({ ...values, assets: next })} /><span className="min-w-0 truncate text-xs text-muted-foreground">{values.assets?.length ? `已关联 ${values.assets.length} 项 · ${values.assets.map((item) => item.asset_name).join('、')}` : '未关联资源'}</span></div></Field><AttachmentPanel workOrderId={values.id} refreshKey={attachmentRefresh} stagedFiles={stagedFiles} onAddFiles={(files) => { const accepted = files.filter((file) => file.size <= 50 * 1024 * 1024); if (accepted.length !== files.length) toast.error('超过 50 MiB 的附件未加入'); setStagedFiles((current) => [...current, ...accepted]) }} onRemoveStagedFile={(file) => setStagedFiles((current) => current.filter((item) => item !== file))} busy={action.busy} className="min-w-0 sm:col-span-1" /></div></section>
              </fieldset>
            </form>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3"><Button type="button" variant="ghost" disabled={action.busy} onClick={() => { setValues((current) => ({ ...newOrderDefaults(configuredWorkOrderOptions), project_name: current.project_name })); setStagedFiles([]) }}>清空</Button><span className="flex-1" /><Button type="button" variant="outline" disabled={action.busy} onClick={() => setCreateOpen(false)}>取消</Button><Button type="submit" form="cmdb-work-order-form" disabled={action.busy}>{action.busy ? '保存中…' : values.id ? '继续保存' : '创建工单'}</Button></div>
        </>}
      </DialogContent>
    </Dialog>
    <Dialog open={!!viewingOrder} onOpenChange={(next) => { if (!next) setViewingOrder(null) }}>
      <DialogContent data-work-order-detail className="flex max-h-[min(760px,calc(100vh-32px))] w-[min(760px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><DialogTitle className="text-sm tracking-normal">工单详情</DialogTitle><div className="truncate font-mono text-xs text-muted-foreground">{viewingOrder?.order_no || '工单编号'}</div></DialogHeader>
        {viewingOrder ? <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
            {[
              ['优先级', viewingOrder.priority], ['维护状态', viewingOrder.status], ['维护主题', viewingOrder.subject],
              ['工单类别', viewingOrder.biz_type], ['运维类型', viewingOrder.operation_type], ['维护人员', viewingOrder.maintainer],
              ['负责人', viewingOrder.owner], ['发生时间', formatWorkOrderTime(viewingOrder.plan_time)], ['解决时间', formatWorkOrderTime(viewingOrder.actual_time)],
              ['处理时长', viewingOrder.status === '已关闭' ? `${viewingOrder.work_minutes || 0} 分钟` : '待结束结算'], ['处理结果', viewingOrder.result],
            ].map(([label, value]) => <div key={label} className="min-w-0"><span className="block text-[10px] text-muted-foreground">{label}</span><span className="block break-words text-xs" title={String(value || '')}>{value || '—'}</span></div>)}
          </div>
          <section className="border-t border-border/60 pt-3"><h3 className="mb-2 text-xs font-semibold">关联资产</h3>{viewingOrder.assets?.length ? <div className="flex flex-wrap gap-1.5">{viewingOrder.assets.map((asset) => <span key={`${asset.asset_type}:${asset.asset_id}`} className="rounded border border-border px-2 py-1 text-[11px]">{asset.asset_name || '未命名资产'}</span>)}</div> : <p className="text-xs text-muted-foreground">未关联资产</p>}</section>
          {viewingOrder.remark ? <section className="border-t border-border/60 pt-3"><h3 className="mb-2 text-xs font-semibold">问题描述</h3><p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{viewingOrder.remark}</p></section> : null}
          <AttachmentPanel workOrderId={viewingOrder.id} />
        </div> : null}
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3"><Button type="button" variant="outline" onClick={() => setViewingOrder(null)}>关闭</Button>{viewingOrder ? <Button type="button" onClick={() => { const current = viewingOrder; setViewingOrder(null); open(current) }}><Pencil size={14} className="mr-1" />编辑工单</Button> : null}</div>
      </DialogContent>
    </Dialog>
    <Dialog open={!!editor} onOpenChange={(next) => { if (!next && !action.busy) setEditor(null) }}>
      <DialogContent data-work-order-edit-dialog className="flex max-h-[min(720px,calc(100vh-32px))] w-[min(760px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><DialogTitle className="text-sm tracking-normal">编辑工单</DialogTitle></DialogHeader>
        {editor ? <form onSubmit={(event) => { event.preventDefault(); saveExisting() }} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"><Fields fields={fields} value={statsValues} onChange={setStatsValues} className="gap-3" /><AssetPicker options={assets.data || []} value={statsValues.assets || []} onChange={(next) => setStatsValues({ ...statsValues, assets: next })} /><AttachmentPanel workOrderId={editor.id} /></div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3"><Button type="button" variant="outline" disabled={action.busy} onClick={() => setEditor(null)}>取消</Button><Button type="submit" disabled={action.busy}>{action.busy ? '保存中…' : '保存工单'}</Button></div>
        </form> : null}
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="删除工单" message={`确认删除“${deleting?.subject || ''}”？`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deleteWorkOrder(deleting.id); setDeleting(null); await Promise.all([query.reload(), statsQuery.reload()]) }, '工单已删除')} />
    <ConfirmDialog open={completing.length > 0} onOpenChange={(v) => { if (!v) setCompleting([]) }} title="关闭工单" message={`确认关闭 ${completing.length} 张已解决工单？`} confirmLabel="确认关闭" busy={action.busy} onConfirm={() => action.run(async () => {
      const result = await api.batchUpdateWorkOrders(completing, '已关闭')
      const updated = Number(result?.updated || 0)
      if (updated !== completing.length) throw new Error(`仅完成 ${updated} 张工单，列表未发生完整更新，请刷新后重试`)
      await Promise.all([query.reload(), statsQuery.reload()])
      setCompleting([])
      setSelectedOrderIds([])
    }, '工单已完成')} />
  </div>
}
