import { exportFile, importFile, requestJson } from './cmdbTransport'

async function req(url, opts = {}) {
  return requestJson(url, opts)
}

function toQuery(params = {}) {
  const sp = new globalThis.URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v)
  })
  return sp.toString()
}

export const api = {
  meta: () => req('/api/meta'),

  // 终端资产
  getAssets: (params = {}) => req(`/api/assets?${toQuery(params)}`),
  getAsset: (id) => req(`/api/assets/${id}`),
  getAssetRelations: (id) => req(`/api/assets/${id}/relations`),
  createAsset: (data) => req('/api/assets', { method: 'POST', body: JSON.stringify(data) }),
  updateAsset: (id, data) => req(`/api/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAsset: (id, data = {}) => req(`/api/assets/${id}`, { method: 'DELETE', body: JSON.stringify(data) }),
  transferUser: (id, data) => req(`/api/assets/${id}/transfer`, { method: 'POST', body: JSON.stringify(data) }),
  maintenance: (id, data) => req(`/api/assets/${id}/maintenance`, { method: 'POST', body: JSON.stringify(data) }),

  // 基础设施
  getServers: (params = {}) => req(`/api/servers?${toQuery(params)}`),
  getServer: (id) => req(`/api/servers/${id}`),
  createServer: (data) => req('/api/servers', { method: 'POST', body: JSON.stringify(data) }),
  updateServer: (id, data) => req(`/api/servers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteServer: (id) => req(`/api/servers/${id}`, { method: 'DELETE' }),

  // 业务系统与中间件
  getServerApps: (serverId) => req(`/api/servers/${serverId}/apps`),
  createServerApp: (serverId, data) => req(`/api/servers/${serverId}/apps`, { method: 'POST', body: JSON.stringify(data) }),
  updateApp: (id, data) => req(`/api/apps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteApp: (id) => req(`/api/apps/${id}`, { method: 'DELETE' }),
  getAllApps: (params = {}) => req(`/api/apps?${toQuery(params)}`),

  // 履历流水
  getLogs: (params = {}) => req(`/api/logs?${toQuery(params)}`),

  // IP 规划池
  getIPPool: (params = {}) => req(`/api/ip_pool?${toQuery(params)}`),
  getIPPoolSummary: () => req('/api/ip_pool/summary'),

  // IP 网段管理（子网定义）
  getIPSubnets: () => req('/api/ip_subnets'),
  createIPSubnet: (data) => req('/api/ip_subnets', { method: 'POST', body: JSON.stringify(data) }),
  updateIPSubnet: (id, data) => req(`/api/ip_subnets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteIPSubnet: (id) => req(`/api/ip_subnets/${id}`, { method: 'DELETE' }),
  createIPEntry: (data) => req('/api/ip_pool', { method: 'POST', body: JSON.stringify(data) }),
  updateIPEntry: (id, data) => req(`/api/ip_pool/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteIPEntry: (id, force = false) =>
    req(`/api/ip_pool/${id}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
  allocateIP: (id, data) => req(`/api/ip_pool/${id}/allocate`, { method: 'POST', body: JSON.stringify(data) }),
  releaseIP: (id) => req(`/api/ip_pool/${id}/release`, { method: 'POST', body: '{}' }),
  normalizeIPPool: () => req('/api/ip_pool/normalize', { method: 'POST', body: '{}' }),
  exportIPPool: (params = {}) =>
    exportFile(`/api/ip_pool/export?${toQuery(params)}`, 'ip_pool.xlsx'),

  getStats: () => req('/api/stats'),
  exportAssets: (params = {}) =>
    exportFile(`/api/export/assets?${toQuery(params)}`, 'terminal_assets.xlsx'),
  downloadTemplateUrl: () => '/api/template/assets',
  search: (q, limit = 20) => req(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  importSangfor: (file, commit = false, token) =>
    importFile('/api/import/sangfor', { file, commit, token }),
}
