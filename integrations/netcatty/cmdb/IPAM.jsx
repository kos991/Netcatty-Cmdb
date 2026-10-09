import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, List, Lock, Pencil, Plus, Settings2, Trash2, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { toast } from '@/components/ui/toast'
import { VaultHeaderSearch, VaultPageHeader, vaultHeaderSecondaryButtonClass } from '@/components/vault/VaultPageHeader'
import { api } from './api'
import { allPages, useAction, useDirectory, useQuery } from './hooks'
import { choices, Fields, textFields, validateFields } from './Fields'
import { subnetSelectorItems } from './ipamLayoutModel'
import { ipAddressPresentation, isCloudDevice } from './state'
import { ActionIcon, DataTable, DefinitionList, DetailSheet, ErrorBanner, ModalForm, Pagination, SearchBox, StatusPill, Toolbar } from './ui'
import SubnetMaintenance from './SubnetMaintenance'
import AssetTransferMenu from './AssetTransferMenu'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { syncFollowingNetcattyHosts } from './NetcattyConnection'

const loadSubnets = async () => (await api.ipSubnets()).list || []
const loadNetworkTypes = async () => (await api.config('network-types')).list || []
const loadSummary = () => api.ipSummary()
const loadAssets = async () => {
  const [terminals, infrastructure, applications] = await Promise.all([allPages(api.assets), allPages(api.infrastructure, { scope: 'infrastructure' }), allPages(api.apps)])
  return [
    ...terminals.map((asset) => ({ ...asset, key: `terminal:${asset.id}`, owner_type: 'terminal', owner_name: asset.asset_code || asset.device_type || `终端 #${asset.id}` })),
    ...infrastructure.map((asset) => ({ ...asset, key: `infrastructure:${asset.id}`, owner_type: 'infrastructure', owner_name: asset.name || asset.asset_code || `基础设施 #${asset.id}` })),
    ...applications.map((asset) => ({ ...asset, key: `application:${asset.id}`, owner_type: 'application', owner_name: asset.app_name || `业务系统 #${asset.id}` })),
  ]
}
const usedIP = (row) => ipAddressPresentation(row).kind === 'used'
const specialIP = (row) => ['网络地址', '广播地址'].includes(row?.status) || ipAddressPresentation(row).kind === 'special'
const reservedIP = (row) => row?.status === '保留'
const ownerTypeLabel = (value) => ({ terminal: '终端资产', infrastructure: '基础设施', server: '承载设备', application: '业务系统' }[value] || '')

function UsageBar({ value = 0 }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
}

function IPDetails({ record, onNavigate }) {
  const target = record.owner_type === 'terminal' ? { tableKey: 'assets', id: record.owner_id } : record.owner_type === 'application' ? { tableKey: 'server_apps', id: record.owner_id } : record.owner_type === 'server' ? { tableKey: 'servers', id: record.owner_id } : record.owner_type === 'infrastructure' ? { tableKey: 'cmdb_assets', id: record.owner_id } : null
  const presentation = ipAddressPresentation(record)
  return <div className="space-y-4"><DefinitionList items={[
    ['IP 地址', record.ip], ['网段', record.subnet], ['状态', presentation.label], ['占用类型', ownerTypeLabel(record.owner_type)], ['占用对象', record.owner_name || record.asset_code], ['部门', record.department], ['位置', record.room], ['使用人 / 负责人', record.account || record.asset_user], ['备注', record.remark],
  ]} />{record.applications?.length ? <div className="space-y-1"><p className="text-xs text-muted-foreground">使用此地址的业务系统</p>{record.applications.map(app => <Button key={app.id} variant="link" size="sm" onClick={() => onNavigate({ tableKey: 'server_apps', id: app.id })}>{app.app_name}</Button>)}</div> : null}{specialIP(record) && <p className="text-xs text-muted-foreground">该地址由网段 CIDR 识别，不可预留或分配。</p>}{target ? <Button variant="outline" size="sm" onClick={() => onNavigate(target)}>查看{ownerTypeLabel(record.owner_type)}</Button> : !specialIP(record) ? <p className="text-xs text-muted-foreground">当前地址未关联资产</p> : null}</div>
}

