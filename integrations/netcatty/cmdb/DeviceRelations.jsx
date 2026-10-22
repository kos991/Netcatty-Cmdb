import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { choices, Fields, textFields } from './Fields'
import { allPages } from './hooks'
import NetcattyLinks from './NetcattyLinks'
import InfrastructureQuickConnect from './InfrastructureQuickConnect'
import { networkAddressRows } from './infrastructureEditorModel'
import { ActionIcon, ModalForm } from './ui'

function WorkspaceSection({ title, children, action, dataSection }) {
  return <section className="border-t border-border/60 pt-3 first:border-t-0 first:pt-0" data-section={dataSection}>
    <header className="mb-2 flex min-h-[30px] items-center gap-2">
      <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</h2>
      {action}
    </header>
    <div>{children}</div>
  </section>
}

function CompactRows({ rows, empty = '暂无数据', onOpen }) {
  if (!rows?.length) return <p className="py-2 text-xs text-muted-foreground">{empty}</p>
  return <div className="divide-y divide-border/50 border-y border-border/50">{rows.map((row, index) => {
    const Main = onOpen ? 'button' : 'div'
    return <div key={row.id || row.ip || row.local_port || index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 py-2 text-xs"><Main type={onOpen ? 'button' : undefined} onClick={onOpen ? () => onOpen(row) : undefined} className={`min-w-0 text-left ${onOpen ? 'text-primary hover:underline' : ''}`}><span className="text-[10px] text-muted-foreground">{row.label || '-'}</span><p className="truncate font-mono">{row.value || '-'}</p></Main><div className="min-w-0 text-right"><span className="text-[10px] text-muted-foreground">{row.metaLabel || '状态'}</span><p className="truncate text-foreground">{row.meta || '-'}</p></div>{row.actionLabel ? <p className="col-span-2 truncate font-mono text-[11px] text-muted-foreground">{row.actionLabel}</p> : null}</div>
  })}</div>
}

function LinkRows({ rows, onOpen, onDelete }) {
  if (!rows?.length) return <p className="py-2 text-xs text-muted-foreground">暂未登记上下联链路</p>
  return <div className="divide-y divide-border/50 border-y border-border/50">{rows.map((link) => <div key={link.id} className="grid grid-cols-[82px_minmax(0,1fr)_28px] items-center gap-2 py-2 text-xs"><div><p className="font-mono text-foreground">{link.local_port || '-'}</p><span className="text-[10px] text-muted-foreground">{link.direction === 'uplink' ? '上联' : '下联'}</span></div><button type="button" className="min-w-0 text-left" disabled={!link.peer_asset_id} onClick={() => onOpen(link)}><p className="truncate text-primary hover:underline">{link.peer_asset_name || '-'}</p><span className="block truncate font-mono text-[10px] text-muted-foreground">{link.peer_port || '-'}{link.vlan ? ` · VLAN ${link.vlan}` : ''}{link.vni ? ` · VNI ${link.vni}` : ''} · {link.status || '-'}</span></button><ActionIcon label="删除链路" danger onClick={() => onDelete(link)}><Trash2 size={14} /></ActionIcon></div>)}</div>
}

function AddressRows({ rows, ipam, connections, asset }) {
  if (!rows.length) return <p className="py-2 text-xs text-muted-foreground">暂未登记地址</p>
  return <div className="divide-y divide-border/50 border-y border-border/50">{rows.map(row => {
    const pool = ipam.find(item => item.ip === row.ip)
    const connection = connections.find(item => item.host?.hostname === row.ip)
    return <div key={row.ip} className="flex items-start gap-1 py-2 text-xs"><details className="group min-w-0 flex-1"><summary className="flex min-w-0 cursor-pointer list-none items-center gap-2"><span className="min-w-0 flex-1 break-all font-mono text-foreground">{row.ip}</span><span className="shrink-0 text-[10px] text-muted-foreground">{row.purposes.join(' / ')}</span><span className="text-muted-foreground">⌄</span></summary><div className="mt-2 space-y-1 pl-2 text-[11px] text-muted-foreground"><p>接口：{row.interfaceName || '未指定'}{row.interfaceID ? ` #${row.interfaceID}` : ''}</p><p>网络分区：{row.networkZone || '-'} · 网段：{pool?.subnet || pool?.cidr || (row.mask ? `${row.ip}/${row.mask}` : '-')}</p><p>VLAN：{row.vlanID || '-'} · 网关：{row.gateway || '-'}</p><p className="break-all">关联连接：{connection ? `${connection.host.label || connection.link.host_name || 'Netcatty 主机'} · ${connection.host.protocol}://${connection.host.hostname}` : '未关联此地址'}</p></div></details><InfrastructureQuickConnect asset={asset} address={row.ip} /></div>
  })}</div>
}

export default function DeviceRelations({ id, detail, view = 'all', onReload, onOpenAsset, onOpenIP, requestedLocalPort = '', onLinkRequestHandled, connections = [], connectionWarning, onGoConnections }) {
  const [linkEditor, setLinkEditor] = useState(false)
  const [linkValues, setLinkValues] = useState({})
  const [allAssets, setAllAssets] = useState([])
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [deletingLink, setDeletingLink] = useState(null)
  const asset = detail.asset

  const primaryInterfaceID = detail.interfaces?.[0]?.id || 0
  const openLinkEditor = useCallback(async (localPort = '') => {
    setLinkError('')
    setLinkValues({ local_interface_id: primaryInterfaceID, local_port: localPort, direction: 'downlink', peer_asset_id: '', peer_port: '', vlan: '', vni: '', status: '在线', remark: '' })
    setLinkEditor(true)
    try { setAllAssets(await allPages(api.infrastructure, { scope: 'infrastructure' })) } catch (error) { setLinkError(`资产目录加载失败：${error.message}`) }
  }, [primaryInterfaceID])
  useEffect(() => {
    if (!requestedLocalPort) return
    if (!detail.links?.some(link => link.local_port === requestedLocalPort)) void openLinkEditor(requestedLocalPort)
    onLinkRequestHandled?.()
  }, [detail.links, onLinkRequestHandled, openLinkEditor, requestedLocalPort])

  const peerOptions = useMemo(() => allAssets.filter((item) => item.id !== id).map((item) => ({ value: item.id, label: [item.name, item.asset_code, item.device_type].filter(Boolean).join(' · ') })), [allAssets, id])
  const interfaceOptions = [{ value: 0, label: '未指定接口' }, ...(detail.interfaces || []).map((item) => ({ value: item.id, label: item.name || item.if_name || `接口 #${item.id}` }))]
  const linkFields = [
    { key: 'local_interface_id', label: '本端接口', options: choices(interfaceOptions), numeric: true },
    { key: 'local_port', label: '本端端口', required: true },
    { key: 'direction', label: '链路方向', options: [{ value: 'downlink', label: '下联' }, { value: 'uplink', label: '上联' }] },
    { key: 'peer_asset_id', label: '对端设备', required: true, options: choices(peerOptions), numeric: true, searchable: true },
    ...textFields([['peer_port', '对端端口'], ['vlan', 'VLAN'], ['vni', 'VXLAN VNI']]),
    { key: 'status', label: '链路状态', options: ['在线', '离线', '异常', '维护中'] },
    { key: 'remark', label: '备注', type: 'textarea' },
  ]
  const saveLink = async () => {
    if (!linkValues.local_port?.trim()) { setLinkError('请填写本端端口'); return }
    if (!linkValues.peer_asset_id) { setLinkError('请选择对端设备'); return }
    setLinkBusy(true); setLinkError('')
    try {
      await api.createInfrastructureLink(id, { ...linkValues, local_interface_id: Number(linkValues.local_interface_id || 0), peer_asset_id: Number(linkValues.peer_asset_id) })
      setLinkEditor(false)
      onReload?.()
    } catch (error) { setLinkError(error.message) } finally { setLinkBusy(false) }
  }
  const ipamRows = (detail.ipam || []).map((item) => ({ ...item, label: item.subnet || 'IP 地址', value: item.ip, metaLabel: 'VLAN / VNI', meta: [item.vlan ? `VLAN ${item.vlan}` : '', item.vni ? `VNI ${item.vni}` : ''].filter(Boolean).join(' · ') || item.status, actionLabel: `${item.cidr || '-'}${item.purpose ? ` · ${item.purpose}` : ''}` }))
  const interfaceRows = (detail.interfaces || []).map((item) => ({ id: item.id, label: item.name || item.if_name || '网络接口', value: item.ip, metaLabel: item.network_zone || item.net_zone || '网络区域', meta: [item.mask, item.gateway ? `网关 ${item.gateway}` : '', item.vlan_id ? `VLAN ${item.vlan_id}` : ''].filter(Boolean).join(' · ') || '-', actionLabel: item.mac ? `MAC ${item.mac}` : '' }))
  const addressRows = networkAddressRows({ ...asset, interfaces: detail.interfaces || [] })
  const historyRows = (detail.history || []).map((item, index) => ({ id: item.id || index + 1, label: item.type || '变更', value: item.description, metaLabel: item.occurred_at || '发生时间', meta: item.operator || '-', actionLabel: item.remark || '' }))

  const showNetwork = view === 'all' || view === 'network'
  const showRelations = view === 'all' || view === 'relations'
  const showRecords = view === 'all' || view === 'records'

  return <div className="space-y-5">
    {showNetwork ? <WorkspaceSection title="IPAM、接口与上下联链路" dataSection="device-network-relations" action={<Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => void openLinkEditor()}><Plus size={13} />添加链路</Button>}>
      <div className="space-y-4">{connectionWarning ? <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"><p>{connectionWarning}</p><Button type="button" variant="outline" size="sm" className="mt-2 h-7" onClick={onGoConnections}>前往凭证中心调整</Button></div> : null}<div><h3 className="mb-2 text-[11px] font-medium text-muted-foreground">已登记地址</h3><AddressRows rows={addressRows} ipam={detail.ipam || []} connections={connections} asset={asset} /></div><div><h3 className="mb-2 text-[11px] font-medium text-muted-foreground">IPAM 地址</h3><CompactRows rows={ipamRows} empty="未在 IPAM 中找到关联地址" onOpen={(item) => item.id && onOpenIP?.(item)} /></div><div><h3 className="mb-2 text-[11px] font-medium text-muted-foreground">网络接口</h3><CompactRows rows={interfaceRows} empty="暂未登记网络接口" /></div><div><h3 className="mb-2 text-[11px] font-medium text-muted-foreground">上下联链路</h3><LinkRows rows={detail.links || []} onOpen={(item) => item.peer_asset_id && onOpenAsset?.(item.peer_asset_id)} onDelete={setDeletingLink} /></div></div>
    </WorkspaceSection> : null}
    {showRelations ? <div data-section="device-netcatty-links"><NetcattyLinks asset={{ ...asset, interfaces: detail.interfaces || [] }} assetType="infrastructure" assetId={id} onChanged={onReload} /></div> : null}
    {showRecords ? <WorkspaceSection title="变更履历" dataSection="device-asset-history"><CompactRows rows={historyRows} empty="暂无变更履历" /></WorkspaceSection> : null}
    <ModalForm open={linkEditor} onOpenChange={setLinkEditor} title="添加资产链路" busy={linkBusy} onSubmit={saveLink} wide><Fields fields={linkFields} value={linkValues} onChange={setLinkValues} />{linkError ? <p className="text-xs text-destructive">{linkError}</p> : null}</ModalForm>
    {!linkEditor && linkError ? <p className="text-xs text-destructive">{linkError}</p> : null}
    <ConfirmDialog open={!!deletingLink} onOpenChange={(open) => { if (!open) setDeletingLink(null) }} title="删除资产链路" message={`确认删除 ${deletingLink?.local_port || ''} 到 ${deletingLink?.peer_asset_name || ''} 的链路？`} confirmLabel="删除" destructive busy={linkBusy} onConfirm={async () => { setLinkBusy(true); setLinkError(''); try { await api.deleteInfrastructureLink(deletingLink.id); setDeletingLink(null); onReload?.() } catch (error) { setLinkError(error.message) } finally { setLinkBusy(false) } }} />
  </div>
}
