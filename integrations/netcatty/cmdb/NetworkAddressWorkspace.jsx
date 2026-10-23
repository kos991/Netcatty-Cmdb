import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ListFilter, Lock, MapPin, Pencil, Plus, Sparkles, Trash2, Unlock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { toast } from '@/components/ui/toast'
import { VaultHeaderSearch, VaultPageHeader } from '@/components/vault/VaultPageHeader'
import { api } from './api'
import { allPages, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { subnetSelectorGroups } from './ipamLayoutModel'
import { ipAddressPresentation, isCloudDevice } from './state'
import { ActionIcon, DataTable, DefinitionList, ErrorBanner, ModalForm, SearchBox, SelectControl, StatusPill, Toolbar } from './ui'
import SubnetMaintenance from './SubnetMaintenance'
import SubnetSuggestions from './SubnetSuggestions'
import AssetTransferMenu from './AssetTransferMenu'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { syncFollowingNetcattyHosts } from './NetcattyConnection'
import './network-address.css'

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
  // 历史导入可能把终端误标为 infrastructure；按占用对象名称/编码校正到真实归属，
  // 避免跳到另一张表后按同一 ID 命中别的记录或查不到设备。
  const declared = record.owner_type === 'terminal' ? { tableKey: 'assets', id: record.owner_id } : record.owner_type === 'application' ? { tableKey: 'server_apps', id: record.owner_id } : record.owner_type === 'server' ? { tableKey: 'servers', id: record.owner_id } : record.owner_type === 'infrastructure' ? { tableKey: 'cmdb_assets', id: record.owner_id } : null
  const looksTerminal = /终端|云桌面|云盒|盒子/.test(String(record.owner_name || '')) || /^\d{16}$/.test(String(record.asset_code || ''))
  const target = record.owner_type === 'infrastructure' && looksTerminal ? { tableKey: 'assets', id: record.owner_id, keyword: record.asset_code } : declared
  const presentation = ipAddressPresentation(record)
  return <div className="space-y-4"><DefinitionList items={[
    ['IP 地址', record.ip], ['网段', record.subnet], ['分段', record.segment_name], ['楼层', record.segment_floor], ['状态', presentation.label], ['占用类型', ownerTypeLabel(record.owner_type)], ['占用对象', record.owner_name || record.asset_code], ['部门', record.department], ['位置', record.room], ['使用人 / 负责人', record.account || record.asset_user], ['备注', record.remark],
  ]} />{record.applications?.length ? <div className="space-y-1"><p className="text-xs text-muted-foreground">使用此地址的业务系统</p>{record.applications.map(app => <Button key={app.id} variant="link" size="sm" onClick={() => onNavigate({ tableKey: 'server_apps', id: app.id })}>{app.app_name}</Button>)}</div> : null}{specialIP(record) && <p className="text-xs text-muted-foreground">该地址由网段 CIDR 识别，不可预留或分配。</p>}{target ? <Button variant="outline" size="sm" onClick={() => onNavigate(target)}>查看{ownerTypeLabel(target.tableKey === 'assets' ? 'terminal' : record.owner_type)}</Button> : !specialIP(record) ? <p className="text-xs text-muted-foreground">当前地址未关联资产</p> : null}</div>
}

