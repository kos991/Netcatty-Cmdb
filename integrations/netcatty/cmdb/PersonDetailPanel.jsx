import React, { useCallback, useEffect, useState } from 'react'
import { History, Monitor, Network, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { useAction, useQuery } from './hooks'
import { choices } from './Fields'
import { AssetPanel } from './AssetPanel'
import { AssetDetailTabBar } from './AssetDetailTabs'
import { EmptyState, ErrorBanner, SelectControl, StatusPill } from './ui'

const tabs = [
  { key: 'profile', label: '人员资料', icon: Users },
  { key: 'organization', label: '组织归属', icon: Network },
  { key: 'assets', label: '名下资产', icon: Monitor },
  { key: 'transfer', label: '资产交接', icon: History },
]

function PersonFields({ items }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-[18px]">{items.map(([label, value]) => <div key={label} className="min-w-0"><dt className="mb-1.5 text-[11px] text-muted-foreground">{label}</dt><dd className="break-words text-xs leading-relaxed">{value || '未分配'}</dd></div>)}</dl>
}

function PersonAssetList({ rows, selected, onSelectedChange, onNavigate, disabled }) {
  if (!rows.length) return <EmptyState label="暂无名下资产" />
  return <div className="space-y-2">{rows.map((asset) => <article key={asset.id} className="flex min-w-0 items-start gap-2 rounded-md border border-border/70 p-3">
    <input type="checkbox" className="mt-1 accent-primary" aria-label={`选择交接${asset.name || asset.asset_code || '资产'}`} disabled={disabled} checked={selected.includes(asset.id)} onChange={(event) => onSelectedChange(event.target.checked ? [...selected, asset.id] : selected.filter((id) => id !== asset.id))} />
    <div className="min-w-0 flex-1"><Button type="button" variant="link" className="h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left text-xs" onClick={() => onNavigate({ tableKey: asset.source_type === 'legacy_asset' ? 'assets' : 'cmdb_assets', id: asset.source_type === 'legacy_asset' ? asset.source_id : asset.id, asset_class: asset.asset_class })}><Monitor size={14} className="mr-1.5 shrink-0" />{asset.name || asset.asset_code || `#${asset.id}`}</Button><p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">{[asset.asset_code, asset.device_type || asset.asset_class, asset.manage_ip].filter(Boolean).join(' · ') || '未填写资产摘要'}</p></div>
    {asset.status ? <StatusPill>{asset.status}</StatusPill> : null}
  </article>)}</div>
}

export default function PersonDetailPanel({ person, initialTab = 'profile', people = [], peopleLoading, peopleError, onRetryPeople, onClose, onEdit, onDelete, onNavigate, onTransferred }) {
  const load = useCallback(() => api.personAssets(person.id), [person.id])
  const query = useQuery(load)
  const action = useAction()
  const [tab, setTab] = useState(initialTab)
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState([])
  const [target, setTarget] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [transferError, setTransferError] = useState('')
  const [transferred, setTransferred] = useState(null)
  const record = query.data?.person || person
  const rows = query.data?.assets || []
  const recipient = people.find((entry) => Number(entry.id) === Number(target) && Number(entry.id) !== Number(record.id))
  useEffect(() => { setTab(initialTab) }, [initialTab])
  useEffect(() => { if (query.data) setSelected((current) => current.filter((id) => query.data.assets?.some((asset) => asset.id === id))) }, [query.data])
  const blocked = action.busy || query.loading || Boolean(query.error) || Boolean(peopleError) || peopleLoading
  const transfer = () => action.run(async () => {
    setTransferError('')
    try {
      if (blocked || !recipient || !rows.length) throw new Error('请确认名下资产和接收人后重试')
      const result = await api.transferPersonAssets({ from_person_id: record.id, to_person_id: Number(target), asset_ids: selected.length ? selected : rows.map((asset) => asset.id) })
      setTransferred(result.transferred)
      setConfirm(false)
      setSelected([])
      await query.reload()
      onTransferred()
    } catch (error) { setTransferError(error.message); setConfirm(false); throw error }
  }, '资产交接完成')

  return <>
    <AssetPanel open onClose={onClose} title={record.name} subtitle={record.person_code || '未填写工号'} status={record.status} icon={Users} expanded={expanded} onExpandedChange={setExpanded} onEdit={() => onEdit(record)} dataSection="cmdb-person-panel" tabs={<AssetDetailTabBar tabs={tabs} value={tab} onChange={setTab} dataSection="person-detail-tabs" panelId="person-detail-panel" />}>
      <div id="person-detail-panel" role="tabpanel" aria-labelledby={`person-detail-tabs-${tab}`} tabIndex={0} className="space-y-5 outline-none">
        {query.error ? <ErrorBanner message={query.error} onRetry={query.reload} /> : null}
        <h3 className="text-xs font-semibold">{tabs.find((item) => item.key === tab).label}</h3>
        {tab === 'profile' ? <>
          <PersonFields items={[[ '姓名', record.name ], [ '工号', record.person_code ], [ '岗位', record.title ], [ '电话', record.phone ], [ '状态', record.status ]]} />
          <section className="space-y-2 pt-1"><h4 className="text-[11px] text-muted-foreground">备注</h4><p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{record.remark || '未填写备注'}</p></section>
          <div className="border-t border-border/60 pt-4"><Button type="button" variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" disabled={action.busy} onClick={() => onDelete(record)}><Trash2 size={14} />删除人员</Button></div>
        </> : null}
        {tab === 'organization' ? <>
          <PersonFields items={[[ '组织', record.org_name ], [ '部门', record.department ], [ '分组', record.group_name ]]} />
          <section className="space-y-2 pt-1"><h4 className="text-[11px] text-muted-foreground">归属路径</h4><p className="break-words text-xs leading-relaxed">{[record.org_name, record.department, record.group_name].filter(Boolean).join(' / ') || '未分配'}</p></section>
        </> : null}
        {tab === 'assets' || tab === 'transfer' ? <>
          <p className="text-[11px] text-muted-foreground">{query.loading && !query.data ? '正在读取名下资产…' : query.data ? `当前名下 ${rows.length} 项资产${selected.length ? ` · 已选 ${selected.length} 项` : ''}` : '名下资产尚未加载'}{query.error && query.data ? ' · 显示上次读取结果' : ''}</p>
          {transferError ? <ErrorBanner title="交接未完成" message={transferError} /> : null}
          {transferred !== null ? <p role="status" className="text-xs">已交接 {transferred} 项资产。</p> : null}
          {tab === 'transfer' ? <>
            <p className="text-xs leading-relaxed text-muted-foreground">交接全部或勾选的资产，更新资产负责人及部门，并保留履历。</p>
            {peopleError ? <ErrorBanner message={peopleError} onRetry={onRetryPeople} /> : null}
            <div className="space-y-1.5"><label htmlFor="person-transfer-target" className="text-xs text-muted-foreground">接收人</label><SelectControl id="person-transfer-target" aria-label="接收人" searchable className="w-full" disabled={blocked} value={target} onChange={setTarget} options={choices(people.filter((entry) => Number(entry.id) !== Number(record.id)).map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.department || entry.org_name || '未分配'}` })), '选择接收人')} /></div>
            <Button type="button" className="h-9 w-full gap-2" disabled={blocked || !recipient || !rows.length} onClick={() => setConfirm(true)}><History size={14} />{selected.length ? `交接已选 ${selected.length} 项资产` : `交接全部 ${rows.length} 项资产`}</Button>
          </> : null}
          {query.data ? <PersonAssetList rows={rows} selected={selected} onSelectedChange={setSelected} onNavigate={onNavigate} disabled={blocked} /> : null}
        </> : null}
      </div>
    </AssetPanel>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="确认资产交接" message={`将“${record.name}”的 ${selected.length || rows.length} 项资产交接给“${recipient?.name || ''}”，并保留交接履历。`} confirmLabel="确认交接" busy={action.busy} onConfirm={transfer} />
  </>
}
