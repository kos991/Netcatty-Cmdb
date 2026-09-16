const BASE = ''

async function req(url, opts = {}) {
  const headers = opts.body instanceof FormData
    ? { ...opts.headers }
    : { 'Content-Type': 'application/json', ...opts.headers }
  const r = await fetch(BASE + url, {
    headers,
    ...opts,
  })
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try {
      const j = await r.json()
      if (j.error) msg = j.error
    } catch (_) {}
    throw new Error(msg)
  }
  return r.json()
}

export const api = {
  meta: () => req('/api/meta'),

  // 终端资产
  getAssets: (params = {}) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v)
    })
    return req(`/api/assets?${sp.toString()}`)
  },
  getAsset: (id) => req(`/api/assets/${id}`),
  getAssetRelations: (id) => req(`/api/assets/${id}/relations`),
  createAsset: (data) => req('/api/assets', { method: 'POST', body: JSON.stringify(data) }),
  updateAsset: (id, data) => req(`/api/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAsset: (id, data = {}) => req(`/api/assets/${id}`, { method: 'DELETE', body: JSON.stringify(data) }),
  transferUser: (id, data) => req(`/api/assets/${id}/transfer`, { method: 'POST', body: JSON.stringify(data) }),
  maintenance: (id, data) => req(`/api/assets/${id}/maintenance`, { method: 'POST', body: JSON.stringify(data) }),

  // 物理服务器
  getServers: (params = {}) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v)
    })
    return req(`/api/servers?${sp.toString()}`)
  },
  getServer: (id) => req(`/api/servers/${id}`),
  createServer: (data) => req('/api/servers', { method: 'POST', body: JSON.stringify(data) }),
  updateServer: (id, data) => req(`/api/servers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteServer: (id) => req(`/api/servers/${id}`, { method: 'DELETE' }),

  // 系统应用与中间件
  getServerApps: (serverId) => req(`/api/servers/${serverId}/apps`),
  createServerApp: (serverId, data) => req(`/api/servers/${serverId}/apps`, { method: 'POST', body: JSON.stringify(data) }),
  updateApp: (id, data) => req(`/api/apps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteApp: (id) => req(`/api/apps/${id}`, { method: 'DELETE' }),
  getAllApps: (params = {}) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v)
    })
    return req(`/api/apps?${sp.toString()}`)
  },

  // 履历流水
  getLogs: (params = {}) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v)
    })
    return req(`/api/logs?${sp.toString()}`)
  },

  // IP 规划池
  getIPPool: (params = {}) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v)
    })
    return req(`/api/ip_pool?${sp.toString()}`)
  },
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
  exportIPPoolUrl: (params = {}) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v)
    })
    return `${BASE}/api/ip_pool/export?${sp.toString()}`
  },

  getStats: () => req('/api/stats'),
  exportAssetsUrl: (params = {}) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v)
    })
    return `${BASE}/api/export/assets?${sp.toString()}`
  },
  downloadTemplateUrl: () => `${BASE}/api/template/assets`,
  search: (q, limit = 20) => req(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  importSangfor: (file, commit = false) => {
    const form = new FormData()
    form.append('file', file)
    return req(`/api/import/sangfor${commit ? '?commit=1' : ''}`, { method: 'POST', body: form, headers: {} })
  },
}