export default function NetworkAddressWorkspace({ focusTarget, navigation, onNavigate, onDirtyChange }) {
  const [subnet, setSubnet] = useState('')
  const [segmentID, setSegmentID] = useState(0)
  const [expandedSegments, setExpandedSegments] = useState('')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(256)
  const [view, setView] = useState('grid')
  const initialValues = useRef({})
  const [subnetDirty, setSubnetDirty] = useState(false)
  const [subnetBusy, setSubnetBusy] = useState(false)
  const [suggestionDirty, setSuggestionDirty] = useState(false)
  const [suggestionBusy, setSuggestionBusy] = useState(false)
  const dirtyListener = useRef(onDirtyChange)
  dirtyListener.current = onDirtyChange
  const [settings, setSettings] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [subnetMenuOpen, setSubnetMenuOpen] = useState(false)
  const [subnetPickerOpen, setSubnetPickerOpen] = useState(false)
  const [subnetPickerKeyword, setSubnetPickerKeyword] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [editor, setEditor] = useState(null)
  const [values, setValues] = useState({})
  const [detail, setDetail] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const addressPane = useRef(null)
  const subnets = useQuery(loadSubnets, [])
  const summary = useQuery(loadSummary)
  const assets = useQuery(loadAssets, [])
  const networkTypes = useDirectory(loadNetworkTypes)
  const listLoader = useCallback(() => api.ipEntries({ subnet, segment_id: segmentID || undefined, keyword: search, status, page, page_size: pageSize }), [subnet, segmentID, search, status, page, pageSize])
  const visualLoader = useCallback(() => subnet ? api.ipVisualization({ subnet, segment_id: segmentID || undefined, page, page_size: pageSize }) : Promise.resolve({ list: [], total: 0 }), [subnet, segmentID, page, pageSize])
  const listQuery = useQuery(listLoader)
  const visualQuery = useQuery(visualLoader)
  const query = view === 'grid' ? visualQuery : listQuery
  const locateSelected = useCallback(() => {
    const selected = addressPane.current?.querySelector('[data-ipam-selected="true"]')
    if (!selected) return
    const row = selected.closest('tr')
    const scroller = row ? row.closest('table').parentElement : selected.closest('[data-ipam-grid-scroll]')
    if (!scroller) return
    const bounds = scroller.getBoundingClientRect()
    const target = (row || selected).getBoundingClientRect()
    const visibleTop = bounds.top + (row ? 36 : 4)
    const top = target.top < visibleTop ? scroller.scrollTop + target.top - visibleTop : target.bottom > bounds.bottom - 4 ? scroller.scrollTop + target.bottom - bounds.bottom + 4 : scroller.scrollTop
    const cell = selected.getBoundingClientRect()
    const left = cell.left < bounds.left + 4 ? scroller.scrollLeft + cell.left - bounds.left - 4 : cell.right > bounds.right - 4 ? scroller.scrollLeft + cell.right - bounds.right + 4 : scroller.scrollLeft
    scroller.scrollTo({ top, left })
  }, [])
  useEffect(() => {
    if (!detail || query.loading) return undefined
    const frame = requestAnimationFrame(locateSelected)
    const observer = new ResizeObserver(locateSelected)
    if (addressPane.current) observer.observe(addressPane.current)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [detail, query.loading, view, locateSelected])
  const action = useAction()
  const editorDirty = !!editor && JSON.stringify(values) !== JSON.stringify(initialValues.current)
  const busy = action.busy || subnetBusy || suggestionBusy
  useEffect(() => { dirtyListener.current?.(editorDirty || subnetDirty || suggestionDirty, busy) }, [editorDirty, subnetDirty, suggestionDirty, busy])
  useEffect(() => () => dirtyListener.current?.(false, false), [])
  const closeEditor = () => { if (!action.busy && (!editorDirty || window.confirm('IP 修改尚未保存，是否放弃修改？'))) setEditor(null) }
  const mayChangePool = () => {
    if (busy) return false
    if ((editorDirty || subnetDirty || suggestionDirty) && !window.confirm('地址池修改尚未保存，是否放弃修改并继续？')) return false
    setEditor(null); setSettings(null); setSuggesting(false)
    setSubnetDirty(false); setSuggestionDirty(false)
    return true
  }
  const { hosts, updateHostAddress } = useNetcattyDirectory()
  useEffect(() => {
    if (!subnet && !subnets.loading && !subnets.error && subnets.data?.length) setSubnet(subnets.data[0].name)
  }, [subnet, subnets.data, subnets.loading, subnets.error])
  useEffect(() => {
    if (focusTarget?.tableKey !== 'ip_pool') return undefined
    let active = true
    allPages(api.ipEntries, { subnet: focusTarget.subtitle || focusTarget.data?.网段 || '', keyword: focusTarget.title || '' }).then((records) => {
      if (!active) return
      const record = records.find((item) => focusTarget.id != null ? String(item.id) === String(focusTarget.id) : item.ip === focusTarget.title)
      if (!record) { toast.error('关联的 IP 地址不存在或已移出当前项目'); return }
      setSubnet(record.subnet)
      setSegmentID(0)
      setKeyword(record.ip)
      setSearch(record.ip)
      setStatus('')
      setPage(1)
      setView('table')
      setDetail(record)
    }).catch((error) => { if (active) toast.error(error.message) })
    return () => { active = false }
  }, [focusTarget])
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
        label: `${ownerTypeLabel(item.owner_type)} · ${item.owner_name}${item.asset_code && item.asset_code !== item.owner_name ? ` / ${item.asset_code}` : ''}${item.mgmt_ip || item.ip || item.server_biz_ip || item.service_ip ? ` · ${item.mgmt_ip || item.ip || item.server_biz_ip || item.service_ip}` : ''}`,
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
  const isSelected = row => detail?.ip === row.ip && detail?.subnet === row.subnet
  const columns = [
    { key: 'ip', label: 'IP 地址', render: (value, row) => <Button data-ipam-selected={isSelected(row) ? 'true' : undefined} aria-pressed={isSelected(row)} variant="link" className="h-auto p-0 font-mono" onClick={() => setDetail(row)}>{value}</Button> },
    { key: 'status', label: '状态', render: (_, row) => { const presentation = ipAddressPresentation(row); return <StatusPill tone={presentation.kind === 'special' ? 'neutral' : presentation.kind === 'used' ? 'info' : presentation.kind === 'free' ? 'neutral' : 'warning'}>{presentation.label}</StatusPill> } },
    { key: 'owner_type', label: '占用类型', render: value => ownerTypeLabel(value) || '-' },
    ...textFields([['segment_name', '分段'], ['segment_floor', '楼层'], ['subnet', '网段'], ['owner_name', '占用对象'], ['account', '使用人'], ['department', '部门'], ['room', '位置']]),
    { key: 'actions', label: '操作', render: (_, row) => specialIP(row) ? null : <div className="flex">
      <ActionIcon label="编辑 IP" onClick={() => open(row)}><Pencil size={15} /></ActionIcon>
      {!usedIP(row) && !reservedIP(row) && <ActionIcon label="预留 IP" onClick={() => open(row, 'reserve')}><Lock size={15} /></ActionIcon>}
      {reservedIP(row) && <ActionIcon label="取消预留" onClick={() => clearReservation(row)}><Unlock size={15} /></ActionIcon>}
      <ActionIcon label={usedIP(row) ? '释放 IP' : '分配 IP'} onClick={() => usedIP(row) ? setConfirmation({ action: 'release', record: row }) : open(row, 'allocate')}>{usedIP(row) ? <Unlock size={15} /> : <Plus size={15} />}</ActionIcon>
      <ActionIcon label="删除 IP" danger onClick={() => setConfirmation({ action: 'delete', record: row })}><Trash2 size={15} /></ActionIcon>
    </div> },
  ]
  const rows = query.error ? [] : query.data?.list || []
  const activeSubnet = (subnets.data || []).find((item) => item.name === subnet)
  const activeSegments = activeSubnet?.segments || []
  const selectedSegment = activeSegments.find((item) => Number(item.id) === Number(segmentID))
  const activeSummary = selectedSegment || summary.data?.subnets?.find((item) => item.subnet === subnet) || {}
  const activeNetwork = activeSubnet || activeSummary
  const subnetGroups = subnetSelectorGroups(subnets.data || [], summary.data?.subnets || [], subnetPickerKeyword)
  return <div data-ipam-page="network" className="cmdb-theme-scope network-address-workspace flex h-full min-h-0 min-w-0 flex-col">
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <VaultPageHeader dataSection="cmdb-ipam-header" contentClassName="h-auto min-h-[54px] flex-wrap gap-2.5 px-3.5 py-[9px]">
          <Dropdown open={subnetMenuOpen} onOpenChange={setSubnetMenuOpen}><DropdownTrigger asChild><Button data-ipam-add-subnet type="button" className="cmdb-primary-action h-[34px] gap-1.5 text-xs"><Plus size={15} />新增地址池<ChevronDown size={14} /></Button></DropdownTrigger><DropdownContent align="start" sideOffset={8} className="w-44 p-1">
            {[['create', '新增地址池', Plus], ['maintain', '维护其他地址池', Pencil], ['suggest', '从资产 IP 生成', Sparkles]].map(([key, label, Icon]) => <button key={key} data-ipam-subnet-menu-item={key} type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary" onClick={() => { if (!mayChangePool()) return; setSubnetMenuOpen(false); if (key === 'suggest') setSuggesting(true); else setSettings(key === 'create' ? { initialCreate: true } : { initialSubnetID: activeSubnet?.id }) }}><Icon size={14} />{label}</button>)}
            <button type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary" onClick={() => { setSubnetMenuOpen(false); open() }}><Plus size={14} />补录 IP</button>
          </DropdownContent></Dropdown>
        <Dropdown open={subnetPickerOpen} onOpenChange={(next) => { setSubnetPickerOpen(next); if (!next) setSubnetPickerKeyword('') }}>
          <DropdownTrigger asChild><Button data-ipam-subnet-selector type="button" variant="outline" className="h-[34px] min-w-[180px] max-w-[280px] shrink-0 justify-between gap-2 rounded-[7px] text-xs"><span className="truncate">地址池{subnet ? ` · ${subnet}` : ''}</span><ChevronDown size={14} className="shrink-0" /></Button></DropdownTrigger>
          <DropdownContent align="start" sideOffset={8} className="w-[min(360px,calc(100vw-32px))] p-2">
            <SearchBox value={subnetPickerKeyword} onChange={setSubnetPickerKeyword} placeholder="搜索地址池、CIDR、VLAN 或 VNI" className="min-w-0 max-w-none" />
            <div className="mt-2 max-h-64 overflow-y-auto">{subnets.loading ? <p className="px-2 py-5 text-center text-xs text-muted-foreground">加载地址池...</p> : subnets.error ? <ErrorBanner message={subnets.error} onRetry={subnets.reload} /> : subnetGroups.length ? subnetGroups.map((group) => <section key={group.category} data-ipam-subnet-group={group.category}>
              <h3 className="sticky top-0 bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">{group.category}</h3>
              {group.items.map((item) => <div key={item.id || item.value} className="mb-1 rounded-md">
                <div className={`flex items-stretch rounded-md hover:bg-secondary ${subnet === item.value ? 'bg-[color-mix(in_srgb,var(--cmdb-accent)_12%,transparent)] text-[var(--cmdb-accent)]' : ''}`}>
                  <button type="button" data-ipam-subnet-option={item.value} onClick={() => { if (!mayChangePool()) return; setSubnet(item.value); setSegmentID(0); setPage(1); setDetail(null); setSubnetPickerOpen(false); setSubnetPickerKeyword('') }} className="min-w-0 flex-1 px-2.5 py-2 text-left"><strong className="block truncate text-xs" title={item.label}>{item.label}</strong><span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={item.description}>{item.description}</span></button>
                  {item.segmentNames ? <button type="button" aria-label={`${item.label} 分段设置`} aria-expanded={expandedSegments === item.value} onClick={() => setExpandedSegments((current) => current === item.value ? '' : item.value)} className="grid w-9 shrink-0 place-items-center text-muted-foreground hover:text-foreground" title={`${item.segmentCount} 个分段，点击展开`}><ChevronDown size={14} className={expandedSegments === item.value ? 'rotate-180 transition-transform' : 'transition-transform'} /></button> : null}
                </div>
                {expandedSegments === item.value && item.segments?.length ? <div data-ipam-segment-preview className="ml-2 border-l border-border/70 pl-2 py-1">{item.segments.map((segment) => <button key={segment.name + segment.start_ip} type="button" onClick={() => { if (!mayChangePool()) return; setSubnet(item.value); setSegmentID(Number(segment.id)); setPage(1); setDetail(null); setSubnetPickerOpen(false); setSubnetPickerKeyword('') }} className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[11px] hover:bg-secondary"><span className="min-w-0 truncate">{segment.name}{segment.floor ? ` · ${segment.floor}` : ''}</span><span className="shrink-0 tabular-nums text-muted-foreground">{segment.start_ip.split('.').pop()}–{segment.end_ip.split('.').pop()}</span></button>)}</div> : null}
              </div>)}
            </section>) : <p className="px-2 py-5 text-center text-xs text-muted-foreground">暂无匹配地址池</p>}</div>

            <Button data-ipam-edit-subnet type="button" variant="ghost" className="mt-2 h-[34px] w-full justify-start gap-2 border-t border-border text-xs" disabled={!activeSubnet?.id || subnets.loading || !!subnets.error} onClick={() => { if (!mayChangePool()) return; setSubnetPickerOpen(false); setSettings({ initialSubnetID: activeSubnet.id }) }}><Pencil size={14} />编辑当前地址池</Button>
          </DropdownContent>
        </Dropdown>
          <VaultHeaderSearch data-ipam-search value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setSearch(keyword.trim()); if (keyword.trim()) setView('table'); setPage(1); setDetail(null) } }} placeholder="搜索 IP、资产、人员或部门" className="min-w-[180px] max-w-[520px] flex-[1_1_240px]" inputClassName="h-[34px] rounded-[7px] text-[13px]" />
        <span className="min-w-0 flex-1" />
          <Dropdown open={filterOpen} onOpenChange={setFilterOpen}>
            <DropdownTrigger asChild><Button type="button" variant={status || search ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" aria-label="查询地址" title="查询地址"><ListFilter size={16} /></Button></DropdownTrigger>
            <DropdownContent align="end" className="w-64 space-y-3 p-3">
              <p className="text-xs font-medium">地址查询</p>
              <SelectControl aria-label="地址状态" className="w-full" value={status} onChange={(next) => { setStatus(next); if (next) setView('table'); setPage(1); setDetail(null) }} options={choices(['在用', '空闲', '保留', '异常'], '全部状态')} />
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => { setKeyword(''); setSearch(''); setStatus(''); setPage(1); setDetail(null); setFilterOpen(false) }}>重置</Button><Button type="button" size="sm" onClick={() => { setSearch(keyword.trim()); if (keyword.trim() || status) setView('table'); setPage(1); setDetail(null); setFilterOpen(false) }}>查询</Button></div>
            </DropdownContent>
          </Dropdown>
          <AssetTransferMenu importTitle="导入 IP" importer={api.importIPs} onImported={refresh} exporter={() => api.exportIPs({ subnet, segment_id: segmentID || undefined, keyword: search, status })} />
          <span aria-hidden="true" className="ml-1 mr-0 h-4 w-px shrink-0 bg-border" />
          {navigation}
      </VaultPageHeader>
      <div className="grid shrink-0 grid-cols-2 border-b border-border/70 lg:min-h-[81px] lg:grid-cols-[minmax(220px,1.8fr)_repeat(5,minmax(68px,.55fr))]">
        <div className="col-span-2 border-b border-border/70 px-4 py-2 lg:col-span-1 lg:border-b-0 lg:border-r">
          <strong className="text-sm font-semibold">{subnet || '请选择地址池'}</strong>
          <p data-subnet-network-fields className="mt-1 font-mono text-[11px] text-muted-foreground">{activeNetwork.cidr || activeNetwork.prefix || 'CIDR 未配置'} · 网关：{activeNetwork.gateway || '未配置'} · VLAN：{activeNetwork.vlan || '未配置'}{activeNetwork.vni ? ` · VNI：${activeNetwork.vni}` : ''}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{activeSegments.length ? `${activeSegments.length} 个分段 · 已规划 ${activeSegments.reduce((total, row) => total + (row.total || 0), 0)} 个可用地址` : '尚未规划地址分段'}</p>
        </div>
        {[['地址总数', visualQuery.loading || visualQuery.error ? '—' : visualQuery.data?.total ?? 0], ['已占用', activeSummary.used || 0], ['已预留', activeSummary.reserved || 0], ['空闲', activeSummary.free || 0], ['异常', activeSummary.abnormal || 0]].map(([label, value]) => <div key={label} className="border-r border-border/70 px-3 py-2 last:border-r-0"><span className="text-[10px] text-muted-foreground">{label}</span><strong className="mt-0.5 block font-mono text-base tabular-nums">{value}</strong></div>)}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2" aria-label="地址分段筛选"><span className="text-xs text-muted-foreground">地址分段</span><SelectControl aria-label="地址分段" className="min-w-[180px] max-w-[360px]" value={segmentID} onChange={(value) => { setSegmentID(Number(value)); setPage(1); setDetail(null) }} options={[{ value: 0, label: '全部分段 / 整个地址池' }, ...activeSegments.map((item) => ({ value: item.id, label: `${item.name}${item.floor ? ` · ${item.floor}` : ''} · ${item.start_ip}–${item.end_ip}` }))]} />{selectedSegment && <span className="text-xs text-muted-foreground">已用 {selectedSegment.used} · 预留 {selectedSegment.reserved} · 空闲 {selectedSegment.free} · 异常 {selectedSegment.abnormal} · {selectedSegment.remark || '无备注'}</span>}</div>
      <Toolbar><div role="group" aria-label="地址显示方式" className="inline-flex overflow-hidden rounded-md border border-border"><Button type="button" variant="ghost" size="sm" aria-pressed={view === 'grid'} className={`rounded-none border-r border-border text-xs ${view === 'grid' ? 'bg-[color-mix(in_srgb,var(--cmdb-accent)_12%,transparent)] text-[var(--cmdb-accent)]' : ''}`} onClick={() => { if (view === 'grid') return; setView('grid'); setSearch(''); setKeyword(''); setStatus(''); setPage(1); setDetail(null) }}>方格</Button><Button type="button" variant="ghost" size="sm" aria-pressed={view === 'table'} className={`rounded-none text-xs ${view === 'table' ? 'bg-[color-mix(in_srgb,var(--cmdb-accent)_12%,transparent)] text-[var(--cmdb-accent)]' : ''}`} onClick={() => { if (view === 'table') return; setView('table'); setPage(1); setDetail(null) }}>列表</Button></div><div className="ml-auto flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm border border-primary/60 bg-primary/15" />已占用</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm border border-border/70 bg-transparent" />空闲</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm border border-dashed border-amber-500/60 bg-amber-500/10" />预留</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm border border-destructive/70 bg-destructive/10" />异常</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm border border-dashed border-border/70 bg-muted/30" />网络 / 广播（只读）</span></div></Toolbar>
      {(query.error || summary.error || subnets.error || assets.error) && <ErrorBanner message={query.error || summary.error || subnets.error || assets.error} onRetry={refresh} />}
      <div data-ipam-address-layout className={`network-address-layout${detail ? ' has-ip-detail' : ''}`}>
      <div ref={addressPane} className="flex min-h-0 min-w-0 flex-col overflow-hidden [&_tr:has([data-ipam-selected=true])>td]:bg-[color-mix(in_srgb,var(--cmdb-accent)_12%,transparent)] [&_tr:has([data-ipam-selected=true])]:ring-2 [&_tr:has([data-ipam-selected=true])]:ring-inset [&_tr:has([data-ipam-selected=true])]:ring-[var(--cmdb-accent)]">
      {view === 'table' ? <DataTable dense rows={rows} loading={query.loading} columns={columns} /> : <div data-ipam-grid-scroll className="min-h-0 flex-1 overflow-auto p-3">{query.loading ? <p className="text-sm text-muted-foreground">加载中...</p> : !rows.length ? <p className="p-6 text-center text-xs text-muted-foreground">没有匹配地址</p> : <>
        {query.data?.segments?.length ? (
          <div className="space-y-3">
            {query.data.segments.map(seg => (
              <div key={seg.id} className="space-y-1 rounded-md border border-border/20 bg-secondary/30 p-2">
                <button type="button" className="flex w-full items-center justify-between gap-3 text-left text-xs font-medium hover:text-foreground" onClick={() => { setSegmentID(Number(seg.id)); setPage(1); setDetail(null) }}>
                  <span className="flex-1 truncate font-semibold">{seg.name}{seg.floor ? ` · ${seg.floor}` : ''}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{seg.start_ip}–{seg.end_ip}</span>
                </button>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-[5px]">
                  {seg.entries?.map((row) => {
                    const presentation = ipAddressPresentation(row)
                    const used = presentation.kind === 'used'
                    const abnormal = presentation.kind === 'abnormal'
                    const special = presentation.kind === 'special'
                    const address = String(row.ip || '').split('.').pop()
                    return <button type="button" key={row.id || row.ip} data-ipam-selected={isSelected(row) ? 'true' : undefined} aria-pressed={isSelected(row)} onClick={() => setDetail(row)} title={[row.ip, presentation.label, row.owner_name, row.account, row.department, row.room, row.remark].filter(Boolean).join(' - ')} aria-label={`${row.ip} ${presentation.label}`} className={`h-9 min-w-0 rounded border px-1 text-center font-mono text-xs tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${isSelected(row) ? 'ring-2 ring-[var(--cmdb-accent)] ring-offset-1 ring-offset-background' : ''} ${special ? 'border-dashed border-border/70 bg-muted/30 text-muted-foreground' : abnormal ? 'border-destructive/70 bg-destructive/10 text-destructive' : used ? 'border-primary/60 bg-primary/15 text-primary' : 'border-border/70 bg-transparent text-muted-foreground hover:bg-muted/60'}`}>{address}</button>
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div data-ipam-address-grid className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-[5px]">
            {rows.map((row) => {
              const presentation = ipAddressPresentation(row)
              const used = presentation.kind === 'used'
              const abnormal = presentation.kind === 'abnormal'
              const special = presentation.kind === 'special'
              const address = String(row.ip || '').split('.').pop()
              return <button type="button" key={row.id || row.ip} data-ipam-selected={isSelected(row) ? 'true' : undefined} aria-pressed={isSelected(row)} onClick={() => setDetail(row)} title={[row.ip, presentation.label, row.owner_name, row.account, row.department, row.room, row.remark].filter(Boolean).join(' - ')} aria-label={`${row.ip} ${presentation.label}`} className={`h-9 min-w-0 rounded border px-1 text-center font-mono text-xs tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${isSelected(row) ? 'ring-2 ring-[var(--cmdb-accent)] ring-offset-1 ring-offset-background' : ''} ${special ? 'border-dashed border-border/70 bg-muted/30 text-muted-foreground' : abnormal ? 'border-destructive/70 bg-destructive/10 text-destructive' : used ? 'border-primary/60 bg-primary/15 text-primary' : 'border-border/70 bg-transparent text-muted-foreground hover:bg-muted/60'}`}>{address}</button>
            })}
          </div>
        )}
      </>
      </div>
      {detail && <aside aria-label="IP 地址详情" className="cmdb-record-shell network-ip-detail flex min-h-0 min-w-0 flex-col bg-background">
        <header className="cmdb-record-header"><div className="min-w-0 flex-1"><h2 className="break-all font-mono text-sm font-semibold">{detail.ip}</h2><p className="mt-1 text-[11px] text-muted-foreground">IP 地址详情 · {ipAddressPresentation(detail).label}</p></div><ActionIcon label="关闭 IP 详情" onClick={() => setDetail(null)}><X size={16} /></ActionIcon></header>
        <div className="cmdb-record-body min-h-0 flex-1 overflow-auto"><p className="mb-3 text-[11px] text-muted-foreground">所选 IP 保持在左侧可见；蓝色边框标识当前地址。</p><section className="cmdb-record-section"><h3>地址资料</h3><IPDetails record={detail} onNavigate={target => { setDetail(null); onNavigate?.(target) }} /></section></div>
        <footer className="cmdb-record-footer"><Button variant="outline" size="sm" className="gap-1" onClick={locateSelected}><MapPin size={13} />定位所选 IP</Button><span className="min-w-0 flex-1" />{!specialIP(detail) && <>{!usedIP(detail) && <Button variant="outline" size="sm" disabled={action.busy} onClick={() => reservedIP(detail) ? clearReservation(detail) : open(detail, 'reserve')}>{reservedIP(detail) ? '取消预留' : '预留'}</Button>}<Button size="sm" className="cmdb-primary-action" disabled={action.busy} onClick={() => usedIP(detail) ? setConfirmation({ action: 'release', record: detail }) : open(detail, 'allocate')}>{usedIP(detail) ? '释放' : '分配'}</Button></>}</footer>
      </aside>}
      </div>
      {(view === 'table' || subnet) && (() => { const total = query.data?.total || 0; const pages = Math.max(1, Math.ceil(total / pageSize)); const sizes = view === 'grid' ? [96, 128, 256, 500] : [20, 50, 96, 100, 128, 256, 500]; return <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-2 text-xs text-muted-foreground"><span>{`共 ${total} 条 · 第 ${page} / ${pages} 页`}</span><div className="flex items-center gap-2"><SelectControl value={pageSize} onChange={(size) => { setPage(1); setPageSize(Number(size)); setDetail(null) }} options={sizes.map((size) => ({ value: size, label: `${size} 条 / 页` }))} className="w-[108px] min-w-0" /><Button type="button" variant="outline" className="h-[29px] px-3 text-[11px]" disabled={page <= 1} onClick={() => { setPage(page - 1); setDetail(null) }}>上一页</Button><Button type="button" variant="outline" className="h-[29px] px-3 text-[11px]" disabled={page >= pages} onClick={() => { setPage(page + 1); setDetail(null) }}>下一页</Button></div></footer> })()}
    </section>
    {settings && <SubnetMaintenance open onOpenChange={(next) => { if (!next && !subnetBusy) setSettings(null) }} onDirtyChange={setSubnetDirty} onBusyChange={setSubnetBusy} initialCreate={settings.initialCreate} initialSubnetID={settings.initialSubnetID} networkTypes={(networkTypes.data || []).map((item) => item.name)} onChanged={({ name, previousName, removed }) => {
      if (removed) { if (subnet === previousName) { setSubnet(''); setSegmentID(0); setPage(1); setDetail(null) } }
      else if (name) { setSubnet(name); setSegmentID(0); setPage(1); setDetail(null) }
      refresh()
    }} />}
    {suggesting && <SubnetSuggestions open onOpenChange={(next) => { if (!next) setSuggesting(false) }} onDirtyChange={setSuggestionDirty} onBusyChange={setSuggestionBusy} networkTypes={(networkTypes.data || []).map((item) => item.name)} onCreated={() => refresh()} />}
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
    }, editor?.mode === 'allocate' ? 'IP 已关联资产' : editor?.mode === 'reserve' ? 'IP 已预留' : '已保存 IP')}><section className="cmdb-record-section"><h3>{editor?.record.id ? '地址资料' : '新增地址'}</h3><Fields fields={editor?.mode === 'allocate' ? allocateFields : editor?.mode === 'reserve' ? [{ key: 'remark', label: '预留用途', type: 'textarea' }] : editFields} value={values} onChange={setValues} /></section>{editor?.mode === 'allocate' && selectedAsset ? <section className="cmdb-record-section"><h3>关联资产</h3><DefinitionList items={[["资产类型", ownerTypeLabel(selectedAsset.owner_type)], ['资产名称', selectedAsset.owner_name], ['负责人', selectedAsset.user_name || selectedAsset.owner], ['部门', selectedAsset.department], ['位置', selectedAsset.room || selectedAsset.location]]} /></section> : null}</ModalForm>
    <ConfirmDialog open={!!confirmation} onOpenChange={(v) => { if (!v) setConfirmation(null) }} title={confirmation?.action === 'release' ? '释放 IP' : '删除 IP'} message={`确认处理 ${confirmation?.record.ip || ''}？${confirmation?.action === 'release' ? '释放后会同时清除设备资产中的对应 IP。' : '该操作会删除 IP 池记录。'}`} confirmLabel="确认" destructive busy={action.busy} onConfirm={() => action.run(async () => { if (confirmation.action === 'release') await api.releaseIP(confirmation.record.id); else await api.deleteIP(confirmation.record.id); setConfirmation(null); setDetail(null); refresh() }, '操作完成')} />
  </div>
}
