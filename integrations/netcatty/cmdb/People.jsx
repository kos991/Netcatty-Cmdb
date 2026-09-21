import React, { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { allPages, directoryChanged, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { ActionIcon, DataTable, DefinitionList, DetailSheet, ErrorBanner, ModalForm, Pagination, SearchBox, SelectControl, StatusPill, Toolbar } from './ui'
import Organizations from './Organizations'

const loadDirectory = async () => { const [tree, people] = await Promise.all([api.orgTree(), allPages(api.persons)]); return { tree: tree.list || [], people } }

function PersonAssets({ person, people, onNavigate, onTransferred }) {
  const loader = useCallback(() => api.personAssets(person.id), [person.id])
  const query = useQuery(loader)
  const [selected, setSelected] = useState([])
  const [target, setTarget] = useState('')
  const [confirm, setConfirm] = useState(false)
  const action = useAction()
  const rows = query.data?.assets || []
  return <div className="space-y-3"><DefinitionList items={['person_code:工号', 'name:姓名', 'org_name:组织', 'department:部门', 'group_name:分组', 'phone:电话', 'title:岗位', 'status:状态'].map((pair) => { const [key, label] = pair.split(':'); return [label, person[key]] })} />
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <DataTable rows={rows} loading={query.loading} selected={selected} onSelectedChange={setSelected} columns={[
      { key: 'name', label: '名下资产', render: (v, row) => <Button variant="link" className="h-auto p-0 text-[12px]" onClick={() => onNavigate({ tableKey: row.source_type === 'legacy_asset' ? 'assets' : 'cmdb_assets', id: row.source_type === 'legacy_asset' ? row.source_id : row.id })}>{v || row.asset_code || `#${row.id}`}</Button> }, { key: 'device_type', label: '类型', render: (v, row) => v || row.asset_class || '-' }, { key: 'asset_code', label: '编码' }, { key: 'manage_ip', label: 'IP' }, { key: 'status', label: '状态' },
    ]} />
    <SelectControl value={target} onChange={setTarget} options={choices(people.filter((p) => p.id !== person.id).map((p) => ({ value: p.id, label: `${p.name} · ${p.department || '未分配'}` })), '选择接收人')} />
    <Button disabled={!target || !rows.length || !!query.error || query.loading} onClick={() => setConfirm(true)}>{selected.length ? `交接已选 ${selected.length} 项` : `交接全部 ${rows.length} 项`}</Button>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="确认资产交接" message="交接后更新资产负责人及部门，并保留履历。" confirmLabel="确认交接" busy={action.busy} onConfirm={() => action.run(async () => { await api.transferPersonAssets({ from_person_id: person.id, to_person_id: Number(target), asset_ids: selected.length ? selected : rows.map((r) => r.id) }); setConfirm(false); setSelected([]); query.reload(); onTransferred() }, '交接完成')} />
  </div>
}

export default function People({ focusTarget, onNavigate }) {
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState('')
  const [organizations, setOrganizations] = useState(false)
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [deleting, setDeleting] = useState(null)
  const [detail, setDetail] = useState(null)
  const directory = useDirectory(loadDirectory)
  const loader = useCallback(() => api.persons({ keyword: search, ...selection, status, page, page_size: pageSize }), [search, selection, status, page, pageSize])
  const query = useQuery(loader)
  const action = useAction()
  const tree = directory.data?.tree || []
  useEffect(() => { if (focusTarget?.tableKey === 'persons' && directory.data) setDetail(directory.data.people.find((p) => p.id === focusTarget.id) || null) }, [focusTarget, directory.data])
  const open = (record = {}) => { setEditor(record); setValues({ status: '在职', org_id: 0, department_id: 0, group_id: 0, ...record }) }
  const departments = tree.find((node) => node.id === values.org_id)?.children || []
  const groups = departments.find((node) => node.id === values.department_id)?.children || []
  const orgOptions = (nodes) => choices(nodes.map((node) => ({ value: node.id, label: node.name })), '未分配')
  const fields = [
    { key: 'name', label: '姓名', required: true }, { key: 'person_code', label: '工号' },
    { key: 'org_id', label: '所属组织', numeric: true, options: orgOptions(tree), derive: () => ({ department_id: 0, group_id: 0 }) },
    { key: 'department_id', label: '所属部门', numeric: true, options: orgOptions(departments), derive: () => ({ group_id: 0 }) },
    { key: 'group_id', label: '所属分组', numeric: true, options: orgOptions(groups) },
    ...textFields([['title', '岗位'], ['phone', '联系电话']]), { key: 'status', label: '在职状态', options: ['在职', '离职', '调休'] }, { key: 'remark', label: '备注', type: 'textarea' },
  ]
  const refresh = () => { query.reload(); directoryChanged() }
  const nav = (nodes, path = []) => nodes.map((node) => {
    const branch = [...path, node]
    const params = { org_name: branch[0].name, ...(branch[1] ? { department: branch[1].name } : {}), ...(branch[2] ? { group_name: branch[2].name } : {}) }
    return <div key={node.id}><Button variant={JSON.stringify(selection) === JSON.stringify(params) ? 'secondary' : 'ghost'} className="h-[30px] w-full justify-start truncate px-2 text-[12px] font-normal" style={{ paddingLeft: 10 + path.length * 12 }} onClick={() => { setSelection(params); setPage(1) }}>{node.name}</Button>{nav(node.children || [], branch)}</div>
  })
  return <div className="flex h-full min-h-0"><aside className="flex w-72 shrink-0 flex-col border-r border-border/70"><div className="flex h-[62px] items-center justify-between border-b border-border/70 px-4"><strong className="text-sm">组织架构</strong><div className="flex"><ActionIcon label="维护组织架构" onClick={() => setOrganizations(true)}><Settings2 size={15} /></ActionIcon><ActionIcon label="新增人员" onClick={() => open()}><Plus size={15} /></ActionIcon></div></div><div className="border-b border-border/70 p-2.5"><SearchBox value="" placeholder="搜索组织节点" className="min-w-0 max-w-none" readOnly /></div><div className="min-h-0 flex-1 overflow-auto p-2"><Button variant="ghost" className="h-[30px] w-full justify-start px-2 text-[12px] font-normal" onClick={() => { setSelection({}); setPage(1) }}>全部人员</Button>{nav(tree)}</div><div className="flex h-12 items-center gap-2 border-t border-border/70 px-3"><Button variant="ghost" size="sm" onClick={() => setOrganizations(true)}>全部展开</Button></div></aside><div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[62px] shrink-0 items-center gap-3 border-b border-border/70 px-4"><div className="min-w-40"><strong className="text-sm">{selection.group_name || selection.department || selection.org_name || '全部人员'}</strong><p className="mt-0.5 text-[11px] text-muted-foreground">人员目录与资产归属</p></div><SearchBox className="max-w-[520px]" value={keyword} onChange={setKeyword} onSearch={() => { setSearch(keyword.trim()); setPage(1) }} placeholder="搜索姓名、人员编号、职务或联系电话" /><span className="flex-1" /><Button size="sm" onClick={() => open()}><Plus size={14} className="mr-2" />新增人员</Button></header>
      <Toolbar><SelectControl className="w-32" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={choices(['在职', '离职', '调休'], '全部状态')} /><SelectControl className="w-36" value="" options={[{ value: '', label: '全部节点类型' }]} /><Button variant="outline" size="sm" className="h-[32px] text-[12px]" onClick={() => { setSearch(keyword.trim()); setPage(1) }}>更多筛选</Button></Toolbar>
      {(query.error || directory.error) && <ErrorBanner message={query.error || directory.error} onRetry={() => { query.reload(); directory.reload() }} />}
      <DataTable rows={query.error ? [] : query.data?.list || []} loading={query.loading} columns={[
        { key: 'name', label: '姓名', render: (v, row) => <Button variant="link" className="h-auto p-0 text-[12px]" onClick={() => setDetail(row)}>{v}</Button> }, ...textFields([['person_code', '工号'], ['org_name', '组织'], ['department', '部门'], ['group_name', '分组'], ['title', '岗位'], ['phone', '电话']]), { key: 'status', label: '状态', render: (v) => <StatusPill>{v}</StatusPill> }, { key: 'asset_count', label: '资产数', className: 'font-mono tabular-nums', render: (v, row) => <Button variant="link" className="h-auto p-0 font-mono text-[12px] tabular-nums" onClick={() => setDetail(row)}>{v || 0}</Button> },
        { key: 'actions', label: '操作', render: (_, row) => <div className="flex"><ActionIcon label="编辑人员" onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除人员" danger onClick={() => setDeleting(row)}><Trash2 size={15} /></ActionIcon></div> },
      ]} /><Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    </div>
    <DetailSheet open={organizations} onOpenChange={setOrganizations} title="组织架构维护">{organizations && <Organizations />}</DetailSheet>
    <DetailSheet open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }} title="人员与名下资产">{detail && <PersonAssets person={detail} people={directory.data?.people || []} onTransferred={refresh} onNavigate={(target) => { setDetail(null); onNavigate(target) }} />}</DetailSheet>
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={editor?.id ? '编辑人员' : '新增人员'} busy={action.busy} onSubmit={() => action.run(async () => { validateFields(fields, values); const body = { ...values, org_name: '', department: '', group_name: '' }; if (editor.id) await api.updatePerson(editor.id, body); else await api.createPerson(body); setEditor(null); refresh() }, '已保存人员')}><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="删除人员" message={`确认删除“${deleting?.name}”？请先交接名下资产。`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deletePerson(deleting.id); setDeleting(null); refresh() }, '已删除人员')} />
  </div>
}
