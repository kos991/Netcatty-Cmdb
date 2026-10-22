import React, { useEffect, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Fields, validateFields } from './Fields'
import { directoryChanged, useAction, useDirectory } from './hooks'
import { EmptyState, ErrorBanner } from './ui'
import { networkTypeColor } from './assetTableModel'
import './settings.css'

export default function SettingsCatalogEditor({ open, onOpenChange, title, load, save, remove, fields, defaults, onChanged }) {
  const query = useDirectory(load)
  const action = useAction()
  const [keyword, setKeyword] = useState('')
  const [draft, setDraft] = useState(null)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    if (query.data && !draft) setDraft({ ...(query.data[0] || defaults) })
  }, [query.data, draft, defaults])
  const rows = (query.data || []).filter((row) => fields.some((field) => String(row[field.key] ?? '').toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())))
  // 左侧色标读取已保存的目录数据；保存/删除后目录重新加载，色标随之更新，未保存的草稿颜色不提前显示。
  const showsColor = fields.some((field) => field.key === 'color')
  const persist = () => action.run(async () => {
    validateFields(fields, draft)
    const result = await save(draft, draft)
    setDraft({ ...draft, ...(result || {}), id: result?.id || draft.id })
    directoryChanged()
    onChanged?.()
  }, '目录已保存')
  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cmdb-theme-scope cmdb-record-shell cmdb-settings-dialog flex h-[min(640px,calc(100vh-40px))] w-[min(880px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="cmdb-record-header"><div className="min-w-0 pr-6"><DialogTitle>{title}</DialogTitle><p className="cmdb-settings-dialog-note">维护当前项目的{title}；保存后立即同步筛选与录入选项。</p></div></DialogHeader>
        {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
        <div className="cmdb-settings-catalog-layout">
          <section className="cmdb-settings-catalog-directory" aria-label={`${title}目录`}>
            <div className="cmdb-settings-catalog-tools">
              <div className="cmdb-settings-catalog-search"><Search size={14} className="shrink-0" /><Input aria-label={`搜索${title}`} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={`搜索${title}`} className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0" /></div>
              <Button className="cmdb-primary-action" type="button" disabled={action.busy} onClick={() => setDraft({ ...defaults })}><Plus size={14} />新增{title}</Button>
            </div>
            <div className="cmdb-settings-catalog-entries">{query.loading && !query.data ? <p className="cmdb-settings-catalog-empty">正在读取目录…</p> : rows.length ? rows.map((row) => <button key={row.id} type="button" disabled={action.busy} aria-pressed={draft?.id === row.id} onClick={() => setDraft({ ...row })} className={`cmdb-settings-catalog-entry${showsColor ? ' has-color' : ''}`}>{showsColor ? <span className="cmdb-settings-catalog-entry-color" data-catalog-color={row.color || ''} style={{ backgroundColor: networkTypeColor(row.name, [row]) }} title={row.color ? `颜色 ${row.color}` : '未设置颜色，使用默认灰'} aria-label={row.color ? `颜色 ${row.color}` : '未设置颜色'} /> : null}<span className="cmdb-settings-catalog-entry-name">{row.name || row.model}</span><span className="cmdb-settings-catalog-entry-detail">{row.vendor || row.remark}</span>{row.sort_order != null && <span className="cmdb-settings-catalog-entry-sort">{row.sort_order}</span>}</button>) : <EmptyState label="没有匹配的目录项" />}</div>
          </section>
          <section className="cmdb-settings-catalog-editor" aria-label={`${title}编辑`}>{draft ? <form id="cmdb-settings-catalog-form" className="space-y-4" onSubmit={(event) => { event.preventDefault(); void persist() }}><div><h3 className="text-sm font-semibold">{draft.id ? '编辑' : '新增'}{title}</h3><p className="mt-1 text-xs text-muted-foreground">保存后立即用于当前项目的筛选与资产表单。</p></div><Fields fields={fields} value={draft} onChange={setDraft} className="sm:grid-cols-1" /></form> : <EmptyState label="选择目录项或新增" />}</section>
        </div>
        <div className="cmdb-record-footer"><Button type="button" variant="ghost" size="sm" disabled={!draft?.id || action.busy} className="mr-auto text-destructive" onClick={() => setDeleting(true)}><Trash2 size={14} className="mr-1" />删除</Button><Button type="button" variant="outline" disabled={action.busy} onClick={() => onOpenChange(false)}>关闭</Button><Button className="cmdb-primary-action" type="submit" form="cmdb-settings-catalog-form" disabled={!draft || action.busy}>{action.busy ? '保存中…' : '保存'}</Button></div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`删除${title}`} message={`确认删除“${draft?.name || draft?.model || title}”？已被引用的目录项由服务端校验。`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await remove(draft); setDeleting(false); await query.reload(); setDraft(null); directoryChanged(); onChanged?.() }, '目录已删除')} />
  </>
}
