import React, { useCallback, useEffect, useState } from 'react'
import { Download, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { allPages, useAction, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { ActionIcon, DataTable, ErrorBanner, ModalForm, Pagination, SearchBox, SelectControl, StatusPill, statusTone, Toolbar } from './ui'

const BIZ_TYPES = ['故障处理', '日常维护', '变更操作', '资产调配']
const OPERATION_TYPES = ['排障', '优化', '响应', '值守']
const STATUSES = ['新建', '已分配', '处理中', '已解决', '已关闭', '已取消']
const RESULTS = ['处理成功', '临时规避', '未发现异常', '未解决', '已升级处理', '需二次维护']
const PRIORITIES = ['P1（紧急）', 'P2（较高）', 'P3（普通）', 'P4（较低）']

const HANDLER_KEY = 'netcatty_cmdb_work_order_handler'
const loadAssets = () => allPages(api.infrastructure, { scope: 'infrastructure' })
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
  plan_time: new Date().toISOString().slice(0, 16),
  maintainer: typeof window === 'undefined' ? '' : window.localStorage.getItem(HANDLER_KEY) || '',
  asset_id: 0,
})

export default function WorkOrders({ mode = 'create' }) {
  const [filters, setFilters] = useState({ biz_type: '', status: '', result: '', keyword: '' })
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState(newOrderDefaults)
  const [deleting, setDeleting] = useState(null)
  const action = useAction()
  const assets = useQuery(loadAssets, [])
  const workConfig = useQuery(loadWorkConfig, [])
  const projects = useQuery(api.projects)
  const loader = useCallback(() => api.workOrders({ ...filters, page, page_size: pageSize }), [filters, page, pageSize])
  const query = useQuery(loader)
  useEffect(() => {
    if (mode !== 'create') return
    setValues((current) => ({ ...newOrderDefaults(), ...current, project_name: projects.data?.list?.[0]?.name || current.project_name || '当前项目' }))
  }, [mode, projects.data])
  const change = (key, value) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1) }
  const open = (record = {}) => { setEditor(record); setValues({ priority: 'P3（普通）', status: '新建', ...record, plan_time: String(record.plan_time || '').replace(' ', 'T'), actual_time: String(record.actual_time || '').replace(' ', 'T') }) }
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
    { key: 'subject', label: '工单主题', required: true },
    { key: 'asset_id', label: '关联资产', numeric: true, searchable: true, options: choices((assets.data || []).map((asset) => ({ value: asset.id, label: `${asset.name || asset.asset_code || `#${asset.id}`} · ${asset.mgmt_ip || asset.device_type || '未分类'}` })), '不关联资产') },
    { key: 'remark', label: '故障内容', type: 'textarea' },
    { key: 'result', label: '处理结果', type: 'textarea' },
  ]
  const fields = [...createFields, { key: 'status', label: '工单状态', options: choices(STATUSES) }, ...textFields([['actual_time', '完成时间', 'datetime-local']])]
  const save = () => action.run(async () => {
    validateFields(mode === 'create' ? createFields : fields, values)
    const body = { ...values, plan_time: String(values.plan_time || '').replace('T', ' '), actual_time: String(values.actual_time || '').replace('T', ' ') }
    if (editor?.id) await api.updateWorkOrder(editor.id, body); else await api.createWorkOrder(body)
    if (values.maintainer && typeof window !== 'undefined') window.localStorage.setItem(HANDLER_KEY, values.maintainer)
    setEditor(null); setValues(newOrderDefaults()); query.reload()
  }, '工单已保存')
  if (mode === 'create') return <div className="min-h-0 flex-1 overflow-auto">{workConfig.error && <ErrorBanner message={workConfig.error} onRetry={workConfig.reload} />}<form onSubmit={(event) => { event.preventDefault(); save() }} className="mx-auto flex min-h-full w-full max-w-[960px] flex-col px-5 py-5"><section><h2 className="text-sm font-semibold">基本信息</h2><p className="mt-1 text-xs text-muted-foreground">工单号保存后按配置中心规则自动生成</p><div className="mt-4"><Fields fields={createFields} value={values} onChange={setValues} /></div></section><div className="mt-auto flex justify-end gap-2 border-t border-border/70 pt-4"><Button type="button" variant="outline" onClick={() => setValues(newOrderDefaults())}>清空</Button><Button type="submit" disabled={action.busy}>{action.busy ? '创建中…' : '创建工单'}</Button></div></form></div>
  return <div className="flex min-h-0 flex-1 flex-col">
    <Toolbar>
      <SelectControl value={filters.biz_type} onChange={(v) => change('biz_type', v)} options={choices(configuredCategories, '全部类型')} className="w-36" />
      <SelectControl value={filters.status} onChange={(v) => change('status', v)} options={choices(STATUSES, '全部状态')} className="w-36" />
      <SelectControl value={filters.result} onChange={(v) => change('result', v)} options={choices(RESULTS, '全部结果')} className="w-40" />
      <SearchBox value={keyword} onChange={setKeyword} onSearch={() => change('keyword', keyword.trim())} placeholder="搜索主题或工单号" />
      <Button variant="outline" size="sm" onClick={() => change('keyword', keyword.trim())}>查询</Button>
      <div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => action.run(() => api.exportWorkOrders(filters))}><Download size={14} className="mr-1" />导出</Button><ActionIcon label="刷新" onClick={query.reload}><RefreshCw size={15} /></ActionIcon><Button size="sm" onClick={() => open()}><Plus size={14} className="mr-1" />新增工单</Button></div>
    </Toolbar>
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <DataTable loading={query.loading} rows={query.error ? [] : query.data?.list || []} columns={[
      { key: 'order_no', label: '工单号' }, { key: 'priority', label: '优先级', render: (v) => <StatusPill tone={v === '高' ? 'danger' : v === '中' ? 'warning' : 'neutral'}>{v}</StatusPill> },
      ...textFields([['subject', '工单主题'], ['biz_type', '工单类别'], ['operation_type', '运维类型']]), { key: 'status', label: '状态', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
      ...textFields([['plan_time', '计划时间'], ['result', '结果'], ['owner', '负责人'], ['maintainer', '维护人员']]),
      { key: 'actions', label: '操作', render: (_, row) => <div className="flex"><ActionIcon label="编辑工单" onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除工单" danger onClick={() => setDeleting(row)}><Trash2 size={15} /></ActionIcon></div> },
    ]} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={editor?.id ? '编辑工单' : '新增工单'} onSubmit={save} busy={action.busy} wide><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="删除工单" message={`确认删除“${deleting?.subject || ''}”？`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deleteWorkOrder(deleting.id); setDeleting(null); query.reload() }, '工单已删除')} />
  </div>
}
