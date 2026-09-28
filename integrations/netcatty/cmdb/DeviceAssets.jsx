import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ArrowRight, ChevronDown, FolderTree, Monitor, Network, Plus, RefreshCw, Workflow, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { Spinner } from '@/components/ui/spinner'
import { VaultHeaderSearch, VaultPageHeader, vaultHeaderIconButtonClass, vaultHeaderSecondaryButtonClass } from '@/components/vault/VaultPageHeader'
import { api } from './api'
import { directoryChanged, useAction } from './hooks'
import { resolveSearchTarget } from './state'
import { SelectControl } from './ui'
import Taxonomy from './Taxonomy'

const TerminalAssets = lazy(() => import('./TerminalAssets'))
const Infrastructure = lazy(() => import('./Infrastructure'))
const Systems = lazy(() => import('./Systems'))
const labels = { assets: '终端资产', cmdb_assets: '基础设施', server_apps: '业务系统' }
const assetViews = [
  { value: 'terminals', label: '终端资产' },
  { value: 'infrastructure', label: '基础设施' },
  { value: 'systems', label: '业务系统' },
]

export default function DeviceAssets({ focusTarget, onNavigate, meta }) {
  const [tab, setTab] = useState('terminals')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState(null)
  const [taxonomyOpen, setTaxonomyOpen] = useState(false)
  const [command, setCommand] = useState({ tab: '', type: '', id: 0 })
  const [panel, setPanel] = useState({ open: false, width: 420 })
  const onPanelOpenChange = useCallback((open, width = 420) => setPanel(current => current.open === open && current.width === width ? current : { open, width }), [])
  const action = useAction()
  useEffect(() => { const target = resolveSearchTarget(focusTarget); if (target?.assetTab) setTab(target.assetTab) }, [focusTarget])
  const submit = () => action.run(async () => { const value = keyword.trim(); setSearch(value); if (!value) { setResults(null); return } const response = await api.search(value); const matched = (response.results || []).filter((r) => labels[r.tableKey]); setResults(matched.length ? matched : null) })
  const clearSearch = () => { setKeyword(''); setSearch(''); setResults(null) }
  const issueCommand = (type, targetTab = tab) => setCommand((current) => ({ tab: targetTab, type, id: current.id + 1 }))
  const createAsset = (targetTab) => { setTab(targetTab); issueCommand('create', targetTab) }
  const viewControl = <SelectControl aria-label="资产类别" value={tab} onChange={setTab} options={assetViews} className="w-[138px]" />
  return <div className="relative flex h-full min-h-0 flex-col" data-asset-panel-open={panel.open}><div className="flex min-h-0 flex-1 flex-col" style={panel.open ? { marginRight: panel.width === 'full' ? '100%' : `min(${panel.width}px, 100%)` } : undefined}><VaultPageHeader dataSection="cmdb-device-assets-header" contentClassName="h-auto min-h-14 flex-wrap">
    <Dropdown><DropdownTrigger asChild><Button data-device-assets-add type="button" variant="secondary" className={vaultHeaderSecondaryButtonClass}><Plus size={15} />新增资产<ChevronDown size={14} /></Button></DropdownTrigger><DropdownContent align="start" sideOffset={8} className="w-44">
      {[["terminals", "终端资产", Monitor], ["infrastructure", "基础设施", Network], ["systems", "业务系统", Workflow]].map(([key, label, Icon]) => <button type="button" key={key} onClick={() => createAsset(key)} className="flex h-10 w-full items-center gap-3 rounded px-3 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"><Icon size={16} className="text-primary" /><span>{label}</span></button>)}
    </DropdownContent></Dropdown>
    <VaultHeaderSearch data-device-asset-search-input value={keyword} onChange={(event) => { const value = event.target.value; setKeyword(value); if (!value) clearSearch() }} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} placeholder="搜索资产编码、名称、SN、IP、品牌、型号或供应商" className="min-w-[180px] max-w-[520px] flex-1" rightAdornment={keyword ? <button type="button" aria-label="清除资产搜索" className="grid h-6 w-6 place-items-center rounded hover:bg-foreground/10" onClick={clearSearch}><X size={13} /></button> : null} />
    <span className="min-w-0 flex-1" />
    <Button data-device-assets-taxonomy type="button" variant="ghost" className={vaultHeaderSecondaryButtonClass} onClick={() => setTaxonomyOpen(true)}><FolderTree size={15} />分类与分组管理</Button>
    <Button data-device-assets-refresh type="button" variant="ghost" size="icon" className={vaultHeaderIconButtonClass} aria-label="刷新当前资产列表" onClick={() => issueCommand('refresh')}><RefreshCw size={15} /></Button>
  </VaultPageHeader>
    {results && <section className="max-h-48 shrink-0 overflow-auto border-b border-border px-5 py-2" aria-label="设备资产搜索结果"><div className="flex justify-between text-xs text-muted-foreground"><span>{results.length ? `找到 ${results.length} 项` : '未找到匹配资产'}</span><Button variant="ghost" size="sm" onClick={() => setResults(null)}>收起</Button></div>{results.map((row) => <button type="button" key={`${row.tableKey}-${row.id}`} onClick={() => { setResults(null); onNavigate(row) }} className="flex w-full items-center justify-between rounded px-2 py-2 text-left hover:bg-muted"><span className="text-sm">{row.title}<small className="ml-3 text-muted-foreground">{labels[row.tableKey]} · {row.subtitle}</small></span><ArrowRight size={14} /></button>)}</section>}
    <Suspense fallback={<div className="p-5"><Spinner /></div>}>{tab === 'terminals' ? <TerminalAssets keyword={search} focusTarget={focusTarget} onNavigate={onNavigate} command={command} leadingControl={viewControl} onPanelOpenChange={onPanelOpenChange} /> : tab === 'infrastructure' ? <Infrastructure keyword={search} focusTarget={focusTarget} onNavigate={onNavigate} command={command} leadingControl={viewControl} meta={meta} onPanelOpenChange={onPanelOpenChange} /> : <Systems keyword={search} focusTarget={focusTarget} meta={meta} command={command} leadingControl={viewControl} onPanelOpenChange={onPanelOpenChange} />}</Suspense>
  </div><Taxonomy open={taxonomyOpen} onOpenChange={setTaxonomyOpen} onChanged={() => { directoryChanged(); issueCommand('refresh') }} /></div>
}
