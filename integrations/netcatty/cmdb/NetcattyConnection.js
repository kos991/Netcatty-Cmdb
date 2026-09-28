export const EMPTY_NETCATTY_CONNECTION = Object.freeze({ host_id: '', credential_id: '' })

export function connectionFromLinks(links = []) {
  const link = links.find((item) => item.is_primary) || links[0]
  return link ? { host_id: link.host_id || '', credential_id: link.credential_id || '', link_id: link.id } : { ...EMPTY_NETCATTY_CONNECTION }
}

export function selectNetcattyHost(connection, hostID, hosts = []) {
  const host = hosts.find((item) => item.id === hostID)
  return {
    ...connection,
    host_id: hostID || '',
    credential_id: host ? (host.credentialId || connection.credential_id || '') : (connection.credential_id || ''),
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
    is_primary: !!host,
    state: 'linked',
  }
}

export async function persistNetcattyConnection(api, { assetType, assetId, connection, hosts, credentials }) {
  const linkID = Number(connection?.link_id || 0)
  if (!connection?.host_id && !connection?.credential_id) {
    if (linkID) await api.deleteNetcattyLink(linkID)
    return null
  }
  const payload = buildNetcattyLinkPayload(assetType, assetId, connection, hosts, credentials)
  if (!payload) throw new Error('请选择有效的 Netcatty 主机或钥匙串')
  if (linkID) {
    await api.updateNetcattyLink(linkID, payload)
    return linkID
  }
  const result = await api.createNetcattyLink(payload)
  return result?.id || null
}
