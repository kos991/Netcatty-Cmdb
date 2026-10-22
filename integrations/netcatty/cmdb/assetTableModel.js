import { isCloudDevice } from './state.js'

export const TERMINAL_COLUMN_KEYS = [
  'asset_code',
  'device_type',
  'vendor_model',
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
  'access_url',
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
  const text = clean(value)
  const normalized = text.toLowerCase()
  if (!normalized) return '未配置'
  if (/外网|公网|internet|\bwan\b/.test(normalized)) return '外网'
  if (/专网|政法/.test(normalized)) return '专网'
  if (/内网|业务网|管理网|隔离网|\blan\b/.test(normalized)) return '内网'
  return text
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

// 所有实体终端共用品牌/型号；计算硬件仍由 terminalHardwareFields 按设备类型决定。
export function terminalBrandFields(deviceType) {
  return clean(deviceType) ? TERMINAL_HARDWARE_FIELDS.filter(({ key }) => key === 'vendor' || key === 'model') : []
}

export function terminalBusinessNetworkType(asset = {}) {
  return canonicalNetworkType(asset.ip_network_type)
}

export function applicationNetworkPresentation(app = {}) {
  return {
    ip: clean(app.service_ip),
    networkType: validIPv4(app.service_ip) ? canonicalNetworkType(app.network_type) : '未配置',
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

const MASKED_SECRET = '******'

// 展示层脱敏：账号/口令形如 user/pass 或带明文口令的文本，只保留账号。
// 仅用于列表与详情展示，不回写数据库，避免历史误录数据继续外泄。
export function maskCredentialText(value) {
  const text = clean(value)
  if (!text) return ''
  const pair = text.match(/^([^\s/]{1,64})\s*\/\s*(\S+)$/)
  if (pair) return `${pair[1]}/${MASKED_SECRET}`
  if (/密码|口令|password|passwd|pwd/i.test(text)) return text.replace(/([:：=]\s*)\S+/g, `$1${MASKED_SECRET}`)
  return text
}

export function maskCredentialFields(record = {}, keys = []) {
  const next = { ...record }
  for (const key of keys) {
    if (key in next) next[key] = maskCredentialText(next[key])
  }
  return next
}


export function networkTypeDefinition(value, definitions = []) {
  const name = clean(value)
  if (!name) return null
  for (const item of definitions) {
    if (typeof item === 'string') {
      if (clean(item) === name) return { name, color: '' }
      continue
    }
    if (clean(item?.name) === name) return item
  }
  return null
}

// 圆点颜色必须是可渲染的具体颜色；未配置或目录缺色时回退中性灰。
export function networkTypeColor(value, definitions = []) {
  const color = clean(networkTypeDefinition(value, definitions)?.color)
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : 'rgb(148 163 184)'
}
