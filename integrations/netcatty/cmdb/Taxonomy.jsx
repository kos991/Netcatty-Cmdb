import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FolderPlus, Layers3, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { api } from './api'
import { buildTaxonomyTree, filterTaxonomyTree, taxonomyParentOptions } from './taxonomyModel'
import { EmptyState, ErrorBanner, SelectControl } from './ui'
import './settings.css'

const KINDS = [
  ['terminal-categories', '终端设备类型'],
  ['infrastructure-categories', '基础设施设备类型'],
  ['application-categories', '业务系统类型'],
]

function TaxonomyNode({ node, depth, selectedId, expanded, onToggle, onSelect }) {
  const hasChildren = Boolean(node.children?.length)
  const isExpanded = expanded.has(Number(node.id))
  return <div>
    <div className={`group flex h-8 items-center rounded-sm ${selectedId === node.id ? 'bg-[color-mix(in_srgb,var(--cmdb-accent)_12%,transparent)] text-[var(--cmdb-accent)]' : 'hover:bg-muted'}`}>
      <button type="button" aria-label={hasChildren ? `${isExpanded ? '收起' : '展开'}${node.name}` : undefined} disabled={!hasChildren} className="grid h-8 w-7 shrink-0 place-items-center text-muted-foreground disabled:opacity-30" style={{ marginLeft: depth * 14 }} onClick={() => onToggle(node.id)}>
        {hasChildren ? isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="h-3 w-3" />}
      </button>
      <button type="button" className="flex h-8 min-w-0 flex-1 items-center justify-between gap-2 pr-2 text-left text-xs" onClick={() => onSelect(node)}>
        <span className="truncate">{node.name}</span>
        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{node.asset_count || 0}</span>
      </button>
    </div>
    {hasChildren && isExpanded ? node.children.map((child) => <TaxonomyNode key={child.id} node={child} depth={depth + 1} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />) : null}
  </div>
}

