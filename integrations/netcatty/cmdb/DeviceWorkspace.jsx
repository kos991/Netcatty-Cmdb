import React, { useCallback, useEffect, useState } from 'react'
import { Archive, Boxes, Copy, Maximize2, Minimize2, MoreHorizontal, Network, Pencil, PlugZap, Router, Server as ServerIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from './api'
import { assertNetcattyLinkReady } from './NetcattyConnection'
import DeviceOwnershipBar from './DeviceOwnershipBar'
import DeviceRelations from './DeviceRelations'
import DeviceImages from './DeviceImages'
import { buildDeviceWorkspaceModel, buildDeviceWorkspaceTabs, buildRouterInterfaceRows, buildServerSpecification, deviceTypeLabel, sourceLabel, deviceReadTime } from './deviceWorkspaceModel'
import { infrastructureFieldProfile, supportsInfrastructurePhotos } from './state'
import { toast } from '@/components/ui/toast'
import { useQuery } from './hooks'
import { useNetcattyDirectory } from './NetcattyDirectory'
import RouterOperations from './RouterOperations'
import ServerOperations from './ServerOperations'
import SwitchWorkspace from './SwitchWorkspace'
import { ActionIcon, DefinitionList, ErrorBanner, StatusPill, statusTone } from './ui'
import { VendorBrandValue } from './VendorBrandIcon'

const KIND_LABELS = {
  switch: '交换机',
  router: '路由器',
  server: '服务器',
  generic: '设备',
}

const KIND_ICONS = {
  switch: Network,
  router: Router,
  server: ServerIcon,
  generic: Boxes,
}

const formatTime = deviceReadTime

function DeviceWorkspaceHeader({ asset, kind, expanded, onExpandedChange, onClose, onEdit, onClone, onArchive }) {
  const KindIcon = KIND_ICONS[kind] || KIND_ICONS.generic
  const subtitle = [asset.asset_code || `#${asset.id}`, deviceTypeLabel(asset), [asset.vendor, asset.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  return <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border/70 px-4" data-section="device-workspace-header">
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><KindIcon size={16} /></div>
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-[13px] font-semibold">{asset.name || `未命名${KIND_LABELS[kind]}`}</h1>
        <StatusPill tone={statusTone(asset.status)}>{asset.status || '未知'}</StatusPill>
      </div>
      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={subtitle}>{subtitle}</p>
    </div>
    <div className="flex shrink-0 items-center gap-0.5">
      <ActionIcon label={expanded ? '还原半屏' : '最大化'} onClick={() => onExpandedChange(!expanded)}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</ActionIcon>
      <ActionIcon label="编辑设备" onClick={onEdit}><Pencil size={15} /></ActionIcon>
      <Dropdown>
        <DropdownTrigger asChild><ActionIcon label="更多设备操作"><MoreHorizontal size={16} /></ActionIcon></DropdownTrigger>
        <DropdownContent align="end" className="w-36">
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs hover:bg-secondary" onClick={onClone}><Copy size={14} />克隆设备</button>
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-destructive hover:bg-secondary" onClick={onArchive}><Archive size={14} />注销归档</button>
        </DropdownContent>
      </Dropdown>
      <ActionIcon label="关闭设备工作区" onClick={onClose}><X size={16} /></ActionIcon>
    </div>
  </header>
}

function DeviceActionBar({ asset, kind, primaryHostID, readBusy, lastRead, onConnect, onRead, onAssociate }) {
  const managementIP = asset.mgmt_ip || asset.manage_ip
  return <section className="flex h-[44px] shrink-0 items-center gap-2 border-b border-border/70 px-4" data-section="device-action-bar">
    <span className="shrink-0 text-[11px] text-muted-foreground">管理 IP</span>
    <Button type="button" size="sm" variant="ghost" className="h-7 min-w-0 gap-1.5 px-1 font-mono text-[11px] text-primary" title={primaryHostID ? '使用 Netcatty 连接' : '关联或新建 Netcatty 主机'} onClick={primaryHostID ? onConnect : onAssociate}><PlugZap size={13} className="shrink-0" /><span className="truncate">{managementIP || '关联连接'}</span></Button>
    {kind === 'switch' ? <Button type="button" size="sm" className="h-7 text-[11px]" disabled={readBusy || !primaryHostID} title={!primaryHostID ? '请先关联可用的 Netcatty 主机' : '只读采集设备配置'} onClick={onRead}>{readBusy ? '读取中' : '读取配置'}</Button> : null}
    <span className="ml-auto truncate text-[10px] text-muted-foreground">{kind === 'switch' ? <>最近读取 <span className="ml-1 font-mono text-foreground">{formatTime(lastRead)}</span></> : primaryHostID ? '已关联 Netcatty 主机' : '尚未关联 Netcatty 主机'}</span>
  </section>
}

function DeviceOverview({ detail, kind, snapshot }) {
  const asset = detail.asset
  const brand = <VendorBrandValue value={asset.vendor} model={asset.model} />
  const profile = infrastructureFieldProfile(asset.category_name || asset.device_type || (asset.source_type === 'legacy_server' ? 'server' : ''))
  const base = [
    ['设备状态', asset.status],
    ['设备类型', deviceTypeLabel(asset)],
    ...(profile.brandModel ? [['品牌 / 型号', brand]] : []),
    ['供应商', asset.provider],
    ...(profile.kind === 'storage' ? [['磁盘配置', asset.disk_info]] : []),
    ...(profile.os ? [['系统', [asset.os_type, asset.os_version].filter(Boolean).join(' ')]] : []),
    ['业务 IP', asset.biz_ip],
    ['来源', sourceLabel(asset.source_type)],
  ]
  let items = base
  if (kind === 'switch') {
    const switchData = snapshot?.snapshot || snapshot
    const interfaces = switchData?.interfaces || []
    const abnormal = interfaces.filter((item) => /异常|error|fault/i.test(String(item.state || item.status || ''))).length
    items = [
      ['设备名称', switchData?.device?.name || asset.name],
      ['台账品牌 / 型号', brand],
      ['采集型号', switchData?.device?.model || '未识别'],
      ['系统版本', switchData?.device?.version || asset.os_version],
      ['管理 VLAN', switchData?.device?.managementVlan],
      ['读取协议', snapshot?.protocol],
      ['端口状态', interfaces.length ? `${interfaces.length} 个 / ${abnormal} 异常` : '-'],
      ['最近读取', formatTime(snapshot?.read_at || switchData?.readAt)],
      ['来源', sourceLabel(asset.source_type)],
    ]
  } else if (kind === 'router') {
    const interfaces = buildRouterInterfaceRows(detail.interfaces || [])
    items = [...base.slice(0, 4), ['接口数量', interfaces.length], ['已登记网关', new Set(interfaces.map((item) => item.gateway).filter(Boolean)).size], ['IPAM 地址', (detail.ipam || []).length], ['上下联链路', (detail.links || []).length]]
  } else if (kind === 'server') {
    const specification = buildServerSpecification(asset)
    items = [...(profile.brandModel ? [['品牌 / 型号', brand]] : []), ['供应商', asset.provider], ['CPU', specification.cpu], ['内存', specification.memory], ['磁盘', specification.disk], ['操作系统', specification.os], ['管理入口', specification.management], ['承载业务', (detail.related_applications || []).length], ['设备状态', asset.status]]
  }
  return <section data-section="device-overview">
    <header className="mb-2 flex min-h-[30px] items-center border-b border-border/60"><h2 className="text-xs font-semibold">设备概览</h2></header>
    <DefinitionList items={items} />
  </section>
}

export default function DeviceWorkspace({ id, projects = [], expanded, onExpandedChange, onClose, onEdit, onClone, onArchive, onOpenAsset, onOpenIP, onOpenApplication }) {
  const { hosts, credentials, connectHost, readSwitch } = useNetcattyDirectory()
  const loader = useCallback(() => api.infrastructureAsset(id), [id])
  const query = useQuery(loader)
  const [snapshot, setSnapshot] = useState(null)
  const [readBusy, setReadBusy] = useState(false)
  const [readError, setReadError] = useState('')
  const [requestedLocalPort, setRequestedLocalPort] = useState('')
  const [activeTab, setActiveTab] = useState('operations')
  const clearLinkRequest = useCallback(() => setRequestedLocalPort(''), [])
  const asset = query.data?.asset || {}
  const projectName = projects.find((project) => Number(project.id) === Number(asset.project_id))?.name || ''
  const model = buildDeviceWorkspaceModel(asset, { projectName })
  const navigation = buildDeviceWorkspaceTabs(model.kind, supportsInfrastructurePhotos(asset))
  useEffect(() => { setSnapshot(query.data?.switch_snapshot || null); setReadError(''); setRequestedLocalPort('') }, [id, query.data])
  useEffect(() => { setActiveTab(navigation.defaultTab) }, [id, model.kind, navigation.defaultTab])
  if (query.error) return <div className="flex min-h-0 flex-1 flex-col"><div className="flex justify-end border-b border-border/70 p-2"><ActionIcon label="关闭设备工作区" onClick={onClose}><X size={16} /></ActionIcon></div><ErrorBanner message={query.error} onRetry={query.reload} /></div>
  if (!query.data) return <div className="grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground">正在加载设备档案…</div>

  const detail = query.data
  const primaryLink = detail.netcatty_links?.find?.((item) => item.is_primary && item.host_id) || detail.netcatty_links?.find?.((item) => item.host_id)
  const primaryHost = hosts.find(host => host.id === primaryLink?.host_id)
  const connect = () => { try { assertNetcattyLinkReady(primaryLink, primaryHost, credentials); connectHost(primaryHost.id, primaryLink.credential_id) } catch (error) { toast.error(error.message); setActiveTab('relations') } }
  const readSwitchConfig = async () => {
    if (!primaryLink?.host_id) { setReadError('请先在凭证中心关联主机'); setActiveTab('relations'); return }
    setReadBusy(true); setReadError('')
    try {
      assertNetcattyLinkReady(primaryLink, primaryHost, credentials)
      const result = await readSwitch(primaryLink.host_id, asset.vendor || asset.provider || asset.category_name || asset.device_type, primaryLink.credential_id)
      await api.saveSwitchSnapshot(id, { vendor: result.vendor, protocol: result.protocol, host_id: result.hostId, read_at: result.snapshot.readAt, snapshot: result.snapshot })
      setSnapshot({ ...result, snapshot: result.snapshot, read_at: result.snapshot.readAt })
      query.reload()
    } catch (error) { setReadError(error.message || '读取交换机配置失败'); setActiveTab('operations') } finally { setReadBusy(false) }
  }
  const openLinkForPort = (port) => {
    setRequestedLocalPort(port)
    setActiveTab('network')
  }

  return <div className="flex min-h-0 flex-1 flex-col" data-section="device-workspace" data-device-kind={model.kind}>
    <DeviceWorkspaceHeader asset={asset} kind={model.kind} expanded={expanded} onExpandedChange={onExpandedChange} onClose={onClose} onEdit={onEdit} onClone={onClone} onArchive={onArchive} />
    <DeviceActionBar asset={asset} kind={model.kind} primaryHostID={primaryHost?.id} readBusy={readBusy} lastRead={snapshot?.read_at || snapshot?.snapshot?.readAt} onRead={readSwitchConfig} onConnect={connect} onAssociate={() => setActiveTab('relations')} />
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
      <TabsList className="h-[38px] w-full shrink-0 justify-start overflow-x-auto rounded-none border-b border-border/70 bg-transparent p-0 px-3" data-section="device-workspace-tabs">
        {navigation.tabs.map((tab) => <TabsTrigger key={tab.key} value={tab.key} className="h-[38px] rounded-none border-b-2 border-transparent px-3 text-[11px] shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">{tab.label}</TabsTrigger>)}
      </TabsList>
      <div className="min-h-0 flex-1 overflow-auto p-4" data-section="device-workspace-body">
        {activeTab === 'overview' ? <div className="mb-3"><DeviceOwnershipBar ownership={model.ownership} /></div> : null}
        {activeTab === 'overview' ? <DeviceOverview detail={detail} kind={model.kind} snapshot={snapshot} /> : null}
        {activeTab === 'operations' && model.kind === 'switch' ? <SwitchWorkspace detail={detail} snapshot={snapshot} readError={readError} onAddLinkForPort={openLinkForPort} /> : null}
        {activeTab === 'operations' && model.kind === 'router' ? <RouterOperations detail={detail} /> : null}
        {activeTab === 'operations' && model.kind === 'server' ? <ServerOperations detail={detail} onOpenApplication={onOpenApplication} /> : null}
        {activeTab === 'operations' && model.kind === 'generic' ? <DeviceOverview detail={detail} kind={model.kind} snapshot={snapshot} /> : null}
        {activeTab === 'network' ? <DeviceRelations view="network" id={id} detail={detail} kind={model.kind} onReload={query.reload} onOpenAsset={onOpenAsset} onOpenIP={onOpenIP} requestedLocalPort={requestedLocalPort} onLinkRequestHandled={clearLinkRequest} /> : null}
        {activeTab === 'relations' ? <DeviceRelations view="relations" id={id} detail={detail} kind={model.kind} onReload={query.reload} onOpenAsset={onOpenAsset} onOpenIP={onOpenIP} /> : null}
        {activeTab === 'records' ? <DeviceRelations view="records" id={id} detail={detail} kind={model.kind} onReload={query.reload} onOpenAsset={onOpenAsset} onOpenIP={onOpenIP} /> : null}
        {activeTab === 'photos' && supportsInfrastructurePhotos(asset) ? <section data-section="device-photos"><DeviceImages kind="infrastructure" id={asset.id} /></section> : null}
      </div>
    </Tabs>
  </div>
}
