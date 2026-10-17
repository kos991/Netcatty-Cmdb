import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ListFilter, Lock, Pencil, Plus, Settings2, Sparkles, Trash2, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { toast } from '@/components/ui/toast'
import { VaultHeaderSearch, VaultPageHeader, vaultHeaderSecondaryButtonClass } from '@/components/vault/VaultPageHeader'
import { api } from './api'
import { allPages, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { subnetSelectorGroups } from './ipamLayoutModel'
import { ipAddressPresentation, isCloudDevice } from './state'
import { ActionIcon, DataTable, DefinitionList, DetailSheet, ErrorBanner, ModalForm, Pagination, SearchBox, SelectControl, StatusPill } from './ui'
import SubnetMaintenance from './SubnetMaintenance'
import SubnetSuggestions from './SubnetSuggestions'
import AssetTransferMenu from './AssetTransferMenu'
import RackOverview from './RackOverview'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { syncFollowingNetcattyHosts } from './NetcattyConnection'

const loadSubnets = async () => (await api.ipSubnets()).list || []
const loadNetworkTypes = async () => (await api.config('network-types')).list || []
const loadSummary = () => api.ipSummary()
const loadAssets = async () => {
  const [terminals, infrastructure, applications] = await Promise.all([allPages(api.assets), allPages(api.infrastructure, { scope: 'infrastructure' }), allPages(api.apps)])
  return [
    ...terminals.map((asset) => ({ ...asset, key: `terminal:${asset.id}`, owner_type: 'terminal', owner_name: asset.asset_code || asset.device_type || `终端 #${asset.id}` })),
    ...infrastructure.map((asset) => ({ ...asset, key: `infrastructure:${asset.id}`, owner_type: 'infrastructure', owner_name: asset.name || asset.asset_code || `设备 #${asset.id}` })),
    ...applications.map((asset) => ({ ...asset, key: `application:${asset.id}`, owner_type: 'application', owner_name: asset.app_name || `业务系统 #${asset.id}` })),
  ]
}
const usedIP = (row) => ipAddressPresentation(row).kind === 'used'
const specialIP = (row) => ['网络地址', '广播地址'].includes(row?.status) || ipAddressPresentation(row).kind === 'special'
const reservedIP = (row) => row?.status === '保留'
const ownerTypeLabel = (value) => ({ terminal: '终端资产', infrastructure: '基础设施', server: '承载设备', application: '业务系统' }[value] || '')


function IPDetails({ record, onNavigate }) {
  const target = record.owner_type === 'terminal' ? { tableKey: 'assets', id: record.owner_id } : record.owner_type === 'application' ? { tableKey: 'server_apps', id: record.owner_id } : record.owner_type === 'server' ? { tableKey: 'servers', id: record.owner_id } : record.owner_type === 'infrastructure' ? { tableKey: 'cmdb_assets', id: record.owner_id } : null
  const presentation = ipAddressPresentation(record)
  return <div className="space-y-4"><DefinitionList items={[
    ['IP 地址', record.ip], ['网段', record.subnet], ['状态', presentation.label], ['占用类型', ownerTypeLabel(record.owner_type)], ['占用对象', record.owner_name || record.asset_code], ['部门', record.department], ['位置', record.room], ['使用人 / 负责人', record.account || record.asset_user], ['备注', record.remark],
  ]} />{record.applications?.length ? <div className="space-y-1"><p className="text-xs text-muted-foreground">使用此地址的业务系统</p>{record.applications.map(app => <Button key={app.id} variant="link" size="sm" onClick={() => onNavigate({ tableKey: 'server_apps', id: app.id })}>{app.app_name}</Button>)}</div> : null}{specialIP(record) && <p className="text-xs text-muted-foreground">该地址由网段 CIDR 识别，不可预留或分配。</p>}{target ? <Button variant="outline" size="sm" onClick={() => onNavigate(target)}>查看{ownerTypeLabel(record.owner_type)}</Button> : !specialIP(record) ? <p className="text-xs text-muted-foreground">当前地址未关联资产</p> : null}</div>
}

export default function IPAM({ focusTarget, rackFocus, onNavigate, onDirtyChange }) {
  const [subnet, setSubnet] = useState('')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(256)
  const [view, setView] = useState('grid')
  const [resourceView, setResourceView] = useState('rack')
  const [rackKeyword, setRackKeyword] = useState('')
  const rackDirty = useRef(false)
  const rackBusy = useRef(false)
  const addressDirty = useRef(false)
  const addressBusy = useRef(false)
  const initialValues = useRef({})
  const [subnetDirty, setSubnetDirty] = useState(false)
  const [subnetBusy, setSubnetBusy] = useState(false)
  const [rackDirtyState, setRackDirtyState] = useState(false)
  const [rackBusyState, setRackBusyState] = useState(false)
  const dirtyListener = useRef(onDirtyChange)
  dirtyListener.current = onDirtyChange
  const [pendingAddress, setPendingAddress] = useState(null)
  const [ipFocus, setIPFocus] = useState(null)
  const activeRackFocus = rackFocus || (focusTarget?.tableKey === 'rack_cabinet' ? focusTarget : null)
  const handleRackDirty = useCallback((dirty, busy = false) => {
    rackDirty.current = dirty
    rackBusy.current = busy
    setRackDirtyState(dirty)
    setRackBusyState(busy)
  }, [])
  const enterAddressView = useCallback(({ selectedSubnet, target = null } = {}) => {
    handleRackDirty(false)
    setResourceView('ip')
    if (selectedSubnet !== undefined) { setSubnet(selectedSubnet); setPage(1) }
    if (target) setPage(1)
    setIPFocus(target)
    setDetail(null)
  }, [handleRackDirty])
  const mayLeaveAddress = useCallback(() => {
    if (addressBusy.current) return false
    if (addressDirty.current && !window.confirm('地址池修改尚未保存，是否放弃修改并继续？')) return false
    setEditor(null); setSettings(null); setSubnetDirty(false)
    addressDirty.current = false
    return true
  }, [])
  const requestAddressView = useCallback((request = {}) => {
    if (rackBusy.current) return false
    if (rackDirty.current) { setPendingAddress(request); return false }
    if (!mayLeaveAddress()) return false
    enterAddressView(request)
    return true
  }, [enterAddressView, mayLeaveAddress])
  const requestRackView = useCallback(() => {
    if (!mayLeaveAddress()) return
    setResourceView('rack'); setIPFocus(null); setDetail(null)
  }, [mayLeaveAddress])
  const [settings, setSettings] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [subnetMenuOpen, setSubnetMenuOpen] = useState(false)
  const [subnetPickerOpen, setSubnetPickerOpen] = useState(false)
  const [subnetPickerKeyword, setSubnetPickerKeyword] = useState('')
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [detail, setDetail] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const subnets = useQuery(loadSubnets, [])
  const summary = useQuery(loadSummary)
  const assets = useQuery(loadAssets, [])
  const networkTypes = useDirectory(loadNetworkTypes)
  const listLoader = useCallback(() => api.ipEntries({ subnet, keyword: search, status, page, page_size: pageSize }), [subnet, search, status, page, pageSize])
  const visualLoader = useCallback(() => subnet ? api.ipVisualization({ subnet, page, page_size: pageSize }) : Promise.resolve({ list: [], total: 0 }), [subnet, page, pageSize])
  const listQuery = useQuery(listLoader)
  const visualQuery = useQuery(visualLoader)
  const query = view === 'grid' ? visualQuery : listQuery
  const action = useAction()
  const editorDirty = !!editor && JSON.stringify(values) !== JSON.stringify(initialValues.current)
  addressDirty.current = editorDirty || subnetDirty
  addressBusy.current = action.busy || subnetBusy
  useEffect(() => { dirtyListener.current?.(rackDirtyState || editorDirty || subnetDirty, rackBusyState || action.busy || subnetBusy) }, [rackDirtyState, editorDirty, subnetDirty, rackBusyState, action.busy, subnetBusy])
  const closeEditor = () => { if (!action.busy && (!editorDirty || window.confirm('IP 修改尚未保存，是否放弃修改？'))) setEditor(null) }
  const { hosts, updateHostAddress } = useNetcattyDirectory()
  useEffect(() => {
    if (!subnet && !subnets.loading && !subnets.error && subnets.data?.length) setSubnet(subnets.data[0].name)
  }, [subnet, subnets.data, subnets.loading, subnets.error])
  useEffect(() => {
    if (activeRackFocus) requestRackView()
  }, [activeRackFocus, requestRackView])
  useEffect(() => {
    if (focusTarget?.tableKey === 'ip_pool') requestAddressView({ target: focusTarget })
  }, [focusTarget, requestAddressView])
  useEffect(() => () => dirtyListener.current?.(false, false), [])
  useEffect(() => {
    if (!ipFocus) return
    let active = true
    allPages(api.ipEntries, { subnet: ipFocus.subtitle || ipFocus.data?.网段 || '', keyword: ipFocus.title || '' }).then((records) => {
      if (!active) return
      const record = records.find((item) => item.id === ipFocus.id || item.ip === ipFocus.title)
      if (record) { setSubnet(record.subnet); setDetail(record) }
    }).catch((error) => { if (active) toast.error(error.message) })
    return () => { active = false }
  }, [ipFocus])
  const refresh = () => { listQuery.reload(); visualQuery.reload(); summary.reload(); subnets.reload(); assets.reload() }
  const open = (record = {}, mode = 'edit') => {
    if (specialIP(record)) return
    setEditor({ record, mode })
    const next = mode === 'allocate' ? { asset_key: '', asset_id: 0, owner_type: '', ip_field: 'ip', remark: record.remark || '' } : { subnet, ...record, status: record.status || '空闲' }
    initialValues.current = next
    setValues(next)
  }
  const clearReservation = (record) => action.run(async () => {
    await api.updateIP(record.id, { ...record, status: '空闲' })
    setDetail(null)
    refresh()
  }, '已取消预留')
  const selectedAsset = (assets.data || []).find((item) => item.key === values.asset_key)
  const editFields = [
    { key: 'subnet', label: '网段', required: true, options: choices([...new Set([...(subnets.data || []).map((s) => s.name), values.subnet].filter(Boolean))]) },
    { key: 'ip', label: 'IP 地址', required: true },
    { key: 'remark', label: '备注', type: 'textarea' },
  ]
  const allocateFields = [
    {
      key: 'asset_key',
      label: '关联资产',
      required: true,
      searchable: true,
      options: choices((assets.data || []).map((item) => ({
        value: item.key,
        label: `${ownerTypeLabel(item.owner_type)} · ${item.owner_name}${item.asset_code && item.asset_code !== item.owner_name ? ` / ${item.asset_code}` : ''}${item.mgmt_ip || item.ip || item.server_biz_ip ? ` · ${item.mgmt_ip || item.ip || item.server_biz_ip}` : ''}`,
      }))),
      derive: (key) => {
        const item = (assets.data || []).find((asset) => asset.key === key)
        return item
          ? { asset_id: item.id, owner_type: item.owner_type, ip_field: item.owner_type === 'infrastructure' ? 'mgmt_ip' : 'ip' }
          : { asset_id: 0, owner_type: '' }
      },
    },
    { key: 'ip_field', label: '地址用途', required: true, options: selectedAsset?.owner_type === 'infrastructure' ? [{ value: 'mgmt_ip', label: '管理 IP' }, { value: 'biz_ip', label: '业务 IP' }, { value: 'public_ip', label: '公网 IP' }] : selectedAsset?.owner_type === 'terminal' && isCloudDevice(selectedAsset.device_type) ? [{ value: 'ip', label: '业务 / 虚拟机 IP' }, { value: 'terminal_ip', label: '终端物理 IP' }] : [{ value: 'ip', label: selectedAsset?.owner_type === 'application' ? '应用 IP' : '设备 IP' }] },
    { key: 'remark', label: '备注', type: 'textarea' },
  ]
  const columns = [{ key: 'ip', label: 'IP 地址', render: (v, r) => <Button variant="link" className="h-auto p-0 font-mono" onClick={() => setDetail(r)}>{v}</Button> }, { key: 'status', label: '状态', render: (_, r) => { const presentation = ipAddressPresentation(r); return <StatusPill tone={presentation.kind === 'special' ? 'neutral' : presentation.kind === 'used' ? 'info' : presentation.kind === 'free' ? 'neutral' : 'warning'}>{presentation.label}</StatusPill> } }, { key: 'owner_type', label: '占用类型', render: (v) => ownerTypeLabel(v) || '-' }, ...textFields([['subnet', '网段'], ['owner_name', '占用对象'], ['account', '使用人'], ['department', '部门'], ['room', '位置']]), { key: 'actions', label: '操作', render: (_, r) => specialIP(r) ? null : <div className="flex"><ActionIcon label="编辑 IP" onClick={() => open(r)}><Pencil size={15} /></ActionIcon>{!usedIP(r) && !reservedIP(r) && <ActionIcon label="预留 IP" onClick={() => open(r, 'reserve')}><Lock size={15} /></ActionIcon>}{reservedIP(r) && <ActionIcon label="取消预留" onClick={() => clearReservation(r)}><Unlock size={15} /></ActionIcon>}<ActionIcon label={usedIP(r) ? '释放 IP' : '分配 IP'} onClick={() => usedIP(r) ? setConfirmation({ action: 'release', record: r }) : open(r, 'allocate')}>{usedIP(r) ? <Unlock size={15} /> : <Plus size={15} />}</ActionIcon><ActionIcon label="删除 IP" danger onClick={() => setConfirmation({ action: 'delete', record: r })}><Trash2 size={15} /></ActionIcon></div> }]
  const rows = query.error ? [] : query.data?.list || []
  const activeSubnet = (subnets.data || []).find((item) => item.name === subnet)
  const activeSummary = summary.data?.subnets?.find((item) => item.subnet === subnet) || {}
  const activeNetwork = activeSubnet || activeSummary
  const subnetGroups = subnetSelectorGroups(subnets.data || [], summary.data?.subnets || [], subnetPickerKeyword)
  return <div className="flex h-full min-h-0 flex-col">
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {resourceView === 'ip' && <VaultPageHeader dataSection="cmdb-ipam-header" contentClassName="h-auto min-h-14 flex-wrap">
        <Dropdown open={subnetMenuOpen} onOpenChange={setSubnetMenuOpen}><DropdownTrigger asChild><Button data-ipam-add-subnet type="button" variant="secondary" className={vaultHeaderSecondaryButtonClass}><Plus size={15} />新增地址池<ChevronDown size={14} /></Button></DropdownTrigger><DropdownContent align="start" sideOffset={8} className="w-44 p-1">
          {[['create', '新增地址池', Plus], ['maintain', '维护其他地址池', Settings2], ['suggest', '从资产 IP 生成', Sparkles]].map(([key, label, Icon]) => <button key={key} data-ipam-subnet-menu-item={key} type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary" onClick={() => { setSubnetMenuOpen(false); if (key === 'suggest') setSuggesting(true); else setSettings({ initialCreate: key === 'create', initialSubnetID: key === 'maintain' ? activeSubnet?.id : undefined }) }}><Icon size={14} />{label}</button>)}
        </DropdownContent></Dropdown>
        <div className="flex h-9 shrink-0 items-center rounded-md border border-border bg-muted/30 p-0.5" aria-label="机柜与网络视图"><Button data-network-view="rack" type="button" variant="ghost" size="sm" className="h-7 px-3 text-xs" aria-pressed={false} onClick={requestRackView}>设备机柜</Button><Button data-network-view="ip" type="button" variant="secondary" size="sm" className="h-7 px-3 text-xs" aria-pressed>地址池</Button></div>
        <Dropdown open={subnetPickerOpen} onOpenChange={(next) => { setSubnetPickerOpen(next); if (!next) setSubnetPickerKeyword('') }}>
          <DropdownTrigger asChild><Button data-ipam-subnet-selector type="button" variant="outline" className="min-w-[180px] max-w-[280px] justify-between gap-2 text-xs"><span className="truncate">{subnet ? `${subnet}${activeNetwork.cidr || activeNetwork.prefix ? ` · ${activeNetwork.cidr || activeNetwork.prefix}` : ''}` : '选择地址池'}</span><ChevronDown size={14} className="shrink-0" /></Button></DropdownTrigger>
          <DropdownContent align="start" sideOffset={8} className="w-[min(360px,calc(100vw-32px))] p-2">
            <SearchBox value={subnetPickerKeyword} onChange={setSubnetPickerKeyword} placeholder="搜索地址池、CIDR、VLAN 或 VNI" className="min-w-0 max-w-none" />
            <div className="mt-2 max-h-64 overflow-y-auto">{subnets.loading ? <p className="px-2 py-5 text-center text-xs text-muted-foreground">加载地址池...</p> : subnets.error ? <ErrorBanner message={subnets.error} onRetry={subnets.reload} /> : subnetGroups.length ? subnetGroups.map((group) => <section key={group.category} data-ipam-subnet-group={group.category}>
              <h3 className="sticky top-0 bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">{group.category}</h3>
              {group.items.map((item) => <button type="button" key={item.id || item.value} data-ipam-subnet-option={item.value} onClick={() => { requestAddressView({ selectedSubnet: item.value }); setSubnetPickerOpen(false); setSubnetPickerKeyword('') }} className={`mb-1 w-full rounded-md px-2.5 py-2 text-left hover:bg-secondary ${subnet === item.value ? 'bg-primary/10' : ''}`}><strong className="block truncate text-xs" title={item.label}>{item.label}</strong><span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={item.description}>{item.description}</span></button>)}
            </section>) : <p className="px-2 py-5 text-center text-xs text-muted-foreground">暂无匹配地址池</p>}</div>
          </DropdownContent>
        </Dropdown>
        <VaultHeaderSearch data-ipam-search value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setSearch(keyword.trim()); if (keyword.trim()) setView('table'); setPage(1) } }} placeholder="查询 IP、资产、人员或部门" className="min-w-[180px] max-w-[360px] flex-1" />
        <span className="min-w-0 flex-1" />
        <Button data-ipam-edit-subnet variant="outline" size="sm" className="text-xs" disabled={!activeSubnet?.id || subnets.loading || !!subnets.error} onClick={() => setSettings({ initialSubnetID: activeSubnet.id })}>编辑地址池</Button>
        <Button variant="outline" size="sm" className="text-xs" onClick={() => open()}>补录 IP</Button>
        <Dropdown><DropdownTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="查询 IP" title="查询 IP"><ListFilter size={16} /></Button></DropdownTrigger><DropdownContent align="end" className="w-56 space-y-3 p-3"><SelectControl value={status} prefix="状态" onChange={(next) => { setStatus(next); if (next) setView('table'); setPage(1) }} options={choices(['在用', '空闲', '保留', '异常'], '全部状态')} /><Button type="button" variant="outline" size="sm" className="w-full text-xs" onClick={() => { setKeyword(''); setSearch(''); setStatus(''); setPage(1) }}>重置查询</Button></DropdownContent></Dropdown>
        <AssetTransferMenu importTitle="导入 IP" importer={api.importIPs} onImported={refresh} exporter={() => api.exportIPs({ subnet, keyword: search, status })} />
      </VaultPageHeader>}
      {resourceView === 'rack' ? <RackOverview keyword={rackKeyword} onKeywordChange={setRackKeyword} onAddressView={() => requestAddressView()} focusTarget={activeRackFocus} onDirtyChange={handleRackDirty} onOpenAsset={(id) => onNavigate({ tableKey: 'cmdb_assets', id })} /> : <>
      <div className="flex shrink-0 flex-wrap items-center gap-5 border-b border-border/70 px-[18px] py-4">
        <div className="mr-auto min-w-[220px] max-[900px]:basis-full">
          <h1 className="text-sm font-semibold">{subnet || '请选择地址池'}{activeNetwork.category ? ` · ${activeNetwork.category}` : ''}</h1>
          <p data-subnet-network-fields className="mt-1.5 text-[11px] text-muted-foreground">{activeNetwork.cidr || activeNetwork.prefix || 'CIDR 未配置'} 网关 {activeNetwork.gateway || '未配置'} VLAN {activeNetwork.vlan || '未配置'}{activeNetwork.vni ? ` VNI ${activeNetwork.vni}` : ''}</p>
        </div>
        {[['地址总数', visualQuery.loading || visualQuery.error ? '—' : visualQuery.data?.total ?? 0, ''], ['已占用', activeSummary.used || 0, 'text-primary'], ['已预留', activeSummary.reserved || 0, 'text-amber-600 dark:text-amber-400'], ['空闲', activeSummary.free || 0, ''], ['异常', activeSummary.abnormal || 0, 'text-destructive']].map(([label, value, tone]) => <div key={label} className="min-w-[60px]"><span className="text-[11px] text-muted-foreground">{label}</span><strong className={`mt-1 block font-mono text-xl font-medium tabular-nums ${tone}`}>{value}</strong></div>)}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-[18px] pb-1 pt-3"><div className="flex h-9 items-center rounded-md border border-border bg-muted/30 p-0.5" aria-label="地址显示方式">{[['grid', '方格'], ['table', '列表']].map(([key, label]) => <Button key={key} type="button" variant={view === key ? 'secondary' : 'ghost'} size="sm" className="h-7 px-3 text-xs" aria-pressed={view === key} onClick={() => { setView(key); if (key === 'grid') { setSearch(''); setKeyword(''); setStatus('') } setPage(1) }}>{label}</Button>)}</div>{view === 'table' ? <span className="text-[11px] text-muted-foreground">查询已登记地址；方格视图展示完整 CIDR。</span> : null}<div className="ml-auto flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground" aria-label="地址状态图例">{[['已占用', 'border-primary/60 bg-primary/10'], ['空闲', 'border-border bg-muted/30'], ['预留', 'border-dashed border-amber-500/60 bg-amber-500/10'], ['异常', 'border-destructive/60 bg-destructive/10'], ['网络 / 广播（只读）', 'border-dashed border-border bg-muted/60']].map(([label, color]) => <span key={label} className="flex items-center gap-1"><i className={`h-2 w-2 rounded-[1px] border ${color}`} />{label}</span>)}</div></div>
      {(query.error || summary.error || subnets.error || assets.error) && <ErrorBanner message={query.error || summary.error || subnets.error || assets.error} onRetry={refresh} />}
      {view === 'table' ? <DataTable rows={rows} loading={query.loading} columns={columns} /> : <div className="min-h-0 flex-1 overflow-auto px-[18px] pb-3 pt-2">{query.loading ? <p className="text-xs text-muted-foreground">加载中...</p> : !rows.length ? <p className="py-8 text-center text-xs text-muted-foreground">{subnet ? '没有匹配地址' : '请选择或新增地址池'}</p> : <div data-ipam-address-grid className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-[5px]">{rows.map((row) => {
        const presentation = ipAddressPresentation(row)
        const used = presentation.kind === 'used'
        const abnormal = presentation.kind === 'abnormal'
        const special = presentation.kind === 'special'
        const address = String(row.ip || '').split('.').pop()
        return <button type="button" key={row.id || row.ip} onClick={() => setDetail(row)} title={[row.ip, presentation.label, row.owner_name, row.account, row.department, row.room, row.remark].filter(Boolean).join(' · ')} aria-label={`${row.ip} ${presentation.label}`} className={`h-9 min-w-0 rounded border px-1 text-center font-mono text-xs tabular-nums hover:ring-1 hover:ring-inset hover:ring-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${special ? 'border-dashed border-border/70 bg-muted/60 text-muted-foreground' : abnormal ? 'border-destructive/50 bg-destructive/10 text-destructive' : used ? 'border-primary/45 bg-primary/10 text-primary' : reservedIP(row) ? 'border-dashed border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-border/70 bg-muted/25 text-foreground'}`}><span data-ipam-address-value>{address}</span></button>
      })}</div>}</div>}
      {(view === 'table' || subnet) && <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} pageSizes={view === 'grid' ? [96, 128, 256, 500] : [20, 50, 100, 256]} onChange={(p, size) => { setPage(p); setPageSize(size) }} />}
      </>}
    </section>
    {settings && <SubnetMaintenance open onOpenChange={(next) => { if (!next) setSettings(null) }} onDirtyChange={setSubnetDirty} onBusyChange={setSubnetBusy} initialCreate={settings.initialCreate} initialSubnetID={settings.initialSubnetID} networkTypes={(networkTypes.data || []).map((item) => item.name)} onChanged={({ name, previousName, removed, created }) => {
      if (created || !subnet || subnet === previousName) { setSubnet(removed ? '' : name); setPage(1); setDetail(null) }
      refresh()
    }} />}
    {suggesting && <SubnetSuggestions open onOpenChange={(next) => { if (!next) setSuggesting(false) }} networkTypes={(networkTypes.data || []).map((item) => item.name)} onCreated={() => refresh()} />}
    <DetailSheet open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }} title="IP 地址详情" actions={detail && !specialIP(detail) && <>{!usedIP(detail) && <Button variant="outline" size="sm" onClick={() => reservedIP(detail) ? clearReservation(detail) : open(detail, 'reserve')}>{reservedIP(detail) ? '取消预留' : '预留'}</Button>}<Button size="sm" onClick={() => usedIP(detail) ? setConfirmation({ action: 'release', record: detail }) : open(detail, 'allocate')}>{usedIP(detail) ? '释放' : '分配'}</Button></>}>{detail && <IPDetails record={detail} onNavigate={(target) => { setDetail(null); onNavigate(target) }} />}</DetailSheet>
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) closeEditor() }} title={editor?.mode === 'allocate' ? `分配 ${editor.record.ip}` : editor?.mode === 'reserve' ? `预留 ${editor.record.ip}` : editor?.record.id ? '编辑 IP' : '新增 IP'} busy={action.busy} onSubmit={() => action.run(async () => {
      const fields = editor.mode === 'allocate' ? allocateFields : editor.mode === 'reserve' ? [{ key: 'remark', label: '预留用途', type: 'textarea' }] : editFields
      validateFields(fields, values)
      if (editor.mode === 'allocate') {
        let id = editor.record.id
        if (!id) id = (await api.createIP({ subnet: editor.record.subnet, ip: editor.record.ip, status: '空闲' })).id
        await api.allocateIP(id, { asset_id: values.asset_id, owner_type: values.owner_type, ip_field: values.ip_field, remark: values.remark })
        await syncFollowingNetcattyHosts(api, { assetType: values.owner_type, assetId: values.asset_id, hosts, updateHostAddress })
      } else if (editor.mode === 'reserve') {
        if (editor.record.id) await api.updateIP(editor.record.id, { ...editor.record, status: '保留', remark: values.remark })
        else await api.createIP({ subnet: editor.record.subnet, ip: editor.record.ip, status: '保留', remark: values.remark })
      } else if (editor.record.id) await api.updateIP(editor.record.id, { ...editor.record, ...values })
      else await api.createIP({ ...values, status: '空闲' })
      setEditor(null); setDetail(null); refresh()
    }, editor?.mode === 'allocate' ? 'IP 已关联资产' : editor?.mode === 'reserve' ? 'IP 已预留' : '已保存 IP')}><Fields fields={editor?.mode === 'allocate' ? allocateFields : editor?.mode === 'reserve' ? [{ key: 'remark', label: '预留用途', type: 'textarea' }] : editFields} value={values} onChange={setValues} />{editor?.mode === 'allocate' && selectedAsset && <DefinitionList items={[["资产类型", ownerTypeLabel(selectedAsset.owner_type)], ['资产名称', selectedAsset.owner_name], ['负责人', selectedAsset.user_name || selectedAsset.owner], ['部门', selectedAsset.department], ['位置', selectedAsset.room || selectedAsset.location]]} />}</ModalForm>
    <ConfirmDialog open={!!confirmation} onOpenChange={(v) => { if (!v) setConfirmation(null) }} title={confirmation?.action === 'release' ? '释放 IP' : '删除 IP'} message={`确认处理 ${confirmation?.record.ip || ''}？${confirmation?.action === 'release' ? '释放后会同时清除设备资产中的对应 IP。' : '该操作会删除 IP 池记录。'}`} confirmLabel="确认" destructive busy={action.busy} onConfirm={() => action.run(async () => { if (confirmation.action === 'release') await api.releaseIP(confirmation.record.id); else await api.deleteIP(confirmation.record.id); setConfirmation(null); setDetail(null); refresh() }, '操作完成')} />
    <ConfirmDialog open={!!pendingAddress} onOpenChange={(next) => { if (!next) setPendingAddress(null) }} title="设备修改尚未保存" message="切换到地址池会放弃当前设备的未保存修改，是否继续？" confirmLabel="放弃修改并切换" destructive busy={rackBusyState} onConfirm={() => { if (rackBusy.current) return; enterAddressView(pendingAddress); setPendingAddress(null) }} />
  </div>
}