export default function Taxonomy({ open, onOpenChange, onChanged, initialKind = 'terminal-categories' }) {
  const kind = initialKind
  const loaded = useRef(false)
  const [rows, setRows] = useState([])
  const [selectedId, setSelectedId] = useState(0)
  const [draft, setDraft] = useState(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const title = KINDS.find(([value]) => value === kind)?.[1] || '设备类型'

  const load = useCallback(async (preferredId = 0) => {
    setLoading(true)
    setError('')
    try {
      const response = await api.taxonomy(kind)
      const nextRows = response.list || []
      setRows(nextRows)
      loaded.current = true
      setExpanded(new Set(nextRows.map((item) => Number(item.id))))
      const nextSelected = nextRows.find((item) => item.id === preferredId) || nextRows[0] || null
      setSelectedId(nextSelected?.id || 0)
      setDraft(nextSelected ? { ...nextSelected } : null)
    } catch (loadError) {
      setError(loadError.message)
      setRows([])
      setDraft(null)
    } finally {
      setLoading(false)
    }
  }, [kind])

  useEffect(() => {
    if (open && !loaded.current) void load()
  }, [open, load])

  const tree = useMemo(() => filterTaxonomyTree(buildTaxonomyTree(rows), search), [rows, search])
  const parentOptions = useMemo(() => taxonomyParentOptions(rows, draft?.id || 0), [rows, draft?.id])
  const beginCreate = (parentId) => {
    setSelectedId(0)
    setDraft({ id: 0, name: '', parent_id: parentId || 0, sort_order: rows.length + 1, asset_count: 0 })
  }
  const selectNode = (node) => {
    setSelectedId(node.id)
    setDraft({ ...node })
  }
  const toggle = (id) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(Number(id))) next.delete(Number(id)); else next.add(Number(id))
    return next
  })
  const save = async () => {
    const name = String(draft?.name || '').trim()
    if (!name) { setError('名称不能为空'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { name, parent_id: Number(draft.parent_id || 0), sort_order: Number(draft.sort_order || 0) }
      const result = draft.id ? (await api.updateTaxonomy(kind, draft.id, payload), { id: draft.id }) : await api.createTaxonomy(kind, payload)
      if (!draft.id) {
        setSelectedId(result.id)
        setDraft((current) => ({ ...current, id: result.id }))
      }
      if (kind === 'terminal-categories') await api.setTerminalShortCode(result.id, String(draft.short_code || '').trim())
      await load(result.id)
      onChanged?.(kind)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!draft?.id) return
    setSaving(true)
    setError('')
    try {
      await api.deleteTaxonomy(kind, draft.id)
      setConfirmDelete(false)
      await load()
      onChanged?.(kind)
    } catch (deleteError) {
      setConfirmDelete(false)
      setError(deleteError.message)
    } finally {
      setSaving(false)
    }
  }

  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cmdb-theme-scope cmdb-record-shell cmdb-settings-dialog flex h-[min(680px,calc(100vh-40px))] w-[min(900px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="cmdb-record-header"><div className="min-w-0 pr-6"><DialogTitle className="flex items-center gap-2"><Layers3 size={16} className="shrink-0" />{title}</DialogTitle><p className="cmdb-settings-dialog-note">保存后立即同步到资产筛选和新增、编辑表单。</p></div></DialogHeader>
        {error ? <ErrorBanner title="操作未完成" message={error} onRetry={() => load(selectedId)} /> : null}
        <div className="cmdb-settings-catalog-layout">
          <section className="cmdb-settings-catalog-directory" aria-label={`${title}目录`}>
            <div className="cmdb-settings-catalog-tools">
              <div className="cmdb-settings-catalog-search"><Search size={14} className="shrink-0" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${title}`} className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0" /></div>
              <div className="flex min-w-0 gap-2"><Button className="cmdb-primary-action min-w-0 flex-1" type="button" onClick={() => beginCreate(0)}><Plus size={14} />新增大类</Button><Button type="button" variant="outline" className="h-[34px] min-w-0 flex-1 px-2 text-xs" disabled={!draft?.id} onClick={() => beginCreate(draft.id)}><FolderPlus size={14} className="mr-1 shrink-0" />新增子类</Button></div>
            </div>
            <div className="cmdb-settings-catalog-entries">{loading ? <div className="grid h-full place-items-center"><Spinner /></div> : tree.length ? tree.map((node) => <TaxonomyNode key={node.id} node={node} depth={0} selectedId={selectedId} expanded={search.trim() ? new Set(rows.map((row) => Number(row.id))) : expanded} onToggle={toggle} onSelect={selectNode} />) : <EmptyState label={search ? '没有匹配项' : `暂无${title}`} />}</div>
          </section>
          <section className="cmdb-settings-catalog-editor" aria-label="类型编辑">
            {draft ? <form id="cmdb-taxonomy-form" className="mx-auto max-w-lg space-y-4" onSubmit={(event) => { event.preventDefault(); void save() }}>
              <div><h3 className="text-sm font-semibold">{draft.id ? `编辑${title}` : `新增${title}`}</h3><p className="mt-1 text-xs text-muted-foreground">保存后立即同步到资产筛选和新增、编辑表单。</p></div>
              <div className="grid gap-4">
                <div className="grid gap-1.5"><Label htmlFor="taxonomy-name" className="text-xs text-muted-foreground">名称 *</Label><Input id="taxonomy-name" value={draft.name || ''} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="h-[34px] text-[13px]" autoFocus={!draft.id} /></div>
                {kind === 'terminal-categories' ? <div className="grid gap-1.5"><Label htmlFor="taxonomy-short-code" className="text-xs text-muted-foreground">设备简称</Label><Input id="taxonomy-short-code" maxLength={8} placeholder="如 VDI、PC、PRT；留空按名称推断" value={draft.short_code || ''} onChange={(event) => setDraft((current) => ({ ...current, short_code: event.target.value.toUpperCase() }))} className="h-[34px] font-mono text-[13px]" /><p className="text-[11px] text-muted-foreground">用于终端自动命名：项目名称-简称-流水号</p></div> : null}
                <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">上级</Label><SelectControl className="w-full" value={draft.parent_id || 0} onChange={(value) => setDraft((current) => ({ ...current, parent_id: Number(value || 0) }))} options={parentOptions} /></div>
                <div className="grid gap-1.5"><Label htmlFor="taxonomy-sort" className="text-xs text-muted-foreground">排序</Label><Input id="taxonomy-sort" type="number" min="0" value={draft.sort_order || 0} onChange={(event) => setDraft((current) => ({ ...current, sort_order: Number(event.target.value || 0) }))} className="h-[34px] text-[13px]" /></div>
                <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">引用资产</Label><div className="flex h-[34px] items-center rounded-md border border-border bg-muted/30 px-3 text-xs tabular-nums text-muted-foreground">{draft.asset_count || 0} 项</div></div>
              </div>
            </form> : <EmptyState label={`选择左侧${title}，或新建一项`} />}
          </section>
        </div>
        <div className="cmdb-record-footer"><Button type="button" variant="ghost" size="sm" className="mr-auto text-destructive hover:text-destructive" disabled={!draft?.id || saving} onClick={() => setConfirmDelete(true)}><Trash2 size={14} className="mr-1" />删除</Button><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>关闭</Button><Button className="cmdb-primary-action" type="submit" form="cmdb-taxonomy-form" disabled={!draft || saving}>{saving ? '保存中…' : '保存'}</Button></div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`删除${title}`} message="有子项或仍被资产引用时将拒绝删除。" confirmLabel="删除" destructive busy={saving} onConfirm={remove} />
  </>
}
