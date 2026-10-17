import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, ChevronDown, Download, Folder, GripVertical, ListFilter, Pencil, Plus, RotateCcw, Settings2, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { VaultHeaderSearch, VaultPageHeader, vaultHeaderIconButtonClass } from '@/components/vault/VaultPageHeader'
import { api } from './api'
import { allPages, directoryChanged, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { ActionIcon, DataTable, ErrorBanner, ModalForm, Pagination, SearchBox, SelectControl, StatusPill } from './ui'
import Organizations from './Organizations'
import PersonDetailPanel from './PersonDetailPanel'
import { peopleCreateMenuItems } from './peopleToolbarModel'
import { organizationPersonEditorPath } from './organizationEditorModel'

const loadDirectory = async () => { const [tree, people] = await Promise.all([api.orgTree(), allPages(api.persons)]); return { tree: tree.list || [], people } }

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
  const [detailTab, setDetailTab] = useState('profile')
  const [showStatus, setShowStatus] = useState(true)
  const [dragPerson, setDragPerson] = useState(null)
  const [orgKeyword, setOrgKeyword] = useState('')
  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set())
  const fileInput = useRef(null)
  const appliedFocus = useRef(null)
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
  useEffect(() => {
    if (!focusTarget) { appliedFocus.current = null; return }
    if (focusTarget === appliedFocus.current || focusTarget.tableKey !== 'persons' || !directory.data) return
    appliedFocus.current = focusTarget
    setDetailTab('profile')
    setDetail(directory.data.people.find((person) => Number(person.id) === Number(focusTarget.id)) || null)
  }, [focusTarget, directory.data])
  const open = (record = {}) => { setDetail(null); setEditor(record); setValues({ status: '在职', org_id: 0, department_id: 0, group_id: 0, ...record, ...(record.id ? organizationPersonEditorPath(record, tree) : {}) }) }
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
      ;[
        ['organization', person.org_id],
        ['department', person.department_id],
        ['group', person.group_id],
      ].forEach(([nodeType, id]) => {
        if (!id) return
        const key = `${nodeType}:${Number(id)}`
        counts.set(key, (counts.get(key) || 0) + 1)
      })
    })
    return counts
  }, [directory.data?.people, search, status])
  const nav = (nodes, path = []) => nodes.map((node) => {
    const branch = [...path, node]
    const params = { node_id: node.id, node_type: node.node_type }
    const selected = JSON.stringify(selection) === JSON.stringify(params)
    const collapsed = !orgKeyword && collapsedNodes.has(node.id)
    const count = peopleByNode.get(`${node.node_type}:${Number(node.id)}`) || 0
    return <div key={node.id} onDragOver={(event) => event.preventDefault()} onDrop={async (event) => { event.preventDefault(); if (!dragPerson) return; await action.run(async () => { await api.updatePerson(dragPerson.id, { ...dragPerson, org_id: Number(branch[0]?.id) || 0, department_id: Number(branch[1]?.id) || 0, group_id: Number(branch[2]?.id) || 0, org_name: branch[0]?.name || '', department: branch[1]?.name || '', group_name: branch[2]?.name || '' }); setDragPerson(null); refresh() }, '已调整人员归属') }}><div className="flex items-center"><button type="button" aria-label={collapsed ? `展开${node.name}` : `收起${node.name}`} className="grid h-8 w-6 shrink-0 place-items-center text-muted-foreground" style={{ marginLeft: path.length * 16 }} onClick={() => setCollapsedNodes((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })}><ChevronDown size={13} className={collapsed ? '-rotate-90' : ''} /></button><Button variant={selected ? 'secondary' : 'ghost'} className="h-[32px] min-w-0 flex-1 justify-start truncate px-1 text-[12px] font-normal" onClick={() => { setSelectedOrgId(node.id); setSelection(params); setPage(1) }}><Folder size={14} className="mr-2 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-left">{node.name}</span><span className="ml-2 text-[11px] tabular-nums text-muted-foreground">{count}</span></Button></div>{collapsed ? null : nav(node.children || [], branch)}</div>
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
      <VaultHeaderSearch data-people-search className="min-w-[180px] max-w-[520px] flex-1" value={keyword} onChange={(event) => { setKeyword(event.target.value); setSearch(event.target.value.trim()); setPage(1) }} onKeyDown={(event) => { if (event.key === 'Enter') { setSearch(keyword.trim()); setPage(1) } }} placeholder="搜索姓名、人员编号、职务或联系电话" rightAdornment={keyword ? <button type="button" aria-label="清除人员搜索" className="grid h-6 w-6 place-items-center rounded hover:bg-foreground/10" onClick={() => { setKeyword(''); setSearch(''); setPage(1) }}><X size={13} /></button> : null} />
      <span className="min-w-0 flex-1" />
      {showStatus ? <div id="people-status-filter" className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground">状态</span><SelectControl aria-label="人员状态" value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={choices(['在职', '调休', '离职'], '全部状态')} className="w-28" /></div> : null}
      <Button data-people-filter type="button" variant="ghost" size="icon" className={vaultHeaderIconButtonClass} aria-label="查询人员" title="查询人员" aria-controls="people-status-filter" aria-expanded={showStatus} onClick={() => setShowStatus((current) => !current)}><ListFilter size={16} /></Button>
      <Button type="button" variant="ghost" size="icon" className={vaultHeaderIconButtonClass} aria-label="重置人员查询" title="重置人员查询" onClick={() => { setKeyword(''); setSearch(''); setStatus(''); setOrgKeyword(''); setSelectedOrgId(0); setSelection({}); setCollapsedNodes(new Set()); setPage(1) }}><RotateCcw size={16} /></Button>
      <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={importPeople} />
      <Dropdown><DropdownTrigger asChild><Button data-people-transfer type="button" variant="ghost" size="icon" className={vaultHeaderIconButtonClass} aria-label="导入/导出" title="导入/导出"><ArrowDownUp size={16} /></Button></DropdownTrigger><DropdownContent align="end" sideOffset={8} className="w-44 p-1"><button type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary" onClick={() => fileInput.current?.click()}><Upload size={14} />导入人员</button><button type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary" onClick={exportPeople}><Download size={14} />导出当前列表</button></DropdownContent></Dropdown>
    </VaultPageHeader>
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border/60 bg-background lg:w-60"><div className="flex h-12 items-center px-3"><strong className="text-xs font-semibold">组织节点</strong></div><div className="border-y border-border/40 p-2.5"><SearchBox value={orgKeyword} onChange={setOrgKeyword} placeholder="搜索组织节点" className="min-w-0 max-w-none" /></div><div className="min-h-0 flex-1 overflow-auto p-2"><Button variant={Object.keys(selection).length ? 'ghost' : 'secondary'} className="h-[32px] w-full justify-start px-2 text-[12px] font-normal" onClick={() => { setSelectedOrgId(0); setSelection({}); setPage(1) }}>全部人员</Button>{nav(visibleTree)}</div><div className="flex h-10 items-center justify-between border-t border-border/40 px-2"><Button variant="ghost" size="sm" className="px-2 text-[11px]" onClick={() => setCollapsedNodes(new Set())}>全部展开</Button><Button variant="ghost" size="sm" className="px-2 text-[11px]" onClick={() => setCollapsedNodes(new Set((function flatten(nodes) { return nodes.flatMap((node) => [node.id, ...flatten(node.children || [])]) })(tree)))}>全部收起</Button></div></aside>
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-[64px] shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-4 py-3"><div className="mr-2 min-w-40"><strong className="text-[13px]">{selectedOrgName || '全部人员'}</strong><p className="mt-1 text-[11px] text-muted-foreground">点击姓名查看详情 · 拖动人员调整归属</p></div><span className="flex-1" /><span className="rounded-md bg-secondary px-2 py-1 text-[11px] tabular-nums text-muted-foreground">{query.data?.total || 0} 人</span></div>
      {(query.error || directory.error) && <ErrorBanner message={query.error || directory.error} onRetry={() => { query.reload(); directory.reload() }} />}
      <DataTable rows={query.error ? [] : query.data?.list || []} loading={query.loading} columns={[
        { key: 'name', label: '姓名', width: 132, sticky: 'left', render: (value, row) => <div draggable onDragStart={() => setDragPerson(row)} onDragEnd={() => setDragPerson(null)} className="flex min-w-0 items-center gap-1.5"><GripVertical size={13} className="shrink-0 cursor-grab text-muted-foreground" /><div className="min-w-0"><Button variant="link" className="block h-auto max-w-full truncate p-0 text-left text-xs" onClick={() => { setDetailTab('profile'); setDetail(row) }}>{value}</Button><button type="button" className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground hover:text-primary" aria-label={`查看${value}名下${row.asset_count || 0}项资产`} onClick={() => { setDetailTab('assets'); setDetail(row) }}>{row.asset_count || 0} 项资产</button></div></div> },
        { key: 'person_code', label: '工号', width: 112 },
        { key: 'org_name', label: '组织', width: 154 },
        { key: 'department', label: '部门', width: 120 },
        { key: 'group_name', label: '分组', width: 114 },
        { key: 'title', label: '岗位', width: 130 },
        { key: 'phone', label: '电话', width: 122 },
        { key: 'status', label: '状态', width: 74, sticky: 'right', render: (value) => <StatusPill tone={value === '在职' ? 'success' : value === '调休' ? 'warning' : 'neutral'}>{value}</StatusPill> },
        { key: 'actions', label: '操作', width: 76, sticky: 'right', render: (_, row) => <div className="flex"><ActionIcon label="编辑人员" onClick={() => open(row)}><Pencil size={15} /></ActionIcon><ActionIcon label="删除人员" danger onClick={() => setDeleting(row)}><Trash2 size={15} /></ActionIcon></div> },
      ]} /><Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
      </div>
    </div>
    {organizations && <Organizations open={organizations} onOpenChange={setOrganizations} onChanged={refresh} people={directory.data?.people || []} peopleLoading={directory.loading} peopleError={directory.error} />}
    {detail && <PersonDetailPanel key={detail.id} person={detail} initialTab={detailTab} people={directory.data?.people || []} peopleLoading={directory.loading} peopleError={directory.error} onRetryPeople={directory.reload} onClose={() => setDetail(null)} onEdit={open} onDelete={setDeleting} onTransferred={refresh} onNavigate={(target) => { setDetail(null); onNavigate(target) }} />}
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={editor?.id ? '编辑人员' : '新增人员'} busy={action.busy} onSubmit={() => action.run(async () => { validateFields(fields, values); const body = { ...values, org_name: '', department: '', group_name: '' }; if (editor.id) await api.updatePerson(editor.id, body); else await api.createPerson(body); setEditor(null); refresh() }, '已保存人员')}><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="删除人员" message={`确认删除“${deleting?.name}”？请先交接名下资产。`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deletePerson(deleting.id); if (detail?.id === deleting.id) setDetail(null); setDeleting(null); refresh() }, '已删除人员')} />
  </div>
}