export default function IPAM({ focusTarget, onNavigate }) {
  const [subnet, setSubnet] = useState('')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(96)
  const [view, setView] = useState('grid')
  const [resourceView, setResourceView] = useState('ip')
  const [settings, setSettings] = useState(null)
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
  const listLoader = useCallback(() => api.ipEntries({ subnet, keyword: search, page, page_size: pageSize }), [subnet, search, page, pageSize])
  const visualLoader = useCallback(() => subnet ? api.ipVisualization({ subnet, page, page_size: pageSize }) : Promise.resolve({ list: [], total: 0 }), [subnet, page, pageSize])
  const listQuery = useQuery(listLoader)
  const visualQuery = useQuery(visualLoader)
  const query = view === 'grid' ? visualQuery : listQuery
  const action = useAction()
  const { hosts, updateHostAddress } = useNetcattyDirectory()
  useEffect(() => {
    if (!subnet && summary.data?.subnets?.length) setSubnet(summary.data.subnets[0].subnet)
  }, [subnet, summary.data])
  useEffect(() => {
    if (focusTarget?.tableKey !== 'ip_pool') return
    let active = true
    allPages(api.ipEntries, { subnet: focusTarget.subtitle || focusTarget.data?.网段 || '', keyword: focusTarget.title || '' }).then((rows) => {
      if (!active) return
      const record = rows.find((r) => r.id === focusTarget.id || r.ip === focusTarget.title)
      if (record) { setSubnet(record.subnet); setDetail(record) }
    }).catch((error) => { if (active) toast.error(error.message) })
    return () => { active = false }
  }, [focusTarget])
  const refresh = () => { listQuery.reload(); visualQuery.reload(); summary.reload(); subnets.reload(); assets.reload() }
  const open = (record = {}, mode = 'edit') => {
    if (specialIP(record)) return
    setEditor({ record, mode })
    setValues(mode === 'allocate' ? { asset_key: '', asset_id: 0, owner_type: '', ip_field: 'ip', remark: record.remark || '' } : { subnet, ...record, status: record.status || '空闲' })
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
        label: `${ownerTypeLabel(item.owner_type)} · ${item.owner_name}${item.mgmt_ip || item.ip || item.server_biz_ip ? ` · ${item.mgmt_ip || item.ip || item.server_biz_ip}` : ''}`,
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
  const activeSummary = summary.data?.subnets?.find((item) => item.subnet === subnet) || {}
  const subnetOptions = subnetSelectorItems(summary.data?.subnets || [])
  const visibleSubnetOptions = subnetOptions.filter((item) => !subnetPickerKeyword.trim() || `${item.label} ${item.description}`.toLowerCase().includes(subnetPickerKeyword.trim().toLowerCase()))
  return <div className="flex h-full min-h-0 flex-col">
    <section className="flex min-w-0 flex-1 flex-col">
      <VaultPageHeader dataSection="cmdb-ipam-header" contentClassName="h-auto min-h-14 flex-wrap">
        <Dropdown open={subnetMenuOpen} onOpenChange={setSubnetMenuOpen}><DropdownTrigger asChild><Button data-ipam-add-subnet type="button" variant="secondary" className={vaultHeaderSecondaryButtonClass}><Plus size={15} />新增网段<ChevronDown size={14} /></Button></DropdownTrigger><DropdownContent align="start" sideOffset={8} className="w-44 p-1">
          {[['create', '新增网段', Plus], ['maintain', '维护网段', Settings2]].map(([key, label, Icon]) => <button key={key} data-ipam-subnet-menu-item={key} type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary" onClick={() => { setSubnetMenuOpen(false); setSettings({ initialCreate: key === 'create' }) }}><Icon size={14} />{label}</button>)}
        </DropdownContent></Dropdown>
        <Dropdown open={subnetPickerOpen} onOpenChange={(open) => { setSubnetPickerOpen(open); if (!open) setSubnetPickerKeyword('') }}><DropdownTrigger asChild><Button data-ipam-subnet-selector type="button" variant="outline" className="min-w-[180px] max-w-[280px] justify-between gap-2 text-xs"><span className="truncate">{subnet || '选择网段'}</span><ChevronDown size={14} className="shrink-0" /></Button></DropdownTrigger><DropdownContent align="start" sideOffset={8} className="w-[min(360px,calc(100vw-32px))] p-2">
          <SearchBox value={subnetPickerKeyword} onChange={setSubnetPickerKeyword} placeholder="搜索网段、CIDR、VLAN 或 VNI" className="min-w-0 max-w-none" />
          <div className="mt-2 max-h-64 overflow-y-auto">{visibleSubnetOptions.length ? visibleSubnetOptions.map((item) => <button type="button" key={item.value} data-ipam-subnet-option={item.value} onClick={() => { setSubnet(item.value); setPage(1); setSubnetPickerOpen(false); setSubnetPickerKeyword('') }} className={`mb-1 w-full rounded-md px-2.5 py-2 text-left hover:bg-secondary ${subnet === item.value ? 'bg-primary/10' : ''}`}><strong className="block truncate text-xs">{item.label}</strong><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.description}</span></button>) : <p className="px-2 py-5 text-center text-xs text-muted-foreground">暂无匹配网段</p>}</div>
        </DropdownContent></Dropdown>
        <VaultHeaderSearch data-ipam-search value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setSearch(keyword.trim()); setPage(1) } }} placeholder="搜索 IP、资产、人员、部门、VLAN 或 VNI" className="min-w-[180px] max-w-[520px] flex-1" /><span className="min-w-0 flex-1" /><AssetTransferMenu importTitle="导入 IP" importer={api.importIPs} onImported={refresh} exporter={() => api.exportIPs({ subnet, keyword: search })} />
      </VaultPageHeader>
      <div className="flex h-12 items-center gap-2 border-b border-border/70 px-4">{[['ip', 'IP 地址'], ['vlan', 'VLAN'], ['vxlan', 'VXLAN']].map(([key, label]) => <Button key={key} variant={resourceView === key ? 'secondary' : 'ghost'} size="sm" onClick={() => setResourceView(key)}>{label}</Button>)}</div>
      <div className="grid grid-cols-2 border-b border-border/70 lg:grid-cols-[minmax(150px,1.4fr)_repeat(5,minmax(68px,.55fr))]"><div className="col-span-2 border-b border-border/70 px-4 py-3 lg:col-span-1 lg:border-b-0 lg:border-r"><strong className="text-sm">{subnet || '请选择网段'}</strong><p className="mt-1 font-mono text-[11px] text-muted-foreground">{activeSummary.cidr || activeSummary.prefix || '-'}{activeSummary.vlan ? ` · VLAN ${activeSummary.vlan}` : ''}{activeSummary.vni ? ` · VNI ${activeSummary.vni}` : ''}</p><div className="mt-2"><UsageBar value={activeSummary.usage_rate} /></div></div>{[['使用率', `${activeSummary.usage_rate || 0}%`], ['已占用', activeSummary.used || 0], ['预留', activeSummary.reserved || 0], ['空闲', activeSummary.free || 0], ['异常', activeSummary.abnormal || 0]].map(([label, value]) => <div key={label} className="border-r border-border/70 px-3 py-2.5 last:border-r-0"><span className="text-[10px] text-muted-foreground">{label}</span><strong className="mt-0.5 block font-mono text-base tabular-nums">{value}</strong></div>)}</div>
      {resourceView === 'ip' ? <Toolbar><Button variant="outline" size="sm" onClick={() => { setView(view === 'grid' ? 'table' : 'grid'); setPage(1) }}><List size={14} className="mr-1" />{view === 'grid' ? '列表视图' : '方格视图'}</Button><Button variant="outline" size="sm" onClick={() => open()}>补录 IP</Button></Toolbar> : null}
      {(query.error || summary.error || subnets.error || assets.error) && <ErrorBanner message={query.error || summary.error || subnets.error || assets.error} onRetry={refresh} />}
      {resourceView !== 'ip' ? <DataTable rows={(summary.data?.subnets || []).filter((item) => resourceView === 'vlan' ? item.vlan : item.vni)} columns={resourceView === 'vlan' ? textFields([['subnet', '网段'], ['cidr', 'CIDR'], ['vlan', 'VLAN'], ['purpose', '用途'], ['usage_rate', '使用率（%）']]) : textFields([['subnet', '网段'], ['cidr', 'CIDR'], ['vni', 'VXLAN VNI'], ['purpose', '用途'], ['usage_rate', '使用率（%）']])} /> : view === 'table' ? <DataTable rows={rows} loading={query.loading} columns={columns} /> : <div className="min-h-0 flex-1 overflow-auto p-3">{query.loading ? <p className="text-sm text-muted-foreground">加载中...</p> : <div data-ipam-address-grid className="grid grid-cols-[repeat(auto-fill,minmax(42px,1fr))] gap-1">{rows.map((row) => {
        const presentation = ipAddressPresentation(row)
        const used = presentation.kind === 'used'
        const abnormal = presentation.kind === 'abnormal'
        const special = presentation.kind === 'special'
        const address = String(row.ip || '').split('.').pop()
        return <button type="button" key={row.id || row.ip} onClick={() => setDetail(row)} title={[row.ip, presentation.label, row.account, row.department, row.room, row.remark].filter(Boolean).join(' · ')} aria-label={`${row.ip} ${presentation.label}`} className={`h-8 min-w-0 rounded border px-1 text-center font-mono text-[11px] tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${special ? 'border-dashed border-border/70 bg-muted/30 text-muted-foreground' : abnormal ? 'border-destructive/70 bg-destructive/20 text-destructive-foreground' : used ? 'border-primary/60 bg-primary/15 text-primary' : reservedIP(row) ? 'border-dashed border-border bg-transparent text-foreground hover:bg-muted/60' : 'border-border/70 bg-transparent text-muted-foreground hover:bg-muted/60'}`}><span data-ipam-address-value>{address}</span></button>
      })}</div>}</div>}
      {resourceView === 'ip' && (view === 'table' || subnet) && <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} pageSizes={view === 'grid' ? [96, 128, 256, 500] : [20, 50, 100, 256]} onChange={(p, size) => { setPage(p); setPageSize(size) }} />}
    </section>
    {settings && <SubnetMaintenance open onOpenChange={(next) => { if (!next) setSettings(null) }} initialCreate={settings.initialCreate} networkTypes={(networkTypes.data || []).map((item) => item.name)} onChanged={({ name, previousName, removed }) => {
      if (!subnet || subnet === previousName) { setSubnet(removed ? '' : name); setPage(1) }
      refresh()
    }} />}
    <DetailSheet open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }} title="IP 地址详情" actions={detail && !specialIP(detail) && <>{!usedIP(detail) && <Button variant="outline" size="sm" onClick={() => reservedIP(detail) ? clearReservation(detail) : open(detail, 'reserve')}>{reservedIP(detail) ? '取消预留' : '预留'}</Button>}<Button size="sm" onClick={() => usedIP(detail) ? setConfirmation({ action: 'release', record: detail }) : open(detail, 'allocate')}>{usedIP(detail) ? '释放' : '分配'}</Button></>}>{detail && <IPDetails record={detail} onNavigate={(target) => { setDetail(null); onNavigate(target) }} />}</DetailSheet>
    <ModalForm open={!!editor} onOpenChange={(v) => { if (!v) setEditor(null) }} title={editor?.mode === 'allocate' ? `分配 ${editor.record.ip}` : editor?.mode === 'reserve' ? `预留 ${editor.record.ip}` : editor?.record.id ? '编辑 IP' : '新增 IP'} busy={action.busy} onSubmit={() => action.run(async () => {
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
  </div>
}
