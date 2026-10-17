import React, { useEffect, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Fields, validateFields } from './Fields'
import { directoryChanged, useAction, useDirectory } from './hooks'
import { EmptyState, ErrorBanner } from './ui'

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
  const persist = () => action.run(async () => {
    validateFields(fields, draft)
    const result = await save(draft, draft)
    setDraft({ ...draft, ...(result || {}), id: result?.id || draft.id })
    directoryChanged()
    onChanged?.()
  }, '目录已保存')
  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!action.busy) onOpenChange(next) }}>
      <DialogContent className="flex h-[min(640px,calc(100vh-40px))] w-[min(880px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b px-5 py-4"><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,35%)_minmax(0,1fr)] max-[640px]:grid-cols-1">
          <section className="flex min-h-0 flex-col border-r max-[640px]:max-h-48 max-[640px]:border-b">
            <div className="space-y-2 border-b p-3"><div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" /><Input aria-label={`搜索${title}`} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={`搜索${title}`} className="h-8 pl-8 text-xs" /></div><Button type="button" variant="outline" size="sm" disabled={action.busy} onClick={() => setDraft({ ...defaults })}><Plus size={13} className="mr-1" />新增{title}</Button></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">{query.loading ? <p className="p-3 text-xs text-muted-foreground">正在读取目录…</p> : rows.length ? rows.map((row) => <button key={row.id} type="button" disabled={action.busy} aria-pressed={draft?.id === row.id} onClick={() => setDraft({ ...row })} className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-accent ${draft?.id === row.id ? 'bg-accent' : ''}`}><span className="min-w-0 flex-1"><span className="block truncate font-medium">{row.name || row.model}</span><span className="mt-1 block truncate text-muted-foreground">{row.vendor || row.remark}</span></span>{row.sort_order != null && <span className="text-muted-foreground">{row.sort_order}</span>}</button>) : <EmptyState label="没有匹配的目录项" />}</div>
          </section>
          <section className="min-h-0 overflow-y-auto p-5">{draft ? <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void persist() }}><div><h3 className="text-sm font-semibold">{draft.id ? '编辑' : '新增'}{title}</h3><p className="mt-1 text-xs text-muted-foreground">保存后立即用于当前项目的筛选与资产表单。</p></div><Fields fields={fields} value={draft} onChange={setDraft} /><div className="flex justify-between border-t pt-4"><Button type="button" variant="ghost" size="sm" disabled={!draft.id || action.busy} className="text-destructive" onClick={() => setDeleting(true)}><Trash2 size={14} className="mr-1" />删除</Button><Button type="submit" size="sm" disabled={action.busy}>{action.busy ? '保存中…' : '保存'}</Button></div></form> : <EmptyState label="选择目录项或新增" />}</section>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`删除${title}`} message={`确认删除“${draft?.name || draft?.model || title}”？已被引用的目录项由服务端校验。`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await remove(draft); setDeleting(false); await query.reload(); setDraft(null); directoryChanged(); onChanged?.() }, '目录已删除')} />
  </>
}
