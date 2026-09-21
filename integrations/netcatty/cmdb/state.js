export const MODULES = [
  { key: 'assets', label: '设备资产', icon: 'Monitor' },
  { key: 'people', label: '组织架构', icon: 'Users' },
  { key: 'ip', label: 'IPAM/IP', icon: 'Network' },
  { key: 'operations', label: '统计与履历', icon: 'ChartNoAxesCombined' },
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
  if (payload.device_type && !isCloudDevice(payload.device_type)) payload.terminal_ip = ''
  return payload
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
