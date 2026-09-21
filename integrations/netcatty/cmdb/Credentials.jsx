import React, { useCallback, useState } from 'react'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { allPages, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { ActionIcon, DataTable, ErrorBanner, ModalForm, Pagination, SearchBox, SelectControl, Toolbar } from './ui'

const TYPES = ['SSH', 'Telnet', 'SNMPv2c', 'SNMPv3', 'API Token', 'RDP (远程桌面)', 'IPMI (带外)']
const loadAssets = () => allPages((params) => api.infrastructure({ ...params, scope: 'infrastructure' }))

export default function Credentials() {
  const [type, setType] = useState('')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [deleting, setDeleting] = useState(null)
  const action = useAction()
  const assets = useDirectory(loadAssets)
  const loader = useCallback(() => api.credentials({ cred_type: type, keyword: search, page, page_size: pageSize }), [type, search, page, pageSize])
  const query = useQuery(loader)
  const fields = [...textFields([['name', '名称']]), { key: 'cred_type', label: '类型', options: choices(TYPES) }, { key: 'asset_id', label: '关联基础设施', numeric: true, options: choices((assets.data || []).map((a) => ({ value: a.id, label: `${a.name} · ${a.asset_code || '-'}` })), '不关联') }, ...textFields([['description', '描述', 'textarea']])]
  const open = (record = {}) => { setEditor(record); setValues({ asset_id: 0, ...record }) }
  const save = () => action.run(async () => { validateFields([{ ...fields[0], required: true }, ...fields.slice(1)], values); if (editor.id) await api.updateCredential(editor.id, values); else await api.createCredential(values); setEditor(null); query.reload() }, '凭证元信息已保存')
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="mx-5 mt-3 rounded-md border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">仅登记凭证名称、类型、用途和关联资产，不存储明文口令。</div>
    <Toolbar><SelectControl value={type} onChange={(v) => { setType(v); setPage(1) }} options={choices(TYPES, '全部类型')} className="w-44" /><SearchBox value={keyword} onChange={setKeyword} onSearch={() => { setSearch(keyword.trim()); setPage(1) }} placeholder="搜索名称或描述" /><Button variant="outline" size="sm" onClick={() => { setSearch(keyword.trim()); setPage(1) }}>查询</Button><span className="ml-auto" /><ActionIcon label="刷新" onClick={query.reload}><RefreshCw size={15} /></ActionIcon><Button size="sm" onClick={() => open()}><Plus size={14} className="mr-1" />新增凭证</Button></Toolbar>
    {(query.error || assets.error) && <ErrorBanner message={query.error || assets.error} onRetry={() => { query.reload(); assets.reload() }} />}
    <DataTable loading={query.loading} rows={query.error ? [] : query.data?.list || []} columns={[...textFields([['name', '名称'], ['cred_type', '类型'], ['description', '描述'], ['asset_name', '关联基础设施'], ['updated_at', '更新时间']]), { key: 'actions', label: '操作', render: (_, row) => <div className="flex"><ActionIcon label="编辑凭证" onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除凭证" danger onClick={() => setDeleting(row)}><Trash2 size={15} /></ActionIcon></div> }]} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={editor?.id ? '编辑凭证' : '新增凭证'} onSubmit={save} busy={action.busy}><Fields fields={[{ ...fields[0], required: true }, ...fields.slice(1)]} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="删除凭证" message={`确认删除“${deleting?.name || ''}”？`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deleteCredential(deleting.id); setDeleting(null); query.reload() }, '凭证已删除')} />
  </div>
}
