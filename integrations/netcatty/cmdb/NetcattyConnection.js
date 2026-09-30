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
  const bound = !!payload.host_id && !!payload.credential_id
  if (bound) {
    if (!bindHostCredential) throw new Error('Netcatty 主机认证更新入口不可用')
    if (api.netcattyLinks) {
      const result = await api.netcattyLinks()
      const existing = (result.list || []).find(link => link.host_id === payload.host_id && Number(link.id) !== linkID)
      if (existing && (existing.asset_type !== assetType || Number(existing.asset_id) !== Number(assetId))) throw new Error('该 Netcatty 主机已被其他资产引用，请新建使用所选身份的主机，避免改变另一台设备的连接')
      if (existing) throw new Error('该 Netcatty 主机已关联当前资产；多个账号请分别新建 Netcatty 主机')
    }
    await bindHostCredential(payload.host_id, payload.credential_id)
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

export async function setDefaultNetcattyLink(api, target, links = []) {
  if (!target?.id || !target.host_id) throw new Error('请选择可连接的 Netcatty 主机')
  if (!target.is_primary) await api.updateNetcattyLink(target.id, { ...target, is_primary: true })
  for (const link of links) {
    if (link.id === target.id || !link.host_id || !link.is_primary) continue
    try {
      await api.updateNetcattyLink(link.id, { ...link, is_primary: false })
    } catch (error) {
      throw new Error(`连接 ${target.id} 已设为默认，但旧默认连接 ${link.id} 未能取消：${error.message}。请刷新后重试。`)
    }
  }
}
