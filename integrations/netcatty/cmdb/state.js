export const MODULES = [
  { key: 'assets', label: '设备资产', icon: 'Monitor' },
  { key: 'people', label: '组织架构', icon: 'Users' },
  { key: 'ip', label: 'IPAM/IP', icon: 'Network' },
  { key: 'operations', label: '工单与统计', icon: 'ChartNoAxesCombined' },
  { key: 'config', label: '配置中心', icon: 'Settings2' },
]

const SEARCH_TARGETS = {
  assets: { module: 'assets', assetTab: 'terminals' },
  cmdb_assets: { module: 'assets', assetTab: 'infrastructure' },
  server_apps: { module: 'assets', assetTab: 'systems' },
  servers: { module: 'assets', assetTab: 'systems' },
  persons: { module: 'people' },
  asset_logs: { module: 'operations' },
  ip_pool: { module: 'ip' },
}

export function resolveSearchTarget(result) {
  const target = SEARCH_TARGETS[result?.tableKey]
  return target ? { ...target, focusTarget: result } : null
}

export function isCloudDevice(value = '') {
  return /云桌面|云盒|盒子/.test(String(value))
}

export function normalizeAsset(values) {
  const payload = { ...values }
  if (payload.device_type && !isCloudDevice(payload.device_type)) {
    payload.display_sn = ''
    payload.terminal_ip = ''
  }
  return payload
}

export function terminalSerialProfile(asset = {}) {
  const cloud = isCloudDevice(asset.device_type)
  return {
    cloud,
    primaryLabel: cloud ? '终端主机 SN' : '设备 SN',
    primaryValue: asset.box_sn || '',
    secondaryLabel: cloud ? '显示器 SN' : '',
    secondaryValue: cloud ? asset.display_sn || '' : '',
  }
}

export function ipAddressPresentation(row = {}) {
  if (['网络地址', '广播地址'].includes(row.status)) return { kind: 'special', label: `${row.status}（不可分配）` }
  if (row.owner_type || row.asset_code || ['已分配', '已占用', '占用', '在用'].includes(row.status)) return { kind: 'used', label: '已占用' }
  if (['不可用', '冲突', '异常'].includes(row.status)) return { kind: 'abnormal', label: row.status }
  if (row.status === '保留') return { kind: 'reserved', label: '保留' }
  return { kind: 'free', label: row.status || '空闲' }
}

export function infrastructureFieldProfile(value = '') {
  const type = String(value).trim().toLowerCase()
  const isVirtual = /virtual|虚拟机|云主机|云资源|ecs|容器|docker|pod/.test(type)
  const isNetwork = /switch|router|security|交换机|路由器|防火墙|安全设备|网闸|负载均衡/.test(type)
  const isServer = /server|服务器|物理主机|超融合|hyperconverged|hci|云桌面平台/.test(type)
  if (isVirtual) return { kind: 'virtual', brandModel: false, cpu: false, memory: true, disk: true, os: true, provider: true, deviceMac: false, virtualCompute: true, systemSection: '计算与系统' }
  if (isNetwork) return { kind: 'network', brandModel: true, cpu: false, memory: false, disk: false, os: false, provider: true, deviceMac: false, virtualCompute: false, systemSection: '' }
  if (isServer) return { kind: 'server', brandModel: true, cpu: true, memory: true, disk: true, os: true, provider: true, deviceMac: true, virtualCompute: false, systemSection: '硬件与系统' }
  if (/storage|存储/.test(type)) return { kind: 'storage', brandModel: true, cpu: false, memory: false, disk: true, os: false, provider: true, deviceMac: false, virtualCompute: false, systemSection: '存储配置' }
  return { kind: 'generic', brandModel: true, cpu: false, memory: false, disk: false, os: false, provider: true, deviceMac: false, virtualCompute: false, systemSection: '' }
}

export function supportsInfrastructurePhotos(asset = {}) {
  return asset.asset_class !== 'virtual'
    && infrastructureFieldProfile(asset.category_name || asset.device_type || '').kind !== 'virtual'
}

