import { canonicalNetworkType } from './assetTableModel.js'

const clean = (value) => String(value || '').trim()

export function infrastructureNetworkZoneOptions(values = []) {
  return [...new Set([
    ...values.filter(Boolean),
    '内网', '外网', '专网', '隔离网', '业务网', '带外 (OOB)', '未分类',
  ])]
}

export function infrastructureNamePresentation(record = {}) {
  const assetCode = clean(record.asset_code)
  const serialNumber = clean(record.sn || record.serial_number || record.box_sn)
  const deviceName = clean(record.name || record.device_name) || '未命名设备'
  return {
    name: assetCode || '未配置编码',
    secondary: [deviceName, serialNumber ? `SN：${serialNumber}` : '未配置 SN'].join(' · '),
  }
}

function appendUnique(parts, value) {
  const normalized = clean(value)
  if (normalized && !parts.includes(normalized)) parts.push(normalized)
}

function rackUnitLabel(record = {}) {
  const start = Number(record.start_u || record.u_start) || 0
  const height = Number(record.height_u || record.u_height) || 0
  if (!start) return clean(record.rack_unit)
  if (height > 1) return `${start}U–${start + height - 1}U`
  return `${start}U`
}

export function infrastructureLocationPresentation(record = {}) {
  const room = clean(record.room)
  const dataCenter = clean(record.data_center || record.area)
  const parts = []
  appendUnique(parts, room)
  appendUnique(parts, dataCenter)
  appendUnique(parts, record.floor)
  appendUnique(parts, record.cabinet_name || record.cabinet_pos)

  const rowColumn = []
  appendUnique(rowColumn, record.cabinet_row)
  if (Number(record.cabinet_col) > 0) appendUnique(rowColumn, `${Number(record.cabinet_col)} 列`)
  appendUnique(parts, rowColumn.join(' / '))
  appendUnique(parts, rackUnitLabel(record))

  if (!parts.length) {
    const type = clean(record.device_type || record.category_name || record.asset_class).toLowerCase()
    const virtual = /virtual_machine|虚拟机|云主机|容器|container|\bpod\b/.test(type)
    return { primary: virtual ? '无实体位置' : '未配置位置', secondary: '' }
  }
  return { primary: parts[0], secondary: parts.slice(1).join(' · ') }
}

function addAddress(target, seen, ip, purpose, zone) {
  const value = clean(ip)
  if (!value || seen.has(value)) return
  seen.add(value)
  target.push({ ip: value, purpose, zone: clean(zone) || '未配置' })
}

export function infrastructureNetworkSummary(record = {}) {
  const managementIP = clean(record.mgmt_ip || record.manage_ip)
  const managementInterface = (record.interfaces || []).find((iface) => {
    if (clean(iface.ip) === managementIP) return true
    try {
      return JSON.parse(iface.additional_ips_json || '[]').some((item) => clean(item.ip) === managementIP)
    } catch {
      return false
    }
  })
  const managementZone = clean(record.net_type || record.network_zone || record.net_zone || managementInterface?.network_zone || managementInterface?.net_zone) || '未配置'
  const management = { ip: managementIP, zone: managementZone }
  const secondary = []
  const seen = new Set(managementIP ? [managementIP] : [])

  addAddress(secondary, seen, record.biz_ip, '业务', record.biz_net_type || record.biz_network_zone)
  addAddress(secondary, seen, record.public_ip, '公网', record.public_net_type || '外网')
  for (const iface of record.interfaces || []) {
    const interfaceZone = iface.network_zone || iface.net_zone
    const mainPurpose = iface.main_ip_purpose || (iface.is_primary ? 'management' : '业务')
    const mainLabel = mainPurpose === 'management' ? '管理' : mainPurpose === 'out_of_band' ? '带外' : '业务'
    if (clean(iface.ip) !== managementIP) addAddress(secondary, seen, iface.ip, mainLabel, interfaceZone)
    let addresses = []
    try { addresses = JSON.parse(iface.additional_ips_json || '[]') } catch { addresses = [] }
    for (const address of Array.isArray(addresses) ? addresses : []) {
      const purposes = Array.isArray(address.purpose) ? address.purpose : [address.purpose || 'business']
      for (const purpose of purposes) {
        const label = purpose === 'management' ? '管理' : purpose === 'out_of_band' ? '带外' : '业务'
        addAddress(secondary, seen, address.ip, label, interfaceZone)
      }
    }
  }

  const zones = new Set([managementZone, ...secondary.map((item) => item.zone)].filter((zone) => zone && zone !== '未配置'))
  return {
    management,
    businessNetworkType: canonicalNetworkType(record.business_network_type),
    secondary,
    hasMultipleNetworks: zones.size > 1 || secondary.length > 0,
  }
}
