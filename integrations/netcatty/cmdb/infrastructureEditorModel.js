const normalizeModelPart = (value) => String(value || '').trim().toLocaleLowerCase()

export function resolveInfrastructureModelID(models = [], vendor, model) {
  const normalizedVendor = normalizeModelPart(vendor)
  const normalizedModel = normalizeModelPart(model)
  if (!normalizedVendor || !normalizedModel) return 0

  const matches = models.filter((item) => normalizeModelPart(item.vendor) === normalizedVendor
    && normalizeModelPart(item.model) === normalizedModel)
  return matches.length === 1 ? Number(matches[0].id) || 0 : 0
}

export function prepareInfrastructureEditorValues(record = {}, models = []) {
  const values = { ...record, interfaces: [...(record.interfaces || [])] }
  if (!values.device_type && !values.category_id && values.source_type === 'legacy_server') values.device_type = 'server'
  if (!Number(values.model_id)) {
    values.model_id = resolveInfrastructureModelID(models, values.vendor, values.model)
  }

  const managementIP = String(values.mgmt_ip || values.manage_ip || managementIPFromInterfaces(values.interfaces)).trim()
  values.mgmt_ip = managementIP
  values.manage_ip = managementIP
  if (managementIP) values.interfaces = values.interfaces.map(item => ({ ...item, is_primary: String(item.ip || '').trim() === managementIP ? 1 : 0 }))

  return values
}

export function managementIPFromInterfaces(interfaces = []) {
  return String(interfaces.find((item) => item.is_primary)?.ip || '').trim()
}

export function infrastructureSavePayload(values) {
  const managementIP = String(values.mgmt_ip || '').trim()
  const interfaces = (values.interfaces || []).map(item => {
    const mainIP = String(item.ip || '').trim()
    const byIP = new Map()
    for (const address of additionalEditorRows(item.additional_ips_json, item.name || item.if_name || '未命名')) {
      const ip = String(address.ip || '').trim()
      if (!ip) continue
      if (ip === mainIP && mainIP !== managementIP && address.purpose === 'business') continue
      const purposes = byIP.get(ip) || []
      if (!purposes.includes(address.purpose)) purposes.push(address.purpose)
      byIP.set(ip, purposes)
    }
    const additional = [...byIP].map(([ip, purposes]) => ({ ip, purpose: purposes.length === 1 ? purposes[0] : purposes }))
    const withoutPurpose = { ...item }
    delete withoutPurpose.purpose
    return { ...withoutPurpose, ip: String(item.ip || '').trim(), additional_ips_json: JSON.stringify(additional), is_primary: managementIP && String(item.ip || '').trim() === managementIP ? 1 : 0 }
  })
  return { ...values, interfaces, mgmt_ip: managementIP, manage_ip: managementIP }
}

export function parseAdditionalIPs(value, interfaceName = '未命名') {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
  } catch { /* 下方统一给出接口级错误。 */ }
  throw new Error(`接口 ${interfaceName} 的附加地址格式无效`)
}

export function additionalEditorRows(value, interfaceName) {
  return parseAdditionalIPs(value, interfaceName).flatMap(address => {
    const purposes = Array.isArray(address.purpose) ? address.purpose : [address.purpose || 'business']
    return purposes.map(purpose => ({ ip: address.ip || '', purpose }))
  })
}

export function networkAddressRows(asset = {}) {
  const rows = new Map()
  const add = (value, purpose, iface) => {
    const ip = String(value || '').trim()
    if (!ip) return
    const labels = { management: '管理', business: '业务', out_of_band: '带外' }
    const row = rows.get(ip) || { ip, purposes: [], interfaceName: '', interfaceID: 0, networkZone: '', mask: '', gateway: '', vlanID: 0 }
    if (purpose) {
      const label = labels[purpose] || '业务'
      if (!row.purposes.includes(label)) row.purposes.push(label)
    }
    if (iface && !row.interfaceName) {
      row.interfaceName = iface.name || iface.if_name || ''
      row.interfaceID = iface.id || 0
      row.networkZone = iface.network_zone || iface.net_zone || ''
      row.mask = iface.mask || ''
      row.gateway = iface.gateway || ''
      row.vlanID = iface.vlan_id || 0
    }
    rows.set(ip, row)
  }
  add(asset.mgmt_ip || asset.manage_ip, 'management')
  add(asset.biz_ip, 'business')
  for (const iface of asset.interfaces || []) {
    const mainIP = String(iface.ip || '').trim()
    const managementIP = String(asset.mgmt_ip || asset.manage_ip || '').trim()
    add(mainIP, !managementIP && iface.is_primary ? 'management' : mainIP === managementIP || mainIP === String(asset.biz_ip || '').trim() ? '' : 'business', iface)
    for (const address of additionalEditorRows(iface.additional_ips_json, iface.name || iface.if_name || '未命名')) add(address.ip, address.purpose, iface)
  }
  return [...rows.values()]
}

export async function saveInfrastructureDraftPhotos(id, draft = {}, saveImage) {
  for (const [side, label] of [['front', '正面'], ['back', '背面']]) {
    const key = `${side}_image`
    if (!Object.hasOwn(draft, key)) continue
    try {
      await saveImage('infrastructure', id, side, draft[key])
    } catch (error) {
      throw new Error(`资产已保存，但${label}照片上传失败：${error.message || '未知错误'}`)
    }
  }
}
