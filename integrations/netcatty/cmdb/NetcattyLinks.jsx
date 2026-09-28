import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link2, PlugZap, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from './api'
import { Fields } from './Fields'
import NetcattyConnectionFields from './NetcattyConnectionFields'
import { buildNetcattyLinkPayload } from './NetcattyConnection'
import { toast } from '@/components/ui/toast'
import { useAction, useQuery } from './hooks'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { ActionIcon, ErrorBanner, ModalForm, StatusPill } from './ui'

export default function NetcattyLinks({ assetType, assetId, asset = {}, onChanged, embedded = false }) {
  const { hosts, credentials, connectHost } = useNetcattyDirectory()
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
      const hasReference = !!link.host_id || !!link.credential_id
      const resolved = hasReference && (!link.host_id || hostByID.has(link.host_id)) && (!link.credential_id || credentialByID.has(link.credential_id))
      const state = resolved ? 'linked' : 'unresolved'
      return state === link.state ? [] : [{ id: link.id, state }]
    })
    const key = JSON.stringify(updates)
    if (!updates.length || reconciled.current === key) return
    reconciled.current = key
    setReconcileError('')
    Promise.all(updates.map((item) => api.updateNetcattyLinkState(item.id, item.state)))
      .then(reload)
      .catch((error) => setReconcileError(`引用状态同步失败：${error.message}`))
  }, [credentialByID, hostByID, list, reload])

  const fields = [
    { key: 'is_primary', label: '设为主连接', type: 'boolean' },
  ]
  const save = () => action.run(async () => {
    if (!values.host_id && !values.credential_id) throw new Error('请至少选择 Netcatty 主机或钥匙串')
    const payload = buildNetcattyLinkPayload(assetType, assetId, values, hosts, credentials)
    if (!payload) throw new Error('请选择有效的 Netcatty 主机或身份')
    await api.createNetcattyLink({ ...payload, is_primary: !!payload.host_id && !!values.is_primary })
    setEditor(false); setValues({ host_id: '', credential_id: '', is_primary: true }); query.reload(); onChanged?.()
  }, '已关联 Netcatty 主机')

  return <section className={embedded ? '' : 'border-t border-border/60 pt-3'}>
    <div className={`mb-2 flex items-center gap-2 ${embedded ? 'justify-end' : 'justify-between'}`}>{!embedded && <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Link2 size={13} />凭证中心</h3>}<Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setEditor(true)}><Plus size={13} />关联 / 新建</Button></div>
    {query.error || reconcileError ? <ErrorBanner message={query.error || reconcileError} onRetry={() => { setReconcileError(''); query.reload() }} /> : !list.length ? <p className="text-xs text-muted-foreground">暂无关联{hosts.length || credentials.length ? '' : '，凭证中心暂无可用主机或凭证'}</p> : <div className="divide-y divide-border/50 border-y border-border/50">{list.map((link) => {
      const host = hostByID.get(link.host_id)
      const hasReference = !!link.host_id || !!link.credential_id
      const resolved = hasReference && (!link.host_id || !!host) && (!link.credential_id || credentialByID.has(link.credential_id))
      return <div key={link.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2 text-xs"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate font-medium">{host?.label || link.host_name || credentialByID.get(link.credential_id)?.label || link.credential_name || link.host_id || link.credential_id}</p><StatusPill tone={resolved ? 'success' : 'danger'}>{resolved ? '已联动' : '引用失效'}</StatusPill></div><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{host ? `${host.protocol}://${host.hostname}${host.port ? `:${host.port}` : ''}` : '仅关联钥匙串'}{link.credential_name ? ` · ${link.credential_name}` : ''}</p></div><div className="flex items-center">{resolved && host ? <ActionIcon label="使用 Netcatty 连接" onClick={() => { try { connectHost(link.host_id) } catch (error) { toast.error(error.message) } }}><PlugZap size={14} /></ActionIcon> : resolved ? null : <TriangleAlert size={14} className="mx-2 text-destructive" />}<ActionIcon label="解除关联" danger onClick={() => setRemoving(link)}><Trash2 size={14} /></ActionIcon></div></div>
    })}</div>}
    <ModalForm open={editor} onOpenChange={setEditor} title="关联 Netcatty 主机或钥匙串" busy={action.busy} onSubmit={save}><NetcattyConnectionFields asset={asset} value={values} onChange={setValues} hosts={hosts} credentials={credentials} /><Fields fields={fields} value={values} onChange={setValues} /></ModalForm>
    <ConfirmDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null) }} title="解除主机关联" message="只解除 Cmdb 引用，不删除 Netcatty 中的主机或钥匙串。" confirmLabel="解除关联" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deleteNetcattyLink(removing.id); setRemoving(null); query.reload(); onChanged?.() }, '已解除关联')} />
  </section>
}
