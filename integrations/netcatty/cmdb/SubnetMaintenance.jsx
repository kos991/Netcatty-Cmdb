import React, { useEffect, useRef, useState } from 'react'
import { Network, Plus, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { api } from './api'
import { choices, Fields, textFields, validateFields } from './Fields'
import { directoryChanged, useAction, useQuery } from './hooks'
import { ActionIcon, EmptyState, ErrorBanner, SearchBox } from './ui'
import { initialSubnetDraft, ipv4Number, parseSegmentsFromRemark, segmentAddressCount } from './ipamLayoutModel'
import './network-address.css'

const loadSubnets = async () => (await api.ipSubnets()).list || []
const segmentDraft = () => ({ name: '', floor: '', start_ip: '', end_ip: '', count: 0, remark: '' })
const segmentCount = segmentAddressCount
const validateSegments = (rows) => {
  rows.forEach((row, index) => {
    if (!row.name?.trim()) throw new Error(`第 ${index + 1} 个分段请填写部门或名称`)
    const start = ipv4Number(row.start_ip); const end = ipv4Number(row.end_ip)
    if (start == null || end == null) throw new Error(`分段「${row.name}」请填写有效的起止 IPv4 地址`)
    if (start > end) throw new Error(`分段「${row.name}」起始 IP 不能大于结束 IP`)
    for (let earlier = 0; earlier < index; earlier++) {
      const other = rows[earlier]
      if (start <= ipv4Number(other.end_ip) && ipv4Number(other.start_ip) <= end) throw new Error(`分段「${row.name}」与「${other.name}」地址重叠`)
    }
  })
}



export default function SubnetMaintenance({ open, onOpenChange, onChanged, onDirtyChange, onBusyChange, initialCreate = false, initialSubnetID, networkTypes = [] }) {
  const query = useQuery(loadSubnets, [])
  const action = useAction()
  const initialized = useRef(false)
  const [keyword, setKeyword] = useState('')
  const [draft, setDraft] = useState(() => initialCreate ? initialSubnetDraft([], { initialCreate: true }) : null)
  const [baseline, setBaseline] = useState(() => initialCreate ? initialSubnetDraft([], { initialCreate: true }) : null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange?.(action.busy); return () => onBusyChange?.(false) }, [action.busy, onBusyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const mayDiscard = () => !action.busy && (!dirty || window.confirm('地址池修改尚未保存，是否放弃修改？'))
  const selectDraft = (item) => {
    if (!mayDiscard()) return
    const next = item ? { ...item, segments: (item.segments || []).map((segment) => ({ ...segment })) } : initialSubnetDraft([], { initialCreate: true })
    setDraft(next); setBaseline(next); setError(''); setConfirmDelete(false)
  }
  const search = keyword.trim().toLowerCase()
  const visibleSubnets = (query.data || []).filter((item) => !search || [item.name, item.category, item.cidr, item.prefix, item.vlan, item.vni].some((value) => String(value || '').toLowerCase().includes(search)))
  useEffect(() => {
    initialized.current = initialCreate
    setDraft(initialCreate ? initialSubnetDraft([], { initialCreate: true }) : null)
    setBaseline(initialCreate ? initialSubnetDraft([], { initialCreate: true }) : null)
    setError('')
    setKeyword('')
    setConfirmDelete(false)
  }, [open, initialCreate, initialSubnetID])
  useEffect(() => {
    if (!open || initialized.current || query.loading || query.error) return
    initialized.current = true
    setDraft(initialSubnetDraft(query.data, { initialSubnetID }))
    setBaseline(initialSubnetDraft(query.data, { initialSubnetID }))
    if (initialSubnetID != null && !query.data.some((item) => String(item.id) === String(initialSubnetID))) setError('所选地址池已不存在，请关闭后重新选择地址池。')
  }, [open, initialSubnetID, query.data, query.loading, query.error])
  const fields = [
    { key: 'name', label: '网段名称', required: true },
    { key: 'category', label: '网络类型', required: true, options: choices([...new Set([...networkTypes, draft?.category].filter(Boolean))]) },
    ...textFields([['cidr', 'CIDR'], ['gateway', '网关'], ['vlan', 'VLAN'], ['vni', 'VXLAN VNI'], ['purpose', '用途'], ['sort_order', '排序', 'number'], ['remark', '备注', 'textarea']]),
  ]
  const disabled = action.busy || query.loading || Boolean(query.error)
  const changeSegment = (index, key, value) => setDraft((current) => ({ ...current, segments: current.segments.map((segment, rowIndex) => {
    if (rowIndex !== index) return segment
    const next = { ...segment, [key]: value }
    if (key === 'start_ip' || key === 'end_ip') next.count = segmentCount(next)
    return next
  }) }))
  const save = () => action.run(async () => {
    setError('')
    try {
      validateFields(fields, draft)
      validateSegments(draft.segments || [])
      const previousName = query.data.find((item) => item.id === draft.id)?.name || ''
      const result = draft.id ? (await api.updateSubnet(draft.id, draft), { id: draft.id }) : await api.createSubnet(draft)
      const latest = await api.ipSubnets()
      const saved = (latest.list || []).find((item) => String(item.id) === String(result.id))
      if (!saved) throw new Error('地址池已保存，但回读不到该地址池，请刷新目录检查。')
      setDraft(saved)
      setBaseline(saved)
      await query.reload()
      directoryChanged()
      onChanged?.({ id: result.id, name: saved.name.trim(), previousName, created: !draft.id })
    } catch (saveError) { setError(saveError.message); throw saveError }
  }, '网段已保存')
  const remove = () => action.run(async () => {
    setError('')
    try {
      await api.deleteSubnet(draft.id)
      setConfirmDelete(false)
      setDraft(null)
      setBaseline(null)
      initialized.current = true
      await query.reload()
      directoryChanged()
      onChanged?.({ id: draft.id, previousName: draft.name, removed: true })
    } catch (deleteError) { setConfirmDelete(false); setError(deleteError.message); throw deleteError }
  }, '网段已删除')
  return <>
    <Dialog open={open} onOpenChange={(next) => { if (next || mayDiscard()) onOpenChange(next) }}>
      <DialogContent data-subnet-maintenance className="cmdb-record-shell cmdb-modal-form network-pool-maintenance flex h-[min(780px,calc(100vh-40px))] w-[min(1000px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-none">
        <DialogHeader className="cmdb-record-header"><div className="min-w-0 flex-1"><DialogTitle className="flex items-center gap-2 text-sm tracking-normal"><Network size={16} />{draft?.id ? '维护地址池' : '新增地址池'}</DialogTitle><p className="mt-1 text-[11px] text-muted-foreground">选择地址池维护资料，或新建地址池</p></div></DialogHeader>
        <div className="network-pool-maintenance-layout">
          <aside aria-label="地址池目录" className="network-pool-directory">
            <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索地址池、CIDR、VLAN/VNI" />
            <Button type="button" size="sm" className="cmdb-primary-action justify-start gap-1.5" aria-pressed={!draft?.id} disabled={disabled} onClick={() => selectDraft(null)}><Plus size={14} />新增地址池</Button>
            <nav aria-label="选择维护地址池" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
              {visibleSubnets.map((item) => <button type="button" key={item.id} disabled={action.busy} aria-current={String(draft?.id) === String(item.id) ? 'true' : undefined} className={`w-full rounded-md px-2 py-2 text-left text-xs hover:bg-muted ${String(draft?.id) === String(item.id) ? 'bg-[color-mix(in_srgb,var(--cmdb-accent)_12%,transparent)] font-semibold text-[var(--cmdb-accent)]' : ''}`} onClick={() => selectDraft(item)}><strong className="block truncate font-medium" title={item.name}>{item.name}</strong><span className="mt-1 block truncate text-[11px] text-muted-foreground" title={`${item.category || '未分类'} · ${item.cidr || item.prefix || 'CIDR 未配置'}`}>{item.category || '未分类'} · {item.cidr || item.prefix || 'CIDR 未配置'}</span></button>)}
              {!visibleSubnets.length ? <EmptyState label={query.loading ? '正在加载地址池…' : '没有匹配地址池'} /> : null}
            </nav>
          </aside>
          <section aria-label="网段编辑" className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            {query.error ? <ErrorBanner message={`地址池加载失败：${query.error}`} onRetry={query.reload} /> : null}
            {error ? <ErrorBanner message={error} /> : null}
            {draft && Object.hasOwn(draft, 'name') ? <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void save() }}>
              <div className="cmdb-record-body min-h-0 flex-1 overflow-y-auto p-4">
                <section className="cmdb-record-section">
                  <h3>{draft.id ? '地址池资料' : '新增地址池'}</h3>
                  <fieldset disabled={disabled} className="min-w-0"><Fields fields={fields} value={draft} onChange={(next) => { setError(''); setDraft(next) }} /></fieldset>
                  <div className="mt-3 rounded-md border border-border/70 bg-secondary/20 p-3" data-subnet-segments aria-label="地址分段">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold">地址分段</h4>
                      <p className="text-[11px] text-muted-foreground">按部门和楼层划分 CIDR 内的 IP 范围，数量自动计算。</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setDraft((current) => ({ ...current, segments: parseSegmentsFromRemark(current.remark) }))} title="按备注中「部门 楼层 数量 起止区间」的行自动生成分段"><Wand2 size={14} />按备注生成</Button>
                      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setDraft((current) => ({ ...current, segments: [...(current.segments || []), segmentDraft()] }))}><Plus size={14} />新增分段</Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] table-fixed border-collapse text-xs">
                      <thead>
                        <tr className="text-left text-[11px] text-muted-foreground">
                          <th className="w-[150px] px-1 pb-1.5 font-normal">部门 / 分段</th>
                          <th className="w-[78px] px-1 pb-1.5 font-normal">楼层</th>
                          <th className="w-[140px] px-1 pb-1.5 font-normal">起始 IP</th>
                          <th className="w-[140px] px-1 pb-1.5 font-normal">结束 IP</th>
                          <th className="w-[64px] px-1 pb-1.5 text-right font-normal">数量</th>
                          <th className="w-[150px] px-1 pb-1.5 font-normal">备注</th>
                          <th className="w-[40px] px-1 pb-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {(draft.segments || []).map((segment, index) => <tr key={segment.id || `new-${index}`} className="border-t border-border/50">
                          {[['name', '部门 / 分段名称', ''], ['floor', '楼层', ''], ['start_ip', '起始 IP', ''], ['end_ip', '结束 IP', ''], ['remark', '备注', '']].map(([key, label]) => <td key={key} className="px-1 py-1.5">
                            <input aria-label={`第 ${index + 1} 段${label}`} className="h-[30px] w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground" value={segment[key] || ''} onChange={(event) => changeSegment(index, key, event.target.value)} />
                          </td>)}
                          <td className="px-1 py-1.5 text-right tabular-nums text-muted-foreground" title={segment.start_ip && segment.end_ip && !segmentCount(segment) ? '请检查起止 IP' : undefined}>{segmentCount(segment) || '—'}</td>
                          <td className="px-1 py-1.5 text-right"><ActionIcon label={`删除第 ${index + 1} 段`} danger onClick={() => setDraft((current) => ({ ...current, segments: current.segments.filter((_, rowIndex) => rowIndex !== index) }))}><Trash2 size={13} /></ActionIcon></td>
                        </tr>)}
                      </tbody>
                    </table>
                  </div>
                  {!(draft.segments || []).length ? <p className="mt-2 text-xs text-muted-foreground">还没有分段。点“按备注生成”可从备注里的区间行自动生成，或手动新增。</p> : null}
                  </div>
                </section>
              </div>
              <footer className="cmdb-record-footer flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
                <Button type="button" variant="ghost" size="sm" className="mr-auto gap-1 text-destructive hover:text-destructive" disabled={disabled || !draft.id} onClick={() => setConfirmDelete(true)}><Trash2 size={14} />删除</Button>
                <Button type="button" variant="outline" size="sm" disabled={action.busy} onClick={() => { if (mayDiscard()) onOpenChange(false) }}>关闭</Button>
                <Button type="submit" size="sm" className="cmdb-primary-action" disabled={disabled}>{action.busy ? <Spinner className="mr-1.5" /> : null}保存地址池</Button>
              </footer>
            </form> : <EmptyState label={query.loading ? '正在加载地址池…' : '请选择地址池，或新增地址池'} />}
          </section>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="删除网段" message={`确认删除“${draft?.name || ''}”？网段内仍有 IP 时不能删除。`} confirmLabel="删除" destructive busy={action.busy} onConfirm={remove} />
  </>
}
