import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil, Server, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { allPages, useAction, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { ActionIcon, DataTable, DefinitionList, DetailSheet, ErrorBanner, ModalForm, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'
import ImportDialog from './ImportDialog'

const SERVER_FIELDS = textFields([['device_name', '设备名称'], ['asset_code', '资产编码'], ['brand_model', '品牌型号'], ['serial_number', '序列号'], ['location', '位置'], ['rack_unit', '机位'], ['cpu_info', 'CPU'], ['memory_info', '内存'], ['disk_info', '磁盘'], ['mgmt_ip', '管理 IP'], ['biz_ip', '业务 IP'], ['mgmt_url', '管理地址'], ['os_type', '操作系统'], ['admin_user', '管理员'], ['purchase_date', '采购日期', 'date'], ['warranty_date', '质保日期', 'date'], ['remark', '备注', 'textarea']]).map((f) => ({ ...f, required: f.key === 'device_name' }))
const APP_FIELDS = textFields([['app_name', '系统名称'], ['version', '版本'], ['port', '端口'], ['access_url', '访问地址'], ['middleware', '中间件'], ['database_info', '数据库'], ['owner', '负责人'], ['description', '说明', 'textarea'], ['remark', '备注', 'textarea']]).map((f) => ({ ...f, required: f.key === 'app_name' }))
const loadDirectory = () => allPages(api.servers)

export default function Systems({ keyword, focusTarget, meta, command, leadingControl }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [deleting, setDeleting] = useState(null)
  const [detail, setDetail] = useState(null)
  const [serverOpen, setServerOpen] = useState(false)
  const [serverPage, setServerPage] = useState(1)
  const handledCommandId = useRef(null)
  const action = useAction()
  const directory = useQuery(loadDirectory, [])
  const loader = useCallback(() => api.apps({ keyword, app_type: type, status, page, page_size: pageSize }), [keyword, type, status, page, pageSize])
  const query = useQuery(loader)
  const detailLoader = useCallback(async () => {
    if (!detail) return null
    if (detail.tableKey === 'servers') return api.server(detail.id)
    const apps = await allPages(api.apps)
    const app = apps.find((item) => item.id === detail.id)
    if (!app) throw new Error('业务系统不存在')
    const host = app.server_id ? await api.server(app.server_id) : null
    return { app, ...host }
  }, [detail])
  const detailQuery = useQuery(detailLoader)
  useEffect(() => { setPage(1) }, [keyword])
  useEffect(() => { if (['servers', 'server_apps'].includes(focusTarget?.tableKey)) setDetail(focusTarget) }, [focusTarget])
  const open = useCallback((kind, record = {}) => { setEditor({ kind, record }); setValues({ status: kind === 'server' ? '运行中' : '正常运行', app_type: '业务应用', ...record }) }, [])
  const refresh = useCallback(() => { query.reload(); directory.reload(); detailQuery.reload() }, [detailQuery, directory, query])
  useEffect(() => {
    if (!command?.id || command?.tab !== 'systems' || handledCommandId.current === command.id) return
    handledCommandId.current = command.id
    if (command.type === 'create') open('app')
    if (command.type === 'refresh') refresh()
  }, [command, open, refresh])
  const fields = editor?.kind === 'server' ? [...SERVER_FIELDS, { key: 'status', label: '状态', options: choices(meta.server_statuses || []) }] : [
    ...APP_FIELDS, { key: 'server_id', label: '承载基础设施', numeric: true, required: true, options: choices((directory.data || []).map((s) => ({ value: s.id, label: `${s.device_name} · ${s.biz_ip || s.mgmt_ip || ''}` }))) },
    { key: 'app_type', label: '系统类型', options: choices(meta.app_types || []) }, { key: 'status', label: '状态', options: choices(meta.app_statuses || []) },
  ]
  const appColumns = [
    { key: 'app_name', label: '业务系统', render: (v, row) => <Button variant="link" className="h-auto p-0" onClick={() => setDetail({ tableKey: 'server_apps', id: row.id })}>{v}</Button> },
    ...textFields([['app_type', '类型'], ['version', '版本'], ['server_name', '承载设备'], ['server_biz_ip', 'IP'], ['port', '端口'], ['owner', '负责人']]), { key: 'status', label: '状态', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
    { key: 'actions', label: '操作', render: (_, row) => <div className="flex"><ActionIcon label="编辑系统" onClick={() => open('app', row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除系统" danger onClick={() => setDeleting({ kind: 'app', record: row })}><Trash2 size={15} /></ActionIcon></div> },
  ]
  return <div className="flex min-h-0 flex-1 flex-col"><Toolbar>
    {leadingControl}
    <SelectControl className="w-36" value={type} onChange={(v) => { setType(v); setPage(1) }} options={choices(meta.app_types || [], '全部类型')} /><SelectControl className="w-36" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={choices(meta.app_statuses || [], '全部状态')} />
    <div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => setServerOpen(true)}><Server size={14} className="mr-1" />承载设备</Button><ImportDialog title="设备信息导入" importer={api.importSangfor} onImported={refresh} /></div>
  </Toolbar>
    {(query.error || directory.error) && <ErrorBanner message={query.error || directory.error} onRetry={refresh} />}
    <DataTable loading={query.loading} rows={query.error ? [] : query.data?.list || []} columns={appColumns} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    <DetailSheet open={serverOpen} onOpenChange={setServerOpen} title="承载基础设施" actions={<Button size="sm" onClick={() => open('server')}>新增</Button>}><DataTable rows={(directory.data || []).slice((serverPage - 1) * 20, serverPage * 20)} columns={[
      { key: 'device_name', label: '设备名称', render: (v, row) => <Button variant="link" onClick={() => { setServerOpen(false); setDetail({ tableKey: 'servers', id: row.id }) }}>{v}</Button> }, ...textFields([['biz_ip', '业务 IP'], ['mgmt_ip', '管理 IP'], ['status', '状态']]), { key: 'actions', label: '操作', render: (_, row) => <div className="flex"><ActionIcon label="编辑设备" onClick={() => open('server', row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除设备" danger onClick={() => setDeleting({ kind: 'server', record: row })}><Trash2 size={15} /></ActionIcon></div> },
    ]} /><Pagination page={serverPage} pageSize={20} total={directory.data?.length || 0} onChange={setServerPage} /></DetailSheet>
    <DetailSheet open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }} title="业务系统与承载设备详情">
      {detailQuery.error && <ErrorBanner message={detailQuery.error} onRetry={detailQuery.reload} />}
      {detailQuery.data && <div className="space-y-4">{detailQuery.data.app && <DefinitionList items={[...APP_FIELDS, { key: 'status', label: '状态' }, { key: 'app_type', label: '系统类型' }].map((f) => [f.label, detailQuery.data.app[f.key]])} />}{detailQuery.data.server && <><h3 className="text-sm font-medium">承载基础设施</h3><DefinitionList items={SERVER_FIELDS.map((f) => [f.label, detailQuery.data.server[f.key]])} /><h3 className="text-sm font-medium">承载系统</h3><DataTable rows={detailQuery.data.apps || []} columns={appColumns} /></>}</div>}
    </DetailSheet>
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={`${editor?.record.id ? '编辑' : '新增'}${editor?.kind === 'server' ? '承载设备' : '业务系统'}`} wide busy={action.busy} onSubmit={() => action.run(async () => { validateFields(fields, values); if (editor.kind === 'server') { if (editor.record.id) await api.updateServer(editor.record.id, values); else await api.createServer(values) } else if (editor.record.id) await api.updateApp(editor.record.id, values); else await api.createApp(values.server_id, values); setEditor(null); refresh() }, '已保存')}><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="确认删除" message={deleting?.kind === 'server' ? '删除承载设备会同时删除其关联业务系统，请确认。' : '确认删除此业务系统？'} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { if (deleting.kind === 'server') await api.deleteServer(deleting.record.id); else await api.deleteApp(deleting.record.id); setDeleting(null); refresh() }, '已删除')} />
  </div>
}
