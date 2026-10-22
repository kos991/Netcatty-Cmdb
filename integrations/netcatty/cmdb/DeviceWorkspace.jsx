import React, { useCallback, useEffect, useState } from 'react'
import { Archive, Boxes, Copy, Cpu, MapPin, MonitorCog, Network, RefreshCw, Router, Server as ServerIcon } from 'lucide-react'
import { AssetDetailTabBar } from './AssetDetailTabs'
import { AssetPanelActions, AssetPanelFields, AssetPanelHeader, AssetPanelSection } from './AssetPanel'
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
import { ActionIcon, ErrorBanner } from './ui'
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

function DeviceWorkspaceHeader({ asset, kind, expanded, onExpandedChange, onClose }) {
  const KindIcon = KIND_ICONS[kind] || KIND_ICONS.generic
  const subtitle = [asset.asset_code, deviceTypeLabel(asset)].filter(Boolean).join(' · ')
  return <AssetPanelHeader title={asset.name || asset.asset_code || '未命名设备'} subtitle={subtitle} status={asset.status} icon={KindIcon} expanded={expanded} onExpandedChange={onExpandedChange} onClose={onClose} />
}

function DeviceActionBar({ asset, kind, primaryHost, readBusy, lastRead, onRead }) {
  const managementIP = asset.mgmt_ip || asset.manage_ip
  if (kind !== 'switch') return null
  const readTitle = primaryHost ? `读取配置（目标 ${primaryHost.hostname}，最近 ${formatTime(lastRead)}）` : '请先关联可用的 Netcatty 主机'
  return <>
    <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border/80" />
    <span className="min-w-0 max-w-[120px] truncate font-mono text-[11px] text-muted-foreground" title={`管理 IP ${managementIP || '未配置'}`}>{managementIP || '未配置'}</span>
    <InfrastructureQuickConnect asset={asset} address={managementIP} />
    <ActionIcon label={readBusy ? '读取中' : readTitle} disabled={readBusy || !primaryHost} onClick={onRead}><RefreshCw size={15} className={readBusy ? 'animate-spin' : ''} /></ActionIcon>
  </>
}

function DetailSection({ title, section, items }) {
  const icon = section === 'device-usage' ? MapPin : section === 'device-system' ? MonitorCog : Cpu
  return <section data-section={section}><AssetPanelSection title={title} icon={icon}><AssetPanelFields items={items} /></AssetPanelSection></section>
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
  if (query.error) return <div className="flex min-h-0 flex-1 flex-col" data-section="device-workspace"><DeviceWorkspaceHeader asset={{ status: '' }} kind={model.kind} expanded={expanded} onExpandedChange={onExpandedChange} onClose={onClose} /><ErrorBanner message={query.error} onRetry={query.reload} /></div>
  if (!query.data) return <div className="flex min-h-0 flex-1 flex-col" data-section="device-workspace"><DeviceWorkspaceHeader asset={{}} kind={model.kind} expanded={expanded} onExpandedChange={onExpandedChange} onClose={onClose} /><div className="grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground">正在加载设备档案…</div></div>

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
    <DeviceWorkspaceHeader asset={asset} kind={model.kind} expanded={expanded} onExpandedChange={onExpandedChange} onClose={onClose} />
    <AssetPanelActions onEdit={onEdit}><ActionIcon label="克隆设备" onClick={onClone}><Copy size={15} /></ActionIcon><ActionIcon label="注销归档" onClick={onArchive}><Archive size={15} /></ActionIcon><DeviceActionBar asset={asset} kind={model.kind} primaryHost={primaryHost} readBusy={readBusy} lastRead={snapshot?.read_at || snapshot?.snapshot?.readAt} onRead={readSwitchConfig} /></AssetPanelActions>
    <AssetDetailTabBar tabs={navigation.tabs} value={activeTab} onChange={setActiveTab} panelId="device-workspace-content" dataSection="device-workspace-tabs" />
    <div id="device-workspace-content" role="tabpanel" aria-labelledby={`device-workspace-tabs-${activeTab}`} className={`min-h-0 min-w-0 flex-1 bg-muted/20 p-4 ${activeTab === 'cabinet' ? 'flex flex-col overflow-hidden' : 'overflow-auto'}`} data-section="device-workspace-body">
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
