import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link2, PlugZap, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { Fields } from './Fields'
import NetcattyConnectionFields from './NetcattyConnectionFields'
import { assertNetcattyLinkReady, buildNetcattyLinkPayload, netcattyLinkStatus, persistNetcattyConnection, setDefaultNetcattyLink, syncFollowingNetcattyHosts } from './NetcattyConnection'
import { toast } from '@/components/ui/toast'
import { useAction, useQuery } from './hooks'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { ActionIcon, ErrorBanner, ModalForm, StatusPill } from './ui'

export default function NetcattyLinks({ assetType, assetId, asset = {}, onChanged, embedded = false }) {
  const { hosts, credentials, connectHost, bindHostCredential, updateHostAddress } = useNetcattyDirectory()
  const [editor, setEditor] = useState(false)
  const [values, setValues] = useState({ host_id: '', credential_id: '', is_primary: true })
  const [removing, setRemoving] = useState(null)
  const [reconcileError, setReconcileError] = useState('')
  const reconciled = useRef('')
  const action = useAction()
  const loader = useCallback(() => api.netcattyLinks({ asset_type: assetType, asset_id: assetId }), [assetId, assetType])
  const query = useQuery(loader)
  const list = useMemo(() => query.data?.list || [], [query.data])
  const hostByID = useMemo(() => new Map(hosts.map((host) => [host.id, host])), [hosts])
  const credentialByID = useMemo(() => new Map(credentials.map((item) => [item.id, item])), [credentials])
  const reload = query.reload

  useEffect(() => {
    if (!list.length) return
    const updates = list.flatMap((link) => {
      const state = netcattyLinkStatus(link, hostByID.get(link.host_id), credentials) === 'linked' ? 'linked' : 'unresolved'
      return state === link.state ? [] : [{ id: link.id, state }]
    })
    const key = JSON.stringify(updates)
    if (!updates.length || reconciled.current === key) return
    reconciled.current = key
    setReconcileError('')
    Promise.all(updates.map((item) => api.updateNetcattyLinkState(item.id, item.state)))
      .then(reload)
      .catch((error) => setReconcileError(`引用状态同步失败：${error.message}`))
  }, [credentials, hostByID, list, reload])

  const fields = [
    { key: 'is_primary', label: '设为主连接', type: 'boolean' },
  ]
  const save = () => action.run(async () => {
    if (!values.host_id && !values.credential_id) throw new Error('请至少选择 Netcatty 主机或钥匙串')
    const oldDefaults = list.filter(link => link.host_id && link.is_primary)
    const promote = !!values.host_id && !!values.is_primary && oldDefaults.length > 0
    const connection = promote ? { ...values, is_primary: false } : values
    const payload = buildNetcattyLinkPayload(assetType, assetId, connection, hosts, credentials)
    const id = await persistNetcattyConnection(api, { assetType, assetId, connection, hosts, credentials, bindHostCredential })
    try {
      if (promote) await setDefaultNetcattyLink(api, { ...payload, id }, oldDefaults)
    } catch (error) {
      throw new Error(`Cmdb 关联 ${id} 已创建，但默认连接切换失败：${error.message}。请刷新后在该连接上重试。`)
    } finally { query.reload(); onChanged?.() }
    setEditor(false); setValues({ host_id: '', credential_id: '', is_primary: true })
  }, '已关联 Netcatty 主机')

  const makeDefault = (link) => action.run(async () => {
    try { await setDefaultNetcattyLink(api, link, list) }
    finally { query.reload(); onChanged?.() }
  }, '已设为默认连接')

  const reapplyCredential = (link) => action.run(async () => {
    await persistNetcattyConnection(api, { assetType, assetId, connection: { host_id: link.host_id, credential_id: link.credential_id, link_id: link.id, is_primary: link.is_primary, follow_asset_ip: link.follow_asset_ip }, hosts, credentials, bindHostCredential })
    query.reload(); onChanged?.()
  }, '主机认证已重新应用')

  return <section className={embedded ? '' : 'border-t border-border/60 pt-3'}>
    <div className={`mb-2 flex items-center gap-2 ${embedded ? 'justify-end' : 'justify-between'}`}>{!embedded && <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Link2 size={13} />凭证中心</h3>}<Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={query.loading || !!query.error} onClick={() => setEditor(true)}><Plus size={13} />关联 / 新建</Button></div>
    {query.error || reconcileError ? <ErrorBanner message={query.error || reconcileError} onRetry={() => { setReconcileError(''); query.reload() }} /> : !list.length ? <p className="text-xs text-muted-foreground">暂无关联{hosts.length || credentials.length ? '' : '，凭证中心暂无可用主机或凭证'}</p> : <div className="divide-y divide-border/50 border-y border-border/50">{list.map((link) => {
      const host = hostByID.get(link.host_id)
      const status = netcattyLinkStatus(link, host, credentials)
      const resolved = status === 'linked'
      const authMismatch = status === 'auth-mismatch'
      const addressMismatch = status === 'address-mismatch'
      const selectedCredential = credentialByID.get(link.credential_id)
      const actualCredential = credentialByID.get(host?.credentialId)
      return <div key={link.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2 text-xs">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{host?.label || link.host_name || selectedCredential?.label || link.credential_name || link.host_id || link.credential_id}</p>
            <StatusPill tone={resolved ? 'success' : 'danger'}>{resolved ? '已联动' : addressMismatch ? '地址待同步' : authMismatch ? '认证未应用/已失效' : '引用失效'}</StatusPill>
            {link.follow_asset_ip ? <span className="text-[10px] text-muted-foreground">跟随 {link.address}</span> : null}{host && link.is_primary ? <StatusPill tone="success">默认</StatusPill> : null}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{host ? `${host.protocol}://${host.hostname}${host.port ? `:${host.port}` : ''}` : '仅关联备用凭证'}{host && link.credential_id ? ` · 连接认证：${actualCredential?.label || '未设置'}${authMismatch ? '（与引用不一致）' : ''}` : !host && selectedCredential ? ` · 备用凭证：${selectedCredential.label}` : ''}</p>
        </div>
        <div className="flex items-center">
          {addressMismatch ? <Button type="button" size="sm" variant="ghost" disabled={action.busy} title={`期望 ${link.address}，实际 ${host?.hostname}`} onClick={() => action.run(async () => { await syncFollowingNetcattyHosts(api, { assetType, assetId, hosts, updateHostAddress }); query.reload(); onChanged?.() })}>重试同步地址</Button> : null}
          {authMismatch ? <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" disabled={action.busy} onClick={() => reapplyCredential(link)}>重新应用认证</Button> : null}
          {resolved && host && !link.is_primary ? <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" disabled={action.busy} onClick={() => makeDefault(link)}>设为默认</Button> : null}
          {resolved && host ? <ActionIcon label="使用 Netcatty 连接" onClick={() => { try { assertNetcattyLinkReady(link, hostByID.get(link.host_id), credentials); connectHost(link.host_id, link.credential_id) } catch (error) { toast.error(error.message) } }}><PlugZap size={14} /></ActionIcon> : !resolved ? <TriangleAlert size={14} className="mx-2 text-destructive" /> : null}
          <ActionIcon label="解除关联" danger onClick={() => setRemoving(link)}><Trash2 size={14} /></ActionIcon>
        </div>
      </div>
    })}</div>}
    <ModalForm open={editor} onOpenChange={setEditor} title="关联 Netcatty 主机或钥匙串" busy={action.busy} onSubmit={save}><NetcattyConnectionFields asset={asset} value={values} onChange={setValues} hosts={hosts} credentials={credentials} /><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null) }} title="解除主机关联" message="只解除 Cmdb 引用，不删除 Netcatty 中的主机或钥匙串。" confirmLabel="解除关联" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deleteNetcattyLink(removing.id); setRemoving(null); query.reload(); onChanged?.() }, '已解除关联')} />
  </section>
}
