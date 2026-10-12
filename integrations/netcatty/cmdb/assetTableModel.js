import { isCloudDevice } from './state.js'

export const TERMINAL_COLUMN_KEYS = [
  'asset_code',
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
  'asset_code',
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
    terminal: ['asset_code', 'device_type', 'ip', 'network_type', 'status', 'actions'],
    infrastructure: ['asset_code', 'device_type', 'location', 'management_ip', 'network_type', 'status', 'actions'],
    system: ['name_version', 'app_type', 'provider', 'service_ip', 'network_type', 'status', 'actions'],
  }
  return compact[kind] || all
}

const clean = (value) => String(value ?? '').trim()
export const UNCONFIGURED_FILTER_VALUE = '__unconfigured__'

export function canonicalNetworkType(value) {
  const normalized = clean(value).toLowerCase()
  if (!normalized) return '未配置'
  if (/外网|公网|internet|\bwan\b/.test(normalized)) return '外网'
  if (/内网|专网|政法|业务网|管理网|隔离网|\blan\b/.test(normalized)) return '内网'
  return '未配置'
}

function validIPv4(value) {
  const parts = clean(value).split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

export function terminalNetworkRows(asset = {}) {
  const primaryIP = clean(asset.ip)
  const terminalIP = clean(asset.terminal_ip)
  const rows = []

  if (validIPv4(primaryIP)) {
    rows.push({
      key: isCloudDevice(asset.device_type) ? 'business' : 'device',
      label: isCloudDevice(asset.device_type) ? '业务/虚拟机 IP' : '设备 IP',
      ip: primaryIP,
    })
  }
  if (isCloudDevice(asset.device_type) && validIPv4(terminalIP)) {
    rows.push({
      key: 'terminal',
      label: '终端物理 IP',
      ip: terminalIP,
    })
  }
  return rows
}

export function terminalBusinessNetworkType(asset = {}) {
  return canonicalNetworkType(asset.ip_network_type)
}

export function applicationNetworkPresentation(app = {}) {
  return {
    ip: clean(app.service_ip),
    networkType: canonicalNetworkType(app.network_type),
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
