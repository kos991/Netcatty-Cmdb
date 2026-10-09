import React, { useEffect, useState } from 'react'
import { Network, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { api } from './api'
import { choices, Fields, textFields, validateFields } from './Fields'
import { directoryChanged, useAction, useQuery } from './hooks'
import { EmptyState, ErrorBanner, SearchBox } from './ui'

const loadSubnets = async () => (await api.ipSubnets()).list || []

export default function SubnetMaintenance({ open, onOpenChange, onChanged, initialCreate = false, networkTypes = [] }) {
  const query = useQuery(loadSubnets, [])
  const action = useAction()
  const defaults = () => ({ name: '', category: networkTypes[0] || '', sort_order: 0 })
  const [draft, setDraft] = useState(() => initialCreate ? defaults() : null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    if (!query.loading && !query.error) setDraft((current) => current && !current.id ? current : { ...(query.data.find((item) => item.id === current?.id) || query.data[0]) })
  }, [query.data, query.loading, query.error])
  const fields = [
    { key: 'name', label: '网段名称', required: true },
    { key: 'category', label: '网络类型', required: true, options: choices([...new Set([...networkTypes, draft?.category].filter(Boolean))]) },
    ...textFields([['prefix', '地址前缀'], ['cidr', 'CIDR'], ['gateway', '网关'], ['vlan', 'VLAN'], ['vni', 'VXLAN VNI'], ['purpose', '用途'], ['sort_order', '排序', 'number'], ['remark', '备注', 'textarea']]),
  ]
  const disabled = action.busy || query.loading || Boolean(query.error)
  const visible = query.data.filter((item) => !search.trim() || [item.name, item.category, item.cidr, item.prefix, item.vlan, item.vni].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  const beginCreate = () => { setError(''); setDraft(defaults()) }
  const save = () => action.run(async () => {
    setError('')
    try {
      validateFields(fields, draft)
      const previousName = query.data.find((item) => item.id === draft.id)?.name || ''
      const result = draft.id ? (await api.updateSubnet(draft.id, draft), { id: draft.id }) : await api.createSubnet(draft)
      setDraft({ ...draft, id: result.id })
      setSearch('')
      await query.reload()
      directoryChanged()
      onChanged?.({ name: draft.name.trim(), previousName })
    } catch (saveError) { setError(saveError.message); throw saveError }
  }, '网段已保存')
  const remove = () => action.run(async () => {
    setError('')
    try {
      await api.deleteSubnet(draft.id)
      setConfirmDelete(false)
      setDraft(null)
      await query.reload()
      directoryChanged()
      onChanged?.({ previousName: draft.name, removed: true })
    } catch (deleteError) { setConfirmDelete(false); setError(deleteError.message); throw deleteError }
  }, '网段已删除')
  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!action.busy) onOpenChange(next) }}>
      <DialogContent data-subnet-maintenance className="flex h-[min(680px,calc(100vh-40px))] w-[min(900px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><DialogTitle className="flex items-center gap-2 text-sm tracking-normal"><Network size={16} />网段管理</DialogTitle></DialogHeader>
        {error || query.error ? <ErrorBanner title="操作未完成" message={error || query.error} onRetry={query.error ? query.reload : undefined} /> : null}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,32%)_minmax(0,1fr)] max-[640px]:grid-cols-1 max-[640px]:grid-rows-[minmax(140px,35%)_minmax(0,1fr)]">
          <section aria-label="网段目录" className="flex min-h-0 flex-col border-r border-border max-[640px]:border-b max-[640px]:border-r-0">
            <div className="shrink-0 border-b border-border/70 p-3"><SearchBox value={search} onChange={setSearch} placeholder="搜索网段、CIDR、VLAN 或 VNI" className="min-w-0 max-w-none" /></div>
            <div className="shrink-0 border-b border-border/70 px-3 py-2"><Button type="button" variant="outline" size="sm" className="h-8 w-full gap-1 text-xs" disabled={disabled} onClick={beginCreate}><Plus size={13} />新增网段</Button></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {query.loading ? <div className="grid h-full place-items-center"><Spinner /></div> : query.error ? null : visible.length ? visible.map((item) => <button type="button" key={item.id || item.name} aria-pressed={Boolean(draft?.name) && (item.id ? item.id === draft.id : item.name === draft.name)} disabled={action.busy} onClick={() => { setError(''); setDraft({ ...item }) }} className={`mb-1 flex w-full min-w-0 flex-col gap-1 rounded-sm px-3 py-2 text-left ${draft?.name && (item.id ? item.id === draft.id : item.name === draft.name) ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/60'}`}>
                <span className="w-full truncate text-xs font-medium" title={item.name}>{item.name}</span>
                <span className="w-full truncate text-[11px] opacity-70">{[item.cidr || item.prefix, item.category, item.vlan ? `VLAN ${item.vlan}` : ''].filter(Boolean).join(' · ')}</span>
              </button>) : <EmptyState label={search ? '没有匹配的网段' : '暂无网段'} />}
            </div>
          </section>
          <section aria-label="网段编辑" className="min-h-0 overflow-y-auto p-5">
            {draft && Object.hasOwn(draft, 'name') ? <form className="mx-auto max-w-lg space-y-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
              <h3 className="text-sm font-semibold">{draft.id ? '编辑网段' : '新增网段'}</h3>
              <fieldset disabled={disabled} className="min-w-0"><Fields fields={fields} value={draft} onChange={(next) => { setError(''); setDraft(next) }} /></fieldset>
              <div className="flex items-center justify-between border-t border-border pt-4">
                <Button type="button" variant="ghost" size="sm" className="gap-1 text-destructive hover:text-destructive" disabled={disabled || !draft.id} onClick={() => setConfirmDelete(true)}><Trash2 size={14} />删除</Button>
                <Button type="submit" size="sm" disabled={disabled}>{action.busy ? <Spinner className="mr-1.5" /> : null}保存</Button>
              </div>
            </form> : <EmptyState label="选择左侧网段，或新增网段" />}
          </section>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="删除网段" message={`确认删除“${draft?.name || ''}”？网段内仍有 IP 时不能删除。`} confirmLabel="删除" destructive busy={action.busy} onConfirm={remove} />
  </>
}
