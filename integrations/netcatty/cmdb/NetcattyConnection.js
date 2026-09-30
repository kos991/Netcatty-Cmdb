export const EMPTY_NETCATTY_CONNECTION = Object.freeze({ host_id: '', credential_id: '' })

export function connectionTargetMismatch(address, host) {
  const selected = String(address || '').trim()
  const actual = String(host?.hostname || '').trim()
  return selected && actual && selected !== actual ? { selected, actual } : null
}

export function connectionForAddress(address, links = [], hosts = [], credentials = null) {
  const selected = String(address || '').trim()
  if (!selected) return null
  const matches = links.filter(link => {
    const host = hosts.find(item => item.id === link.host_id)
    return host && String(host.hostname || '').trim() === selected
      && (credentials === null || netcattyLinkStatus(link, host, credentials) === 'linked')
  })
  return matches.sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary) || Number(b.id || 0) - Number(a.id || 0))[0] || null
}

export function netcattyLinkStatus(link, host, credentials = []) {
  if (!link?.host_id && !link?.credential_id) return 'unresolved'
  if (link.host_id && !host) return 'unresolved'
  if (link.credential_id && !credentials.some(item => item.id === link.credential_id)) return 'unresolved'
  if (link.host_id && link.credential_id) {
    const actual = host.protocol === 'telnet'
      ? (host.telnetIdentityId ?? host.credentialId ?? '')
      : (host.identityId || host.identityFileId || host.credentialId || '')
    if (actual !== link.credential_id) return 'auth-mismatch'
  }
  return 'linked'
}

export function assertNetcattyLinkReady(link, host, credentials = []) {
  const status = netcattyLinkStatus(link, host, credentials)
  if (status === 'auth-mismatch') throw new Error('主机认证未应用或已失效，请在凭证中心重新应用后连接')
  if (status !== 'linked' || !host) throw new Error('Netcatty 主机或身份引用已失效，请重新关联')
}

export function connectionFromLinks(links = []) {
  const link = links.find((item) => item.is_primary) || links[0]
  return link ? { host_id: link.host_id || '', credential_id: link.credential_id || '', link_id: link.id } : { ...EMPTY_NETCATTY_CONNECTION }
}

export function selectNetcattyHost(connection, hostID, hosts = []) {
  const host = hosts.find((item) => item.id === hostID)
  return {
    ...connection,
    host_id: hostID || '',
    credential_id: host ? (host.credentialId || '') : (connection.credential_id || ''),
  }
}

export function buildNetcattyLinkPayload(assetType, assetID, connection, hosts = [], credentials = []) {
  const host = hosts.find((item) => item.id === connection.host_id)
  const credential = credentials.find((item) => item.id === connection.credential_id)
  if (connection.host_id && !host) throw new Error('关联的 Netcatty 主机不存在，请重新选择')
  if (connection.credential_id && !credential) throw new Error('关联的 Netcatty 身份或密钥不存在，请重新选择')
  if ((!host && !credential) || !assetID) return null
  return {
    asset_type: assetType,
    asset_id: Number(assetID),
    host_id: host?.id || '',
    host_name: host?.label || '',
    credential_id: credential?.id || '',
    credential_name: credential?.label || '',
    protocol: host?.protocol || '',
    address: host?.hostname || '',
    port: Number(host?.port || 0),
    is_primary: !!host && connection.is_primary !== false,
    state: 'linked',
  }
}

export async function persistNetcattyConnection(api, { assetType, assetId, connection, hosts, credentials, bindHostCredential }) {
  const linkID = Number(connection?.link_id || 0)
  if (!connection?.host_id && !connection?.credential_id) {
    if (linkID) await api.deleteNetcattyLink(linkID)
    return null
  }
  const payload = buildNetcattyLinkPayload(assetType, assetId, connection, hosts, credentials)
  if (!payload) throw new Error('请选择有效的 Netcatty 主机或钥匙串')
  const host = hosts.find(item => item.id === payload.host_id)
  if (payload.host_id) {
    if (!api.netcattyLinks) throw new Error('无法检查当前资产的 Netcatty 主机关联，认证未更改')
    const result = await api.netcattyLinks({ asset_type: assetType, asset_id: assetId })
    const duplicate = (result.list || []).find(link => link.host_id === payload.host_id && Number(link.id) !== linkID)
    if (duplicate) throw new Error('该 Netcatty 主机已关联当前资产；另一身份请新建独立的 Netcatty 主机')
  }
  let bound = false
  if (payload.host_id && payload.credential_id) {
    if (!bindHostCredential) throw new Error('Netcatty 主机认证更新入口不可用')
    if (host.credentialId !== payload.credential_id) {
      if (!api.netcattyHostUsage) throw new Error('无法检查 Netcatty 主机的跨项目引用，认证未更改')
      const usage = await api.netcattyHostUsage({ host_id: payload.host_id, asset_type: assetType, asset_id: assetId })
      if (usage.other_references > 0) throw new Error('该 Netcatty 主机已被其他资产引用，请新建使用所选身份的主机，避免改变另一台设备的连接')
      await bindHostCredential(payload.host_id, payload.credential_id)
      bound = true
    }
  }
  try {
    if (linkID) {
      await api.updateNetcattyLink(linkID, payload)
      return linkID
    }
    const result = await api.createNetcattyLink(payload)
    return result?.id || null
  } catch (error) {
    if (bound) throw new Error(`Netcatty 主机认证已保存，但 Cmdb 引用保存失败：${error.message}。请保留主机 ${payload.host_id} 与身份 ${payload.credential_id}，在本资产重试关联。`)
    throw error
  }
}

export async function setDefaultNetcattyLink(api, target) {
  if (!target?.id || !target.host_id) throw new Error('请选择可连接的 Netcatty 主机')
  await api.setDefaultNetcattyLink(target.id)
}
