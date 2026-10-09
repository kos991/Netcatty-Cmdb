import { isCloudDevice } from './state.js'

export const TERMINAL_COLUMN_KEYS = [
  'asset_name',
  'device_type',
  'owner_department',
  'room',
  'ip',
  'network_type',
  'operating_system',
  'status',
  'actions',
]

export const INFRASTRUCTURE_COLUMN_KEYS = [
  'name',
  'device_type',
  'vendor_model',
  'operating_system',
  'owner_department',
  'location',
  'management_ip',
  'network_type',
  'status',
  'actions',
]

export const SYSTEM_COLUMN_KEYS = [
  'name_version',
  'app_type',
  'provider',
  'owner',
  'service_ip',
  'network_type',
  'host',
  'status',
  'actions',
]

export function visibleAssetColumnKeys(kind, density = 'wide') {
  const all = { terminal: TERMINAL_COLUMN_KEYS, infrastructure: INFRASTRUCTURE_COLUMN_KEYS, system: SYSTEM_COLUMN_KEYS }[kind] || []
  if (density === 'wide') return all
  const compact = {
    terminal: ['asset_name', 'device_type', 'ip', 'network_type', 'status', 'actions'],
    infrastructure: ['name', 'device_type', 'location', 'management_ip', 'network_type', 'status', 'actions'],
    system: ['name_version', 'app_type', 'provider', 'service_ip', 'network_type', 'status', 'actions'],
  }
  return compact[kind] || all
}

const clean = (value) => String(value ?? '').trim()
export const UNCONFIGURED_FILTER_VALUE = '__unconfigured__'

function ipamNetworkType(ip, entries = []) {
  if (!ip) return ''
  const entry = entries.find((item) => clean(item.ip) === ip)
  return clean(entry?.network_type || entry?.net_type || entry?.category)
}

export function terminalNetworkRows(asset = {}, ipamEntries = []) {
  const primaryIP = clean(asset.ip)
  const terminalIP = clean(asset.terminal_ip)
  const primaryNetwork = ipamNetworkType(primaryIP, ipamEntries) || clean(asset.ip_network_type) || clean(asset.net_type) || '未配置'
  const rows = []

  if (primaryIP) {
    rows.push({
      key: isCloudDevice(asset.device_type) ? 'business' : 'device',
      label: isCloudDevice(asset.device_type) ? '业务/虚拟机 IP' : '设备 IP',
      ip: primaryIP,
      networkType: primaryNetwork,
    })
  }
  if (isCloudDevice(asset.device_type) && terminalIP) {
    rows.push({
      key: 'terminal',
      label: '终端物理 IP',
      ip: terminalIP,
      networkType: ipamNetworkType(terminalIP, ipamEntries) || clean(asset.terminal_ip_network_type) || '未配置',
    })
  }
  return rows
}

export function applicationNetworkPresentation(app = {}) {
  return {
    ip: clean(app.service_ip),
    networkType: clean(app.network_type) || '未配置',
    port: clean(app.port),
  }
}

export function numericOrganizationPath(record = {}) {
  return {
    org_id: Number(record.org_id) || 0,
    department_id: Number(record.department_id) || 0,
    group_id: Number(record.group_id) || 0,
  }
}

export function normalizeGroupFilterValue(value) {
  if (value === '' || value === undefined || value === null) return ''
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : ''
}
