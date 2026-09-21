import React, { useState } from 'react'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAction, useQuery, directoryChanged } from './hooks'
import { Fields, validateFields } from './Fields'
import { ActionIcon, DataTable, ErrorBanner, ModalForm, Pagination, SearchBox, Toolbar } from './ui'

// 配置目录共用查询和编辑流程；业务字段与保存契约由各目录明确提供。
export default function Catalog({ title, load, save, remove, fields, columns, defaults = {}, onChanged, extra }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [deleting, setDeleting] = useState(null)
  const query = useQuery(load, [])
  const action = useAction()
  const currentFields = typeof fields === 'function' ? fields(values, editor, query.data || []) : fields
  const visible = (query.data || []).filter((item) => !keyword || columns.some((column) => String(item[column.key] ?? '').toLowerCase().includes(keyword.toLowerCase())))
  const refreshed = () => { query.reload(); directoryChanged(); onChanged?.() }
  const open = (record = {}) => { setValues({ ...defaults, ...record }); setEditor(record) }
  return <div className="flex min-h-0 flex-1 flex-col">
    <Toolbar><SearchBox value={keyword} onChange={(v) => { setKeyword(v); setPage(1) }} placeholder={`搜索${title}`} /><span className="ml-auto" />{extra?.(refreshed)}<ActionIcon label="刷新" onClick={query.reload}><RefreshCw size={15} /></ActionIcon><Button size="sm" onClick={() => open()}><Plus size={14} className="mr-2" />新增{title}</Button></Toolbar>
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <DataTable loading={query.loading} rows={query.error ? [] : visible.slice((page - 1) * pageSize, page * pageSize)} columns={[...columns, { key: 'actions', label: '操作', render: (_, row) => <div className="flex"><ActionIcon label={`编辑${row.name || title}`} onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label={`删除${row.name || title}`} danger onClick={() => setDeleting(row)}><Trash2 size={15} /></ActionIcon></div> }]} />
    <Pagination page={page} pageSize={pageSize} total={visible.length} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={`${editor?.id ? '编辑' : '新增'}${title}`} busy={action.busy} onSubmit={() => action.run(async () => { validateFields(currentFields, values); await save(values, editor); setEditor(null); refreshed() }, '已保存')}><Fields fields={currentFields} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title={`删除${title}`} message={`确认删除“${deleting?.name || deleting?.model || deleting?.field_name || title}”？已被引用的配置将由系统校验。`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await remove(deleting); setDeleting(null); refreshed() }, '已删除')} />
  </div>
}
