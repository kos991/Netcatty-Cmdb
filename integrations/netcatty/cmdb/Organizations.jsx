import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderPlus, Plus, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { api } from './api'
import { useAction, useQuery } from './hooks'
import { flattenOrgTree } from './state'
import { filterTaxonomyTree } from './taxonomyModel'
import { EmptyState, ErrorBanner, SearchBox, SelectControl } from './ui'
import { ORG_TYPES, organizationEditorPayload, organizationParentOptions, organizationPersonCount } from './organizationEditorModel'

export { ORG_TYPES } from './organizationEditorModel'

function OrganizationNode({ node, depth = 0, selectedId, collapsed, searching, disabled, onToggle, onSelect }) {
  const hasChildren = Boolean(node.children?.length)
  const expanded = searching || !collapsed.has(node.id)
  const selected = node.id === selectedId
  return <div>
    <div className={`flex h-8 items-center rounded-sm ${selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/60'}`}>
      <button type="button" aria-label={`${expanded ? '收起' : '展开'}${node.name}`} aria-expanded={hasChildren ? expanded : undefined} disabled={disabled || !hasChildren} className="grid h-8 w-7 shrink-0 place-items-center disabled:opacity-30" style={{ marginLeft: depth * 14 }} onClick={() => onToggle(node.id)}>
        {hasChildren ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
      </button>
      <button type="button" aria-pressed={selected} disabled={disabled} className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-2 text-left text-xs" onClick={() => onSelect(node)}>
        <span className="min-w-0 flex-1 truncate" title={node.name}>{node.name}</span>
        <span className={`shrink-0 text-[11px] ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{ORG_TYPES[node.node_type]}</span>
      </button>
    </div>
    {hasChildren && expanded ? node.children.map((child) => <OrganizationNode key={child.id} {...{ selectedId, collapsed, searching, disabled, onToggle, onSelect }} node={child} depth={depth + 1} />) : null}
  </div>
}

export default function Organizations({ open, onOpenChange, onChanged, people = [], peopleLoading = false, peopleError = '' }) {
  const load = useCallback(async () => {
    const tree = (await api.orgTree()).list || []
    return { tree, rows: flattenOrgTree(tree) }
  }, [])
  const query = useQuery(load)
  const action = useAction()
  const [draft, setDraft] = useState(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const rows = query.data?.rows || []
  useEffect(() => {
    if (query.data) setDraft((current) => ({ ...(query.data.rows.find((row) => row.id === current?.id) || query.data.rows[0]) }))
  }, [query.data])
  const tree = useMemo(() => filterTaxonomyTree(query.data?.tree || [], search), [query.data, search])
  const disabled = action.busy || query.loading || Boolean(query.error)
  const childType = draft?.node_type === 'organization' ? 'department' : draft?.node_type === 'department' ? 'group' : null
  const beginCreate = (nodeType, parentId = 0) => { setError(''); setDraft({ id: 0, name: '', node_type: nodeType, parent_id: parentId, sort_order: 0 }) }
  const change = (field, value) => { setError(''); setDraft((current) => ({ ...current, [field]: value })) }
  const save = () => action.run(async () => {
    setError('')
    try {
      const body = organizationEditorPayload(draft, rows)
      const result = draft.id ? (await api.updateConfig('org-nodes', draft.id, body), { id: draft.id }) : await api.createConfig('org-nodes', body)
      setDraft({ ...body, id: result.id })
      await query.reload()
      onChanged?.()
    } catch (saveError) { setError(saveError.message); throw saveError }
  }, '组织节点已保存')
  const remove = () => action.run(async () => {
    setError('')
    try {
      await api.deleteConfig('org-nodes', draft.id)
      setConfirmDelete(false)
      setDraft(null)
      await query.reload()
      onChanged?.()
    } catch (deleteError) { setConfirmDelete(false); setError(deleteError.message); throw deleteError }
  }, '组织节点已删除')

  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!action.busy) onOpenChange?.(next) }}>
      <DialogContent data-organization-maintenance className="flex h-[min(680px,calc(100vh-40px))] w-[min(900px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><DialogTitle className="flex items-center gap-2 text-sm tracking-normal"><Users size={16} />组织架构维护</DialogTitle></DialogHeader>
        {error || query.error ? <ErrorBanner title="操作未完成" message={error || query.error} onRetry={query.error ? query.reload : undefined} /> : null}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,32%)_minmax(0,1fr)] max-[640px]:grid-cols-1 max-[640px]:grid-rows-[minmax(140px,35%)_minmax(0,1fr)]">
          <section aria-label="组织架构目录" className="flex min-h-0 flex-col border-r border-border max-[640px]:border-b max-[640px]:border-r-0">
            <div className="shrink-0 border-b border-border/70 p-3"><SearchBox value={search} onChange={setSearch} placeholder="搜索组织、部门或分组" className="min-w-0 max-w-none" /></div>
            <div className="flex shrink-0 gap-2 border-b border-border/70 px-3 py-2">
              <Button type="button" variant="outline" size="sm" className="h-8 flex-1 gap-1 text-xs" disabled={disabled} onClick={() => beginCreate('organization')}><Plus size={13} />新增组织</Button>
              <Button type="button" variant="outline" size="sm" className="h-8 flex-1 gap-1 text-xs" disabled={disabled || !draft?.id || !childType} onClick={() => beginCreate(childType, draft.id)}><FolderPlus size={13} />{childType ? `新增${ORG_TYPES[childType]}` : '新增下级'}</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {query.loading ? <div className="grid h-full place-items-center"><Spinner /></div> : query.error ? null : tree.length ? tree.map((node) => <OrganizationNode key={node.id} node={node} selectedId={draft?.id} collapsed={collapsed} searching={Boolean(search.trim())} disabled={action.busy} onSelect={(node) => { setError(''); setDraft({ ...node }) }} onToggle={(id) => setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })} />) : <EmptyState label={search ? '没有匹配的组织节点' : '暂无组织节点'} />}
            </div>
          </section>
          <section aria-label="组织节点编辑" className="min-h-0 overflow-y-auto p-5">
            {draft?.node_type ? <form className="mx-auto max-w-lg space-y-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
              <h3 className="text-sm font-semibold">{draft.id ? '编辑' : '新增'}{ORG_TYPES[draft.node_type]}</h3>
              <fieldset disabled={disabled} className="grid min-w-0 gap-4">
                <div className="grid gap-1.5"><Label htmlFor="organization-name" className="text-xs text-muted-foreground">名称 *</Label><Input id="organization-name" required value={draft.name || ''} onChange={(event) => change('name', event.target.value)} className="h-9 text-xs" /></div>
                <div className="grid gap-1.5"><Label htmlFor="organization-type" className="text-xs text-muted-foreground">节点类型</Label><SelectControl id="organization-type" aria-label="节点类型" className="w-full" disabled={disabled || Boolean(draft.id)} value={draft.node_type} onChange={(value) => setDraft((current) => ({ ...current, node_type: value, parent_id: 0 }))} options={Object.entries(ORG_TYPES).map(([value, label]) => ({ value, label }))} /></div>
                <div className="grid gap-1.5"><Label htmlFor="organization-parent" className="text-xs text-muted-foreground">上级节点</Label><SelectControl id="organization-parent" aria-label="上级节点" className="w-full" disabled={disabled || draft.node_type === 'organization'} value={draft.parent_id || 0} onChange={(value) => change('parent_id', Number(value))} options={organizationParentOptions(rows, draft.node_type)} /></div>
                <div className="grid gap-1.5"><Label htmlFor="organization-sort" className="text-xs text-muted-foreground">排序</Label><Input id="organization-sort" type="number" min="0" step="1" value={draft.sort_order ?? 0} onChange={(event) => change('sort_order', event.target.value)} className="h-9 text-xs" /></div>
                <div className="grid gap-1.5"><Label htmlFor="organization-person-count" className="text-xs text-muted-foreground">引用人员</Label><Input id="organization-person-count" readOnly value={peopleError ? '加载失败' : peopleLoading ? '加载中' : `${organizationPersonCount(draft, people)} 人`} className="h-9 bg-muted/30 text-xs tabular-nums text-muted-foreground" /></div>
              </fieldset>
              <div className="flex items-center justify-between border-t border-border pt-4">
                <Button type="button" variant="ghost" size="sm" className="gap-1 text-destructive hover:text-destructive" disabled={disabled || !draft.id} onClick={() => setConfirmDelete(true)}><Trash2 size={14} />删除</Button>
                <Button type="submit" size="sm" disabled={disabled}>{action.busy ? <Spinner className="mr-1.5" /> : null}保存</Button>
              </div>
            </form> : <EmptyState label="选择左侧组织节点，或新增组织" />}
          </section>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除${ORG_TYPES[draft?.node_type] || '组织节点'}`} message={`确认删除“${draft?.name || ''}”？存在子节点或引用人员时不能删除。`} confirmLabel="删除" destructive busy={action.busy} onConfirm={remove} />
  </>
}
