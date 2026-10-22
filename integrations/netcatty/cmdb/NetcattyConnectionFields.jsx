import React, { useCallback, useRef, useState } from 'react'
import { KeyRound, Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { networkAddressRows } from './infrastructureEditorModel'
import { api } from './api'
import { choices } from './Fields'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { Textarea } from '@/components/ui/textarea'
import { infrastructureFieldProfile } from './state'
import {
  EMPTY_NETCATTY_CONNECTION,
  connectionFromLinks,
  persistNetcattyConnection,
  selectNetcattyHost,
  syncFollowingNetcattyHosts,
} from './NetcattyConnection'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorBanner, Field, SelectControl } from './ui'

export function useNetcattyConnectionEditor(assetType) {
  const directory = useNetcattyDirectory()
  const { hosts, credentials } = directory
  const { createHost, createCredential, bindHostCredential, updateHostAddress } = directory
  const [connection, setConnection] = useState({ ...EMPTY_NETCATTY_CONNECTION })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const begin = useCallback(async (assetID = 0) => {
    setConnection({ ...EMPTY_NETCATTY_CONNECTION })
    setError('')
    if (!assetID) return
    setLoading(true)
    try {
      const result = await api.netcattyLinks({ asset_type: assetType, asset_id: assetID })
      setConnection(connectionFromLinks(result.list || []))
    } catch (nextError) {
      setError(`读取 Netcatty 关联失败：${nextError.message}`)
    } finally {
      setLoading(false)
    }
  }, [assetType])

  const persist = useCallback(async (assetID) => {
    await persistNetcattyConnection(api, {
    assetType,
    assetId: assetID,
    connection,
    hosts,
    credentials,
    bindHostCredential,
    })
    await syncFollowingNetcattyHosts(api, { assetType, assetId: assetID, hosts, updateHostAddress })
  }, [assetType, bindHostCredential, connection, credentials, hosts, updateHostAddress])

  return { connection, setConnection, begin, persist, hosts, credentials, loading, error, createHost, createCredential }
}

