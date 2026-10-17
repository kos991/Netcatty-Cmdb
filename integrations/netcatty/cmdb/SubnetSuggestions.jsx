import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from './api'
import { useQuery } from './hooks'
import { ErrorBanner, SelectControl } from './ui'

const SKIP = ''

// 资产 IP 中尚未被网段覆盖的 /24 段：逐段选择网络类别后批量建网段；不选类别的段跳过。
// 网络类别必须由人确认，不按 IP 前缀猜测。
export default function SubnetSuggestions({ open, onOpenChange, networkTypes = [], onCreated }) {
  const load = useCallback(() => api.subnetSuggestions(), [])
  const query = useQuery(load)
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const list = query.data?.list || []
  useEffect(() => {
    setDrafts(Object.fromEntries(list.map((item) => [item.cidr, { name: item.cidr, category: SKIP }])))
  }, [query.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = list.filter((item) => drafts[item.cidr]?.category)
  const categories = [{ value: SKIP, label: '跳过' }, ...networkTypes.map((name) => ({ value: name, label: name }))]
  const update = (cidr, changes) => setDrafts((current) => ({ ...current, [cidr]: { ...current[cidr], ...changes } }))
  const save = async () => {
    setBusy(true); setError('')
    const created = []
    try {
      for (const item of chosen) {
        const draft = drafts[item.cidr]
        await api.createSubnet({ name: String(draft.name || item.cidr).trim(), category: draft.category, cidr: item.cidr, prefix: item.prefix })
        created.push(item.cidr)
      }
      onCreated?.(created)
      onOpenChange(false)
    } catch (saveError) {
      setError(`${created.length ? `已创建 ${created.length} 个网段；` : ''}${saveError.message}`)
      if (created.length) { onCreated?.(created); query.reload() }
    } finally {
      setBusy(false)
    }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-3xl" data-section="ipam-subnet-suggestions">
      <DialogHeader><DialogTitle>从资产 IP 生成网段</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">下列 /24 段有资产在用，但还没有登记网段，所以资产的网络类型显示“未配置”。选择网络类型后保存即可自动归属；保持“跳过”的不创建。</p>
      {query.error ? <ErrorBanner message={query.error} onRetry={query.reload} /> : null}
      {!query.data ? <p className="text-xs text-muted-foreground">正在汇总资产 IP…</p> : !list.length ? <p className="py-6 text-center text-xs text-muted-foreground">所有资产 IP 都已被网段覆盖</p> : <div className="max-h-[420px] overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted/80 text-muted-foreground"><tr><th className="px-3 py-2 text-left font-normal">网段</th><th className="px-3 py-2 text-left font-normal">资产 IP</th><th className="px-3 py-2 text-left font-normal">来源</th><th className="px-3 py-2 text-left font-normal">网段名称</th><th className="w-28 px-3 py-2 text-left font-normal">网络类型</th></tr></thead>
          <tbody className="divide-y divide-border/60">{list.map((item) => <tr key={item.cidr} data-subnet-suggestion={item.cidr}>
            <td className="px-3 py-1.5 font-mono">{item.cidr}</td>
            <td className="px-3 py-1.5"><span className="tabular-nums">{item.count}</span><span className="ml-1 font-mono text-[10px] text-muted-foreground" title={item.samples.join('、')}>{item.samples[0]}{item.count > 1 ? ' …' : ''}</span></td>
            <td className="px-3 py-1.5 text-muted-foreground">{item.sources.join('、')}</td>
            <td className="px-3 py-1.5"><Input className="h-7 text-xs" value={drafts[item.cidr]?.name || ''} onChange={(event) => update(item.cidr, { name: event.target.value })} aria-label={`${item.cidr} 网段名称`} /></td>
            <td className="px-3 py-1.5"><SelectControl className="h-7 w-28" value={drafts[item.cidr]?.category || SKIP} onChange={(value) => update(item.cidr, { category: value })} options={categories} aria-label={`${item.cidr} 网络类型`} /></td>
          </tr>)}</tbody>
        </table>
      </div>}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-2"><span className="mr-auto text-[11px] text-muted-foreground">已选 {chosen.length} / {list.length} 个网段</span><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button><Button onClick={save} disabled={busy || !chosen.length}>{busy ? '创建中…' : `创建 ${chosen.length} 个网段`}</Button></div>
    </DialogContent>
  </Dialog>
}