export function isServerInfrastructure(value = '') {
  const type = typeof value === 'object'
    ? [value.category_name, value.device_type, value.asset_class].filter(Boolean).join(' ')
    : String(value)
  return /server|服务器|物理主机|虚拟机|virtual_machine|云主机|云资源|ecs|超融合|hyperconverged|hci/.test(type.trim().toLowerCase())
}

export function isApplicationHostInfrastructure(value = '') {
  const type = typeof value === 'object'
    ? [value.category_name, value.device_type].filter(Boolean).join(' ')
    : String(value)
  return !/switch|router|交换机|路由器/.test(type.trim().toLowerCase())
}

const INFRASTRUCTURE_TYPE_LABELS = {
  server: '服务器',
  virtual_machine: '虚拟机',
  hyperconverged: '超融合',
  switch: '交换机',
  router: '路由器',
  security_device: '安全设备',
  storage: '存储设备',
}

export function infrastructureDeviceTypeOptions(deviceTypes = [], current = {}) {
  const options = deviceTypes.map((item) => ({ value: item.id, label: item.name }))
  if (Number(current.category_id) || !current.device_type) return options
  return [{ value: 0, label: INFRASTRUCTURE_TYPE_LABELS[current.device_type] || current.device_type }, ...options]
}

export function customFieldDefinitions(definitions = [], assetClass = 'physical') {
  return definitions
    .filter((field) => !field.asset_class || field.asset_class === 'all' || field.asset_class === assetClass)
    .map((field) => ({
      key: field.field_key,
      label: field.field_name,
      type: field.field_type === 'select' ? undefined : field.field_type,
      required: !!field.required,
      custom: true,
      ...(field.field_type === 'select' ? { options: field.options || [] } : {}),
    }))
}

export function netcattyDirectorySummaries({ hosts = [], identities = [], keys = [] } = {}) {
  return {
    hosts: hosts.map((host) => ({
      id: host.id,
      label: host.label || host.hostname || host.id,
      hostname: host.hostname || '',
      port: Number(host.port || 0),
      protocol: host.protocol || 'ssh',
      credentialId: host.identityId || host.identityFileId || '',
      ...(host.os ? { os: host.os } : {}),
      ...(host.distro ? { distro: host.distro } : {}),
      ...(host.distroMode ? { distroMode: host.distroMode } : {}),
      ...(host.manualDistro ? { manualDistro: host.manualDistro } : {}),
      ...(host.deviceType ? { deviceType: host.deviceType } : {}),
    })),
    credentials: [
      ...identities.map((identity) => ({ id: identity.id, label: identity.label || identity.username || identity.id, type: identity.authMethod || 'identity', kind: 'identity', username: identity.username || '' })),
      ...keys.map((key) => ({ id: key.id, label: key.label || key.id, type: key.type || 'key', kind: 'key', username: '' })),
    ],
  }
}

export function flattenOrgTree(nodes = [], depth = 0, output = []) {
  nodes.forEach((node) => {
    output.push({ ...node, depth })
    flattenOrgTree(node.children || [], depth + 1, output)
  })
  return output
}

export function nowText() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatLocalDateTimeInput(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function shiftWorkOrderDate(day, offset) {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + offset)
  return formatLocalDateTimeInput(date).slice(0, 10)
}

export function workOrderDeskFilters(filters = {}, dateScope = {}) {
  const dates = dateScope.mode === 'day'
    ? { date_from: dateScope.day, date_to: dateScope.day }
    : dateScope.mode === 'range'
      ? { date_from: dateScope.from, date_to: dateScope.to }
      : {}
  return normalizeWorkOrderFilters({ ...filters, ...dates })
}

export function normalizeWorkOrderFilters(filters = {}) {
  const normalized = {}
  Object.entries(filters).forEach(([key, raw]) => {
    const value = typeof raw === 'string' ? raw.trim() : raw
    if (value === '' || value === undefined || value === null) return
    normalized[key] = value
  })
  if (normalized.date_from && /^\d{4}-\d{2}-\d{2}$/.test(normalized.date_from)) normalized.date_from += ' 00:00:00'
  if (normalized.date_to && /^\d{4}-\d{2}-\d{2}$/.test(normalized.date_to)) normalized.date_to += ' 23:59:59'
  return normalized
}
