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
  'management_ip',
  'network_type',
  'location',
  'owner_department',
  'status',
  'actions',
]

export const SYSTEM_COLUMN_KEYS = [
  'name_code',
  'app_type',
  'version',
  'host',
  'service_ip',
  'network_type',
  'owner',
  'status',
  'actions',
]

export function visibleAssetColumnKeys(kind) {
  return { terminal: TERMINAL_COLUMN_KEYS, infrastructure: INFRASTRUCTURE_COLUMN_KEYS, system: SYSTEM_COLUMN_KEYS }[kind] || []
}

const clean = (value) => String(value ?? '').trim()
export const UNCONFIGURED_FILTER_VALUE = '__unconfigured__'

export function canonicalNetworkType(value) {
  const normalized = clean(value).toLowerCase()
  if (!normalized) return '未配置'
  if (/外网|公网|internet|\bwan\b/.test(normalized)) return '外网'
  if (/专网|政法/.test(normalized)) return '专网'
  if (/内网|业务网|管理网|隔离网|\blan\b/.test(normalized)) return '内网'
  return '未配置'
}

export function validIPv4(value) {
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

const TERMINAL_HARDWARE_FIELDS = [
  { key: 'vendor', label: '品牌 / 厂商' },
  { key: 'model', label: '型号' },
  { key: 'cpu_info', label: 'CPU 配置' },
  { key: 'memory_mb', label: '内存（MB）', type: 'number', min: 0 },
  { key: 'disk_info', label: '硬盘 / 磁盘配置' },
]

export function terminalHardwareFields(deviceType) {
  return /台式|笔记本/.test(clean(deviceType)) && !isCloudDevice(deviceType) ? TERMINAL_HARDWARE_FIELDS : []
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