export default function NetcattyConnectionFields({ value, onChange, asset = {}, hosts = [], credentials = [], groups, loading, error, createHost, createCredential }) {
  const directory = useNetcattyDirectory()
  createCredential = createCredential || directory.createCredential
  createHost = createHost || directory.createHost
  groups = groups || directory.groups || []
  const selectedHost = hosts.find((item) => item.id === value.host_id)
  const [dialog, setDialog] = useState(null)
  const [draft, setDraft] = useState({ protocol: 'ssh', port: 22, kind: 'identity', authMethod: 'password' })
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const labelRef = useRef(null)
  const hostnameRef = useRef(null)
  const usernameRef = useRef(null)
  const focusField = (key) => {
    const target = { label: labelRef, hostname: hostnameRef, username: usernameRef }[key]
    target?.current?.focus()
  }
  const submit = async () => {
    setSaving(true); setLocalError(''); setFieldErrors({})
    try {
      if (dialog === 'credential') {
        const created = await createCredential(draft)
        onChange({ ...value, credential_id: created.id })
      } else {
        const errors = {}
        if (!String(draft.label || '').trim()) errors.label = '请填写名称'
        if (!String(draft.hostname || '').trim()) errors.hostname = '请填写主机地址'
        if (dialog === 'host' && !draft.credentialId && !String(draft.username || '').trim()) errors.username = '请填写用户名或选择已配置用户名的身份'
        if (Object.keys(errors).length) {
          setFieldErrors(errors)
          focusField(Object.keys(errors)[0])
          throw new Error(Object.values(errors)[0])
        }
        const assetAddresses = new Set([...networkAddressRows(asset).map(item => item.ip), asset.ip, asset.terminal_ip, asset.public_ip].filter(Boolean))
        if (draft.follow_asset_ip && !assetAddresses.has(String(draft.hostname || '').trim())) {
          setFieldErrors({ hostname: '跟随地址必须是当前资产已填写的实际地址' })
          focusField('hostname')
          throw new Error('跟随地址必须是当前资产已填写的实际地址，域名或 NAT 主机请取消跟随')
        }
        const group = String(draft.newGroup || draft.group || '').trim()
        const draftFields = { ...draft }
        delete draftFields.newGroup
        const created = await createHost({ ...draftFields, group, deviceType: infrastructureFieldProfile(asset.category_name || asset.device_type).kind === 'network' ? 'network' : 'general' })
        onChange({ ...value, host_id: created.id, credential_id: created.telnetIdentityId || created.identityId || created.identityFileId || '', follow_asset_ip: !!draft.follow_asset_ip })
      }
      setDialog(null)
    } catch (nextError) { setLocalError(nextError?.message || String(nextError)) } finally { setSaving(false) }
  }
  return <section className="border-t border-border/60 pt-4" data-section="cmdb-netcatty-connection-fields">
    <div className="mb-3 flex items-start gap-2">
      <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="text-[11px] text-muted-foreground">选中主机时，身份或密钥将用于该主机连接；不选主机时仅保存备用凭证引用。同一设备使用多个账号时，请为每个账号关联独立的 Netcatty 主机。</p>
    </div>
    {error || localError ? <ErrorBanner message={error || localError} /> : null}
    <div className="grid min-w-0 grid-cols-2 items-start gap-3 [&>div]:min-w-0 [&>div]:grid-rows-[2rem_2.25rem] [&>div>label]:self-end [&>div>div]:min-w-0 [&>div>div]:items-center [&_button[role=combobox]]:min-w-0">
      <Field label="Netcatty 主机"><div className="flex gap-2"><SelectControl searchable className="min-w-0 flex-1" disabled={loading || !hosts.length} value={value.host_id} onChange={(hostID) => onChange(selectNetcattyHost(value, hostID, hosts))} options={choices(hosts.map((host) => ({ value: host.id, label: `${host.label} · ${host.hostname}${host.port ? `:${host.port}` : ''}` })), '不关联')} /><Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" title="直接新建 Netcatty 主机" onClick={() => { setLocalError(''); setDraft({ label: asset.name || '', hostname: asset.mgmt_ip || asset.manage_ip || asset.ip || selectedHost?.hostname || '', protocol: 'ssh', port: 22, credentialId: value.credential_id || '', group: '', newGroup: '' }); setDialog('host') }}><Plus size={14} /></Button></div></Field>
      <Field label="Netcatty 密钥库"><div className="flex gap-2"><SelectControl searchable className="min-w-0 flex-1" disabled={loading || !credentials.length} value={value.credential_id} onChange={(credentialID) => onChange({ ...value, credential_id: credentialID })} options={choices(credentials.map((credential) => ({ value: credential.id, label: `${credential.label} · ${credential.type || credential.authMethod || 'identity'}` })), '不关联')} /><Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" title="直接新建 Netcatty 身份" onClick={() => { setDraft({ label: '', username: '', kind: 'identity', authMethod: 'password' }); setDialog('credential') }}><KeyRound size={14} /></Button></div></Field>
    </div>
    {!hosts.length ? <p className="mt-2 text-[11px] text-muted-foreground">主机库为空，可直接点击右侧 + 在这里创建并保存。</p> : selectedHost ? <p className="mt-2 font-mono text-[11px] text-muted-foreground">{selectedHost.protocol}://{selectedHost.hostname}{selectedHost.port ? `:${selectedHost.port}` : ''}</p> : null}
    <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !saving) setDialog(null) }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{dialog === 'host' ? '新建 Netcatty 主机' : '新建 Netcatty 身份 / 密钥'}</DialogTitle></DialogHeader><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="名称" required error={fieldErrors.label}><Input ref={labelRef} value={draft.label || ''} onChange={(event) => { setDraft({ ...draft, label: event.target.value }); setFieldErrors((old) => ({ ...old, label: '' })) }} /></Field>
      {dialog === 'host' ? <>
        <Field label="主机地址" required error={fieldErrors.hostname}><Input ref={hostnameRef} className="font-mono" value={draft.hostname || ''} onChange={(event) => { setDraft({ ...draft, hostname: event.target.value }); setFieldErrors((old) => ({ ...old, hostname: '' })) }} /></Field>
        <label className="flex items-center gap-2 text-xs sm:col-span-2"><Switch checked={!!draft.follow_asset_ip} onCheckedChange={checked => setDraft({ ...draft, follow_asset_ip: checked })} />跟随此资产地址（资产替换地址后同步此主机）</label>
        <Field label="分组" className="sm:col-span-2"><div className="flex gap-2"><SelectControl searchable className="min-w-0 flex-1" value={draft.group || ''} onChange={(group) => setDraft({ ...draft, group, newGroup: '' })} options={choices(groups.map((path) => ({ value: path, label: path })), '不分组')} /><Input className="w-40 shrink-0" placeholder="或输入新分组" value={draft.newGroup || ''} onChange={(event) => setDraft({ ...draft, newGroup: event.target.value, ...(event.target.value ? { group: '' } : {}) })} /></div></Field>
        <Field label="协议"><SelectControl className="w-full" value={draft.protocol} onChange={(protocol) => setDraft({ ...draft, protocol, port: protocol === 'telnet' ? 23 : 22, credentialId: '' })} options={[{ value: 'ssh', label: 'SSH' }, { value: 'telnet', label: 'Telnet' }]} /></Field>
        <Field label="端口"><Input type="number" min="1" max="65535" value={draft.port || ''} onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })} /></Field>
        <Field label="绑定身份 / 密钥" className="sm:col-span-2"><SelectControl searchable className="w-full" value={draft.credentialId || ''} onChange={(credentialId) => setDraft({ ...draft, credentialId })} options={choices(credentials.filter(credential => draft.protocol !== 'telnet' || (credential.kind === 'identity' && credential.type === 'password')).map((credential) => ({ value: credential.id, label: credential.label })), '不绑定')} /></Field>
        {!credentials.find(item => item.id === draft.credentialId && item.kind === 'identity') ? <Field label="用户名" required error={fieldErrors.username}><Input ref={usernameRef} value={draft.username || ''} onChange={(event) => { setDraft({ ...draft, username: event.target.value }); setFieldErrors((old) => ({ ...old, username: '' })) }} /></Field> : null}
        {!draft.credentialId ? <Field label="密码"><Input type="password" autoComplete="new-password" value={draft.password || ''} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></Field> : null}
      </> : <>
        <Field label="保存类型"><SelectControl className="w-full" value={draft.kind} onChange={kind => setDraft({ ...draft, kind })} options={[{ value: 'identity', label: '登录身份' }, { value: 'key', label: '导入私钥' }]} /></Field>
        {draft.kind === 'key' ? <>
          <Field label="密钥类型"><SelectControl className="w-full" value={draft.type || 'ED25519'} onChange={type => setDraft({ ...draft, type })} options={['ED25519', 'RSA', 'ECDSA'].map(type => ({ value: type, label: type }))} /></Field>
          <Field label="私钥口令"><Input type="password" autoComplete="new-password" value={draft.passphrase || ''} onChange={event => setDraft({ ...draft, passphrase: event.target.value })} /></Field>
          <Field label="私钥内容" required className="sm:col-span-2"><Textarea className="min-h-28 font-mono text-xs" value={draft.privateKey || ''} onChange={event => setDraft({ ...draft, privateKey: event.target.value })} /></Field>
        </> : <>
          <Field label="用户名" required><Input value={draft.username || ''} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></Field>
          <Field label="认证方式"><SelectControl className="w-full" value={draft.authMethod} onChange={(authMethod) => setDraft({ ...draft, authMethod })} options={[{ value: 'password', label: '密码' }, { value: 'key', label: '密钥引用' }]} /></Field>
          {draft.authMethod === 'key' ? <Field label="引用密钥" required className="sm:col-span-2"><SelectControl searchable className="w-full" value={draft.keyId || ''} onChange={keyId => setDraft({ ...draft, keyId })} options={choices(credentials.filter(item => item.kind === 'key').map(item => ({ value: item.id, label: item.label })), '选择密钥')} /></Field> : <Field label="密码"><Input type="password" autoComplete="new-password" value={draft.password || ''} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></Field>}
        </>}
      </>}
    </div>{localError ? <ErrorBanner message={localError} /> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={saving}>取消</Button><Button type="button" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存到 Netcatty'}</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
