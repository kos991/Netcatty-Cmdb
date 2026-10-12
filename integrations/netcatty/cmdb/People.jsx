import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, ChevronDown, Download, Filter, Folder, GripVertical, Pencil, Plus, Settings2, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { VaultHeaderSearch, VaultPageHeader, vaultHeaderIconButtonClass } from '@/components/vault/VaultPageHeader'
import { api } from './api'
import { allPages, directoryChanged, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { ActionIcon, DataTable, DefinitionList, DetailSheet, ErrorBanner, ModalForm, Pagination, SearchBox, SelectControl, StatusPill } from './ui'
import Organizations from './Organizations'
import { peopleCreateMenuItems } from './peopleToolbarModel'
import { organizationPersonEditorPath } from './organizationEditorModel'

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
  const [selectedOrgId, setSelectedOrgId] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState('')
  const [organizations, setOrganizations] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [deleting, setDeleting] = useState(null)
  const [detail, setDetail] = useState(null)
  const [dragPerson, setDragPerson] = useState(null)
  const [orgKeyword, setOrgKeyword] = useState('')
  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set())
  const fileInput = useRef(null)
  const directory = useDirectory(loadDirectory)
  const loader = useCallback(() => api.persons({ keyword: search, ...selection, status, page, page_size: pageSize }), [search, selection, status, page, pageSize])
  const query = useQuery(loader)
  const action = useAction()
  const tree = useMemo(() => directory.data?.tree || [], [directory.data?.tree])
  const selectedOrgName = useMemo(() => {
    const find = (nodes) => {
      for (const node of nodes) {
        if (Number(node.id) === Number(selectedOrgId)) return node.name
        const childName = find(node.children || [])
        if (childName) return childName
      }
      return ''
    }
    return selectedOrgId ? find(tree) : ''
  }, [tree, selectedOrgId])
  useEffect(() => { if (selectedOrgId && directory.data && !selectedOrgName) { setSelectedOrgId(0); setSelection({}) } }, [directory.data, selectedOrgId, selectedOrgName])
  const visibleTree = useMemo(() => {
    const keyword = orgKeyword.trim().toLowerCase()
    if (!keyword) return tree
    const filter = (nodes) => nodes.flatMap((node) => {
      const children = filter(node.children || [])
      return node.name.toLowerCase().includes(keyword) || children.length ? [{ ...node, children }] : []
    })
    return filter(tree)
  }, [orgKeyword, tree])
  useEffect(() => { if (focusTarget?.tableKey === 'persons' && directory.data) setDetail(directory.data.people.find((p) => p.id === focusTarget.id) || null) }, [focusTarget, directory.data])
  const open = (record = {}) => { setEditor(record); setValues({ status: '在职', org_id: 0, department_id: 0, group_id: 0, ...record, ...(record.id ? organizationPersonEditorPath(record, tree) : {}) }) }
  const departments = tree.find((node) => Number(node.id) === Number(values.org_id))?.children || []
  const groups = departments.find((node) => Number(node.id) === Number(values.department_id))?.children || []
  const orgOptions = (nodes) => choices(nodes.map((node) => ({ value: node.id, label: node.name })), '未分配')
  const fields = [
    { key: 'name', label: '姓名', required: true }, { key: 'person_code', label: '工号' },
    { key: 'org_id', label: '所属组织', numeric: true, options: orgOptions(tree), derive: () => ({ department_id: 0, group_id: 0 }) },
    { key: 'department_id', label: '所属部门', numeric: true, options: orgOptions(departments), derive: () => ({ group_id: 0 }) },
    { key: 'group_id', label: '所属分组', numeric: true, options: orgOptions(groups) },
    ...textFields([['title', '岗位'], ['phone', '联系电话']]), { key: 'status', label: '在职状态', options: ['在职', '离职', '调休'] }, { key: 'remark', label: '备注', type: 'textarea' },
  ]
  const refresh = () => { query.reload(); directoryChanged() }
  const peopleByNode = useMemo(() => {
    const counts = new Map()
    ;(directory.data?.people || []).forEach((person) => {
      const term = search.trim().toLowerCase()
      if (status && person.status !== status) return
      if (term && ![person.name, person.person_code, person.phone, person.email].some((value) => String(value || '').toLowerCase().includes(term))) return
      ;[person.org_id, person.department_id, person.group_id].filter(Boolean).forEach((id) => counts.set(Number(id), (counts.get(Number(id)) || 0) + 1))
    })
    return counts
  }, [directory.data?.people, search, status])
  const nav = (nodes, path = []) => nodes.map((node) => {
    const branch = [...path, node]
    const params = { node_id: node.id, node_type: node.node_type }
    const selected = JSON.stringify(selection) === JSON.stringify(params)
    const collapsed = !orgKeyword && collapsedNodes.has(node.id)
    return <div key={node.id} onDragOver={(event) => event.preventDefault()} onDrop={async (event) => { event.preventDefault(); if (!dragPerson) return; await action.run(async () => { await api.updatePerson(dragPerson.id, { ...dragPerson, org_id: Number(branch[0]?.id) || 0, department_id: Number(branch[1]?.id) || 0, group_id: Number(branch[2]?.id) || 0, org_name: branch[0]?.name || '', department: branch[1]?.name || '', group_name: branch[2]?.name || '' }); setDragPerson(null); refresh() }, '已调整人员归属') }}><div className="flex items-center"><button type="button" aria-label={collapsed ? `展开${node.name}` : `收起${node.name}`} className="grid h-8 w-6 shrink-0 place-items-center text-muted-foreground" style={{ marginLeft: path.length * 16 }} onClick={() => setCollapsedNodes((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })}><ChevronDown size={13} className={collapsed ? '-rotate-90' : ''} /></button><Button variant={selected ? 'secondary' : 'ghost'} className="h-[32px] min-w-0 flex-1 justify-start truncate px-1 text-[12px] font-normal" onClick={() => { setSelectedOrgId(node.id); setSelection(params); setPage(1) }}><Folder size={14} className="mr-2 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-left">{node.name}</span><span className="ml-2 text-[11px] tabular-nums text-muted-foreground">{peopleByNode.get(node.id) || 0}</span></Button></div>{collapsed ? null : nav(node.children || [], branch)}</div>
  })
  const exportPeople = () => {
    const rows = directory.data?.people || []
    const headers = ['人员编号', '姓名', '组织', '部门', '分组', '岗位', '联系电话', '状态', '资产数']
    const values = rows.map((row) => [row.person_code, row.name, row.org_name, row.department, row.group_name, row.title, row.phone, row.status, row.asset_count])
    const csv = '\ufeff' + [headers, ...values].map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '组织架构人员.csv'; anchor.click(); URL.revokeObjectURL(url)
  }
  const importPeople = async (event) => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    const text = await file.text()
    const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean)
    const rows = lines.slice(1).map((line) => line.split(',').map((value) => value.replace(/^"|"$/g, '').replaceAll('""', '"')))
    await action.run(async () => { for (const row of rows) { if (!row[1]) continue; await api.createPerson({ person_code: row[0], name: row[1], org_name: row[2], department: row[3], group_name: row[4], title: row[5], phone: row[6], status: row[7] || '在职' }) }; refresh() }, `已导入 ${rows.length} 条人员`)
  }
  return <div data-people-directory className="flex h-full min-h-0 flex-col">
    <VaultPageHeader dataSection="cmdb-people-header" contentClassName="h-auto min-h-14 flex-wrap">
      <Dropdown open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
          <DropdownTrigger asChild>
            <Button data-people-add type="button" className="h-10 shrink-0 gap-2 px-4" aria-haspopup="menu" aria-expanded={createMenuOpen}><Plus size={15} />新增人员<ChevronDown size={13} className="ml-1 opacity-70" /></Button>
          </DropdownTrigger>
          <DropdownContent align="start" sideOffset={8} className="w-44 p-1">
            {peopleCreateMenuItems().map((item) => <button key={item.key} data-people-create-menu-item={item.key} type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary" onClick={() => { setCreateMenuOpen(false); if (item.key === 'create-person') open(); else setOrganizations(true) }}>{item.key === 'create-person' ? <Plus size={14} /> : <Settings2 size={14} />}{item.label}</button>)}
          </DropdownContent>
      </Dropdown>
      <VaultHeaderSearch data-people-search className="min-w-[180px] max-w-[520px] flex-1" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setSearch(keyword.trim()); setPage(1) } }} placeholder="搜索姓名、人员编号、职务或联系电话" rightAdornment={keyword ? <button type="button" aria-label="清除人员搜索" className="grid h-6 w-6 place-items-center rounded hover:bg-foreground/10" onClick={() => { setKeyword(''); setSearch(''); setPage(1) }}><X size={13} /></button> : null} />
      <span className="min-w-0 flex-1" />
      <Popover><PopoverTrigger asChild><Button data-people-filter type="button" variant="ghost" size="icon" className={vaultHeaderIconButtonClass} aria-label="选择筛选项" title="选择筛选项"><Filter size={16} /></Button></PopoverTrigger><PopoverContent align="end" sideOffset={8} className="w-56 p-3"><div className="mb-2 text-xs font-medium">人员筛选</div><SelectControl aria-label="人员状态" value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={choices(['在职', '离职', '调休'], '全部状态')} className="w-full" /></PopoverContent></Popover>
      <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={importPeople} />
      <Dropdown><DropdownTrigger asChild><Button data-people-transfer type="button" variant="ghost" size="icon" className={vaultHeaderIconButtonClass} aria-label="导入/导出" title="导入/导出"><ArrowDownUp size={16} /></Button></DropdownTrigger><DropdownContent align="end" sideOffset={8} className="w-44 p-1"><button type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary" onClick={() => fileInput.current?.click()}><Upload size={14} />导入人员</button><button type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary" onClick={exportPeople}><Download size={14} />导出当前列表</button></DropdownContent></Dropdown>
    </VaultPageHeader>
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border/60 bg-background lg:w-60"><div className="flex h-12 items-center px-3"><strong className="text-xs font-semibold">组织节点</strong></div><div className="border-y border-border/40 p-2.5"><SearchBox value={orgKeyword} onChange={setOrgKeyword} placeholder="搜索组织节点" className="min-w-0 max-w-none" /></div><div className="min-h-0 flex-1 overflow-auto p-2"><Button variant={Object.keys(selection).length ? 'ghost' : 'secondary'} className="h-[32px] w-full justify-start px-2 text-[12px] font-normal" onClick={() => { setSelectedOrgId(0); setSelection({}); setPage(1) }}>全部人员</Button>{nav(visibleTree)}</div><div className="flex h-10 items-center justify-between border-t border-border/40 px-2"><Button variant="ghost" size="sm" className="px-2 text-[11px]" onClick={() => setCollapsedNodes(new Set())}>全部展开</Button><Button variant="ghost" size="sm" className="px-2 text-[11px]" onClick={() => setCollapsedNodes(new Set((function flatten(nodes) { return nodes.flatMap((node) => [node.id, ...flatten(node.children || [])]) })(tree)))}>全部收起</Button></div></aside>
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-[48px] shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2"><div className="mr-2 min-w-40"><strong className="text-sm">{selectedOrgName || '全部人员'}</strong><p className="mt-0.5 text-[11px] text-muted-foreground">{query.data?.total || 0} 人</p></div><span className="flex-1" /><span className="text-[11px] text-muted-foreground">可在顶部筛选状态</span></div>
      {(query.error || directory.error) && <ErrorBanner message={query.error || directory.error} onRetry={() => { query.reload(); directory.reload() }} />}
      <DataTable compact rows={query.error ? [] : query.data?.list || []} loading={query.loading} columns={[
        { key: 'name', label: '人员', render: (v, row) => <div draggable onDragStart={() => setDragPerson(row)} className="flex items-center gap-2"><GripVertical size={14} className="cursor-grab text-muted-foreground" /><span className="grid h-7 w-7 place-items-center rounded-full bg-secondary text-[11px] font-medium">{String(v || '?').slice(0, 1)}</span><Button variant="link" className="h-auto p-0 text-[12px]" onClick={() => setDetail(row)}>{v}</Button></div> }, { key: 'department', label: '主要归属', render: (v, row) => <span>{v || row.org_name || '-'}</span> }, { key: 'title', label: '职务/岗位', headerClassName: 'hidden xl:table-cell', className: 'hidden xl:table-cell' }, { key: 'phone', label: '联系电话', headerClassName: 'hidden xl:table-cell', className: 'hidden xl:table-cell' }, { key: 'asset_count', label: '资源数', className: 'font-mono tabular-nums', render: (v, row) => <Button variant="link" className="h-auto p-0 font-mono text-[12px] tabular-nums" onClick={() => setDetail(row)}>{v || 0}</Button> }, { key: 'status', label: '状态', render: (v) => <StatusPill tone={v === '在职' ? 'success' : 'neutral'}>{v}</StatusPill> },
        { key: 'actions', label: '操作', render: (_, row) => <div className="flex"><ActionIcon label="编辑人员" onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除人员" danger onClick={() => setDeleting(row)}><Trash2 size={15} /></ActionIcon></div> },
      ]} /><Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
      </div>
    </div>
    {organizations && <Organizations open={organizations} onOpenChange={setOrganizations} onChanged={refresh} people={directory.data?.people || []} peopleLoading={directory.loading} peopleError={directory.error} />}
    <DetailSheet open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }} title="人员与名下资产">{detail && <PersonAssets person={detail} people={directory.data?.people || []} onTransferred={refresh} onNavigate={(target) => { setDetail(null); onNavigate(target) }} />}</DetailSheet>
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={editor?.id ? '编辑人员' : '新增人员'} busy={action.busy} onSubmit={() => action.run(async () => { validateFields(fields, values); const body = { ...values, org_name: '', department: '', group_name: '' }; if (editor.id) await api.updatePerson(editor.id, body); else await api.createPerson(body); setEditor(null); refresh() }, '已保存人员')}><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="删除人员" message={`确认删除“${deleting?.name}”？请先交接名下资产。`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deletePerson(deleting.id); setDeleting(null); refresh() }, '已删除人员')} />
  </div>
}
