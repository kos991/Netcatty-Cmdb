import React, { useCallback, useEffect, useState } from 'react'
import { Archive, Boxes, Copy, Maximize2, Minimize2, MoreHorizontal, Network, Pencil, Router, Server as ServerIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { AssetDetailTabBar } from './AssetDetailTabs'
import RackView from './RackView'
import { api } from './api'
import { assertNetcattyLinkReady } from './NetcattyConnection'
import DeviceRelations from './DeviceRelations'
import DeviceImages from './DeviceImages'
import { buildDeviceWorkspaceModel, buildDeviceWorkspaceTabs, buildServerSpecification, deviceTypeLabel, resolveOperatingSystemPresentation, sourceLabel, deviceReadTime } from './deviceWorkspaceModel'
import { infrastructureFieldProfile, supportsInfrastructurePhotos } from './state'
import { useQuery } from './hooks'
import { useNetcattyDirectory } from './NetcattyDirectory'
import RouterOperations from './RouterOperations'
import ServerOperations from './ServerOperations'
import SwitchWorkspace from './SwitchWorkspace'
import { ActionIcon, DefinitionList, ErrorBanner, StatusPill, statusTone } from './ui'
import { VendorBrandValue } from './VendorBrandIcon'
import OperatingSystemCell from './OperatingSystemCell'
import InfrastructureQuickConnect from './InfrastructureQuickConnect'

const KIND_ICONS = {
  switch: Network,
  router: Router,
  server: ServerIcon,
  generic: Boxes,
}

const formatTime = deviceReadTime

function DeviceWorkspaceHeader({ asset, kind, expanded, onExpandedChange, onClose, onEdit, onClone, onArchive }) {
  const KindIcon = KIND_ICONS[kind] || KIND_ICONS.generic
  const subtitle = [asset.name || '未命名设备', deviceTypeLabel(asset), [asset.vendor, asset.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  return <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border/70 px-4" data-section="device-workspace-header">
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><KindIcon size={16} /></div>
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate font-mono text-[13px] font-semibold">{asset.asset_code || '未配置编码'}</h1>
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

function DeviceActionBar({ asset, kind, primaryHost, readBusy, lastRead, onRead }) {
  const managementIP = asset.mgmt_ip || asset.manage_ip
  const primaryHostID = primaryHost?.id
  return <section className="flex h-[44px] shrink-0 items-center gap-2 border-b border-border/70 px-4" data-section="device-action-bar">
    <span className="shrink-0 text-[11px] text-muted-foreground">管理 IP</span>
    <span className="min-w-0 truncate font-mono text-xs">{managementIP || '未配置管理 IP'}</span>
    <InfrastructureQuickConnect asset={asset} address={managementIP} />
    {kind === 'switch' ? <Button type="button" size="sm" className="h-7 text-[11px]" disabled={readBusy || !primaryHostID} title={!primaryHostID ? '请先关联可用的 Netcatty 主机' : '只读采集设备配置'} onClick={onRead}>{readBusy ? '读取中' : '读取配置'}</Button> : null}
    <span className="ml-auto min-w-0 truncate text-[10px] text-muted-foreground" title={primaryHost?.hostname || ''}>{primaryHost ? `实际目标 ${primaryHost.hostname}${kind === 'switch' ? ` · 最近读取 ${formatTime(lastRead)}` : ''}` : kind === 'switch' ? <>最近读取 <span className="ml-1 font-mono text-foreground">{formatTime(lastRead)}</span></> : '尚未关联 Netcatty 主机'}</span>
  </section>
}

function DetailSection({ title, section, items }) {
  return <section data-section={section}>
    <header className="mb-2 flex min-h-[30px] items-center border-b border-border/60"><h2 className="text-xs font-semibold">{title}</h2></header>
    <DefinitionList items={items} />
  </section>
}

function DeviceHardware({ detail, kind, snapshot }) {
  const asset = detail.asset
  const profile = infrastructureFieldProfile(asset.category_name || asset.device_type || (asset.source_type === 'legacy_server' ? 'server' : ''))
  const specification = buildServerSpecification(asset)
  const switchDevice = (snapshot?.snapshot || snapshot)?.device
  const items = [
    ['资产编码', asset.asset_code],
    ['设备名称', asset.name],
    ['设备类型', deviceTypeLabel(asset)],
    ...(profile.brandModel ? [['品牌 / 型号', <VendorBrandValue value={asset.vendor} model={asset.model} />]] : []),
    ['SN', asset.sn],
    ['供应商', asset.provider],
    ...(kind === 'server' ? [['CPU', specification.cpu], ['内存', specification.memory], ['磁盘', specification.disk], ['MAC', asset.mac || asset.mac_address]] : []),
    ...(profile.kind === 'storage' ? [['磁盘配置', asset.disk_info]] : []),
    ...(kind === 'switch' ? [['采集型号', switchDevice?.model || '未识别']] : []),
    ['设备状态', asset.status],
    ['来源', sourceLabel(asset.source_type)],
  ]
  return <DetailSection title="硬件信息" section="device-hardware" items={items} />
}

// 负责人与部门来自组织架构，位置来自安装位置登记；两者合并为一个分区查看。
function DeviceUsage({ asset, ownership }) {
  const virtual = asset.asset_class === 'virtual'
  return <DetailSection title="使用与位置" section="device-usage" items={[
    ['负责人', ownership.owner],
    ['部门', asset.department],
    ['组织', ownership.organization],
    ['所属项目', ownership.project],
    ['机房 / 区域', asset.data_center || asset.area],
    ['楼层', asset.floor],
    ['房间', asset.room],
    ['机柜 / U 位', virtual ? '无实体位置' : ownership.cabinet || '未登记'],
    ['地址', [asset.province, asset.city, asset.district, asset.address].filter(Boolean).join(' ')],
  ]} />
}

function DeviceSystem({ detail, snapshot }) {
  const asset = detail.asset
  const switchDevice = (snapshot?.snapshot || snapshot)?.device
  const os = resolveOperatingSystemPresentation(asset)
  return <DetailSection title="系统信息" section="device-system" items={[
    ['操作系统', <OperatingSystemCell asset={{ ...asset, os_version: '' }} />],
    ['系统版本', switchDevice?.version || os.version],
    ['管理账号', asset.admin_user],
    ['管理入口', buildServerSpecification(asset).management],
    ['安装日期', asset.install_date],
    ['保修到期', asset.warranty_date],
    ['备注', asset.remark],
  ]} />
}

export default function DeviceWorkspace({ id, projects = [], expanded, onExpandedChange, onClose, onEdit, onClone, onArchive, onOpenAsset, onOpenIP, onOpenApplication, onOpenCabinet }) {
  const { hosts, credentials, readSwitch } = useNetcattyDirectory()
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
  const navigation = buildDeviceWorkspaceTabs(model.kind, supportsInfrastructurePhotos(asset), { virtual: asset.asset_class === 'virtual' })
  useEffect(() => { setSnapshot(query.data?.switch_snapshot || null); setReadError(''); setRequestedLocalPort('') }, [id, query.data])
  useEffect(() => { setActiveTab(navigation.defaultTab) }, [id, model.kind, navigation.defaultTab])
  if (query.error) return <div className="flex min-h-0 flex-1 flex-col"><div className="flex justify-end border-b border-border/70 p-2"><ActionIcon label="关闭设备工作区" onClick={onClose}><X size={16} /></ActionIcon></div><ErrorBanner message={query.error} onRetry={query.reload} /></div>
  if (!query.data) return <div className="grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground">正在加载设备档案…</div>

  const detail = query.data
  const primaryLink = detail.netcatty_links?.find?.((item) => item.is_primary && item.host_id) || detail.netcatty_links?.find?.((item) => item.host_id)
  const primaryHost = hosts.find(host => host.id === primaryLink?.host_id)
  const connections = (detail.netcatty_links || []).map(link => ({ link, host: hosts.find(host => host.id === link.host_id) })).filter(item => item.host)
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
    {activeTab === 'operations' && model.kind === 'switch' ? <DeviceActionBar asset={asset} kind={model.kind} primaryHost={primaryHost} readBusy={readBusy} lastRead={snapshot?.read_at || snapshot?.snapshot?.readAt} onRead={readSwitchConfig} /> : null}
    <AssetDetailTabBar tabs={navigation.tabs} value={activeTab} onChange={setActiveTab} panelId="device-workspace-content" dataSection="device-workspace-tabs" />
    <div id="device-workspace-content" role="tabpanel" aria-labelledby={`device-workspace-tabs-${activeTab}`} className={`min-h-0 min-w-0 flex-1 p-4 ${activeTab === 'cabinet' ? 'flex flex-col overflow-hidden' : 'overflow-auto'}`} data-section="device-workspace-body">
      {activeTab === 'hardware' ? <DeviceHardware detail={detail} kind={model.kind} snapshot={snapshot} /> : null}
      {activeTab === 'operations' && model.kind === 'switch' ? <SwitchWorkspace detail={detail} snapshot={snapshot} readError={readError} onAddLinkForPort={openLinkForPort} /> : null}
      {activeTab === 'operations' && model.kind === 'router' ? <RouterOperations detail={detail} /> : null}
      {activeTab === 'operations' && model.kind === 'server' ? <ServerOperations detail={detail} onOpenApplication={onOpenApplication} /> : null}
      {activeTab === 'network' ? <DeviceRelations view="network" id={id} detail={detail} onReload={query.reload} onOpenAsset={onOpenAsset} onOpenIP={onOpenIP} requestedLocalPort={requestedLocalPort} onLinkRequestHandled={clearLinkRequest} connections={connections} /> : null}
      {activeTab === 'usage' ? <DeviceUsage asset={asset} ownership={model.ownership} /> : null}
      {activeTab === 'cabinet' ? <div className="min-h-0 flex-1 space-y-4 overflow-auto"><div className="flex h-[480px] flex-col"><RackView asset={asset} onOpenAsset={onOpenAsset} onChanged={query.reload} onOpenCabinet={onOpenCabinet} /></div>{supportsInfrastructurePhotos(asset) && ['server', 'switch'].includes(model.kind) ? <section data-section="device-cabinet-photos"><h2 className="mb-2 text-xs font-semibold">设备照片</h2><DeviceImages kind="infrastructure" id={asset.id} /></section> : null}</div> : null}
      {activeTab === 'system' ? <DeviceSystem detail={detail} snapshot={snapshot} /> : null}
      {activeTab === 'photos' && supportsInfrastructurePhotos(asset) ? <section data-section="device-photos"><DeviceImages kind="infrastructure" id={asset.id} /></section> : null}
      {activeTab === 'records' ? <DeviceRelations view="records" id={id} detail={detail} onReload={query.reload} onOpenAsset={onOpenAsset} onOpenIP={onOpenIP} /> : null}
      {activeTab === 'relations' ? <DeviceRelations view="relations" id={id} detail={detail} onReload={query.reload} onOpenAsset={onOpenAsset} onOpenIP={onOpenIP} /> : null}
    </div>
  </div>
}
