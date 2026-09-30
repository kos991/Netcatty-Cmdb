import React, { useState } from 'react'
import { PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from './api'
import { useAction } from './hooks'
import { connectionFromLinks, netcattyLinkStatus, persistNetcattyConnection } from './NetcattyConnection'
import NetcattyConnectionFields from './NetcattyConnectionFields'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { quickConnectControlPresentation } from './state'
import { ModalForm } from './ui'

export default function InfrastructureQuickConnect({ asset }) {
  const { hosts, credentials, connectHost, bindHostCredential } = useNetcattyDirectory()
  const [connection, setConnection] = useState(null)
  const [referenceError, setReferenceError] = useState('')
  const action = useAction()
  const control = quickConnectControlPresentation(asset)

  const connect = () => action.run(async () => {
    const result = await api.netcattyLinks({ asset_type: 'infrastructure', asset_id: asset.id })
    const links = result.list || []
    const link = links.find(item => item.is_primary && item.host_id) || links.find(item => item.host_id)
    const host = hosts.find(item => item.id === link?.host_id)
    if (host && netcattyLinkStatus(link, host, credentials) === 'linked') {
      await connectHost(host.id, link.credential_id)
      return
    }
    setReferenceError(host ? '主机认证未应用或身份引用已失效，请重新保存关联后连接。' : link?.host_id ? '原关联主机已不存在，请重新选择或创建 Netcatty 主机。' : '')
    setConnection({ ...connectionFromLinks(link ? [link] : links), is_primary: link?.is_primary ?? true })
  })

  const saveAndConnect = () => action.run(async () => {
    if (!hosts.some(host => host.id === connection?.host_id)) throw new Error('请选择或新建 Netcatty 主机')
    await persistNetcattyConnection(api, {
      assetType: 'infrastructure',
      assetId: asset.id,
      connection,
      hosts,
      credentials,
      bindHostCredential,
    })
    setConnection(null)
    await connectHost(connection.host_id, connection.credential_id)
  })

  return <>
    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={control.ariaLabel} title={control.ariaLabel} disabled={action.busy} onClick={event => { event.stopPropagation(); void connect() }}><PlugZap size={13} /><span>{control.label}</span></Button>
    {connection ? <ModalForm title="关联主机并连接" open onOpenChange={open => { if (!open && !action.busy) setConnection(null) }} busy={action.busy} onSubmit={saveAndConnect} submitLabel="保存关联并连接">
      <p className="text-xs text-muted-foreground">{asset.name} · {asset.mgmt_ip || asset.manage_ip || '未填写管理 IP'}</p>
      <NetcattyConnectionFields asset={asset} value={connection} onChange={value => { setConnection(value); setReferenceError('') }} hosts={hosts} credentials={credentials} error={referenceError} />
    </ModalForm> : null}
  </>
}
