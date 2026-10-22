import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Network, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { VaultHeaderSearch, VaultPageHeader } from '@/components/vault/VaultPageHeader'
import NetworkAddressWorkspace from './NetworkAddressWorkspace'
import RackOverview from './RackOverview'

function ResourceNavigation({ active, onChange }) {
  return <nav aria-label="机柜与网络二级导航" className="flex h-[34px] shrink-0 items-center gap-1">
    {[['rack', '机柜', Server], ['ip', '网络', Network]].map(([key, label, Icon]) => <Button key={key} data-network-view={key} type="button" variant="ghost" size="sm" aria-current={active === key ? 'page' : undefined} onClick={() => onChange(key)} className={`h-[30px] shrink-0 gap-1.5 rounded-[5px] px-2.5 text-xs ${active === key ? 'bg-primary/10 font-medium text-foreground hover:bg-primary/10' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}><Icon size={14} />{label}</Button>)}
  </nav>
}

function CabinetWorkspace({ navigation, keyword, onKeywordChange, focusTarget, onDirtyChange, onNavigate }) {
  const [selectorHost, setSelectorHost] = useState(null)
  return <div data-ipam-page="rack" className="cmdb-theme-scope flex h-full min-h-0 min-w-0 flex-col">
    <VaultPageHeader dataSection="cmdb-ipam-header" contentClassName="h-auto min-h-[54px] flex-wrap gap-2.5 px-3.5 py-[9px]">
      <span ref={setSelectorHost} className="flex min-w-0 shrink-0 items-center gap-2.5" />
      <VaultHeaderSearch data-rack-search value={keyword} onChange={event => onKeywordChange(event.target.value)} placeholder="搜索机房、机柜、设备或 IP" className="min-w-[180px] max-w-[520px] flex-[1_1_240px]" inputClassName="h-[34px] rounded-[7px] text-[13px]" />
      <span className="min-w-0 flex-1" />
      <span className="ml-auto flex shrink-0 items-center">{navigation}</span>
    </VaultPageHeader>
    <RackOverview selectorHost={selectorHost} keyword={keyword} onKeywordChange={onKeywordChange} focusTarget={focusTarget} onDirtyChange={onDirtyChange} onOpenAsset={id => onNavigate?.({ tableKey: 'cmdb_assets', id })} />
  </div>
}

export default function IPAM({ focusTarget, rackFocus, onNavigate, onDirtyChange }) {
  const [resourceView, setResourceView] = useState(() => focusTarget?.tableKey === 'ip_pool' ? 'ip' : 'rack')
  const [rackKeyword, setRackKeyword] = useState('')
  const [ipFocus, setIPFocus] = useState(() => focusTarget?.tableKey === 'ip_pool' ? focusTarget : null)
  const [activeRackFocus, setActiveRackFocus] = useState(() => rackFocus || (focusTarget?.tableKey === 'rack_cabinet' ? focusTarget : null))
  const [pendingView, setPendingView] = useState(null)
  const [workspaceVersion, setWorkspaceVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const editState = useRef({ dirty: false, busy: false })
  const viewRef = useRef(resourceView)
  const dirtyListener = useRef(onDirtyChange)
  dirtyListener.current = onDirtyChange
  const handleDirty = useCallback((dirty, saving = false) => {
    editState.current = { dirty, busy: saving }
    setBusy(saving)
    dirtyListener.current?.(dirty, saving)
  }, [])
  const enterView = useCallback(request => {
    if (editState.current.dirty && request.view === viewRef.current) setWorkspaceVersion(version => version + 1)
    handleDirty(false, false)
    viewRef.current = request.view
    setResourceView(request.view)
    if (request.view === 'ip') setIPFocus(request.target || null)
    else if (request.target) setActiveRackFocus(request.target)
  }, [handleDirty])
  const requestView = useCallback(request => {
    if (editState.current.busy) return
    if (request.view === viewRef.current && !request.target) return
    if (editState.current.dirty) { setPendingView(request); return }
    enterView(request)
  }, [enterView])
  useEffect(() => {
    if (focusTarget?.tableKey === 'ip_pool') requestView({ view: 'ip', target: focusTarget })
    else if (focusTarget?.tableKey === 'rack_cabinet') requestView({ view: 'rack', target: focusTarget })
  }, [focusTarget, requestView])
  useEffect(() => { if (rackFocus) requestView({ view: 'rack', target: rackFocus }) }, [rackFocus, requestView])
  useEffect(() => () => dirtyListener.current?.(false, false), [])
  const navigation = <ResourceNavigation active={resourceView} onChange={view => requestView({ view })} />
  return <>
    {resourceView === 'rack' ? <CabinetWorkspace key={`rack:${workspaceVersion}`} navigation={navigation} keyword={rackKeyword} onKeywordChange={setRackKeyword} focusTarget={activeRackFocus} onDirtyChange={handleDirty} onNavigate={onNavigate} /> : <NetworkAddressWorkspace key={`ip:${workspaceVersion}`} navigation={navigation} focusTarget={ipFocus} onDirtyChange={handleDirty} onNavigate={onNavigate} />}
    <ConfirmDialog open={!!pendingView} onOpenChange={next => { if (!next && !editState.current.busy) setPendingView(null) }} title="修改尚未保存" message="切换页面或定位目标会放弃当前页面的未保存修改，是否继续？" confirmLabel="放弃修改并继续" destructive busy={busy} onConfirm={() => { if (editState.current.busy) return; enterView(pendingView); setPendingView(null) }} />
  </>
}
