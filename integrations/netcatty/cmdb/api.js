import { exportFile, importFile, requestJson } from './transport'

function toQuery(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  return query.toString()
}

const req = (path, options) => requestJson(path, options)
const post = (path, body = {}) => req(path, { method: 'POST', body: JSON.stringify(body) })
const put = (path, body = {}) => req(path, { method: 'PUT', body: JSON.stringify(body) })
const del = (path, body) => req(path, { method: 'DELETE', ...(body ? { body: JSON.stringify(body) } : {}) })

export const api = {
  meta: () => req('/api/meta'),
  projects: () => req('/api/cmdb/projects'),
  updateProject: (id, body) => put(`/api/cmdb/projects/${id}`, body),
  search: (q, limit = 50) => req(`/api/search?${toQuery({ q, limit })}`),

  assets: (params = {}) => req(`/api/assets?${toQuery(params)}`),
  asset: (id) => req(`/api/assets/${id}`),
  assetRelations: (id) => req(`/api/assets/${id}/relations`),
  createAsset: (body) => post('/api/assets', body),
  updateAsset: (id, body) => put(`/api/assets/${id}`, body),
  archiveAsset: (id) => del(`/api/assets/${id}`, { reason: '资产注销归档', operator: '资产管理员' }),
  transferAsset: (id, body) => post(`/api/assets/${id}/transfer`, body),
  maintainAsset: (id, body) => post(`/api/assets/${id}/maintenance`, body),
  exportAssets: (params = {}) => exportFile(`/api/export/assets?${toQuery(params)}`, 'terminal_assets.xlsx'),
  importAssets: (commit = false, token) => importFile('/api/import/assets', { commit, token }),
  downloadAssetTemplate: () => exportFile('/api/template/assets', 'terminal_asset_template.xlsx'),

  servers: (params = {}) => req(`/api/servers?${toQuery(params)}`),
  server: (id) => req(`/api/servers/${id}`),
  createServer: (body) => post('/api/servers', body),
  updateServer: (id, body) => put(`/api/servers/${id}`, body),
  deleteServer: (id) => del(`/api/servers/${id}`),
  apps: (params = {}) => req(`/api/apps?${toQuery(params)}`),
  serverApps: (serverId) => req(`/api/servers/${serverId}/apps`),
  createApp: (serverId, body) => post(`/api/servers/${serverId}/apps`, body),
  updateApp: (id, body) => put(`/api/apps/${id}`, body),
  deleteApp: (id) => del(`/api/apps/${id}`),
  importSangfor: (commit = false, token) => importFile('/api/import/sangfor', { commit, token }),

  infrastructure: (params = {}) => req(`/api/cmdb/assets?${toQuery(params)}`),
  infrastructureAsset: (id) => req(`/api/cmdb/assets/${id}`),
  infrastructureFilters: () => req('/api/cmdb/assets/filters'),
  createInfrastructure: (body) => post('/api/cmdb/assets', body),
  updateInfrastructure: (id, body) => put(`/api/cmdb/assets/${id}`, body),
  replaceInfrastructure: (id, body) => put(`/api/cmdb/assets/${id}/full`, body),
  deleteInfrastructure: (id) => del(`/api/cmdb/assets/${id}`),
  batchInfrastructure: (ids, action, changes) => post('/api/cmdb/assets/batch', { ids, action, changes }),
  exportInfrastructure: (params = {}) => exportFile(`/api/cmdb/assets/export?${toQuery(params)}`, 'cmdb_assets.xlsx'),
  importInfrastructure: (commit = false, token) => importFile('/api/cmdb/assets/import', { commit, token }),
  syncInfrastructure: () => post('/api/cmdb/sync/legacy'),

  persons: (params = {}) => req(`/api/cmdb/persons?${toQuery(params)}`),
  createPerson: (body) => post('/api/cmdb/persons', body),
  updatePerson: (id, body) => put(`/api/cmdb/persons/${id}`, body),
  deletePerson: (id) => del(`/api/cmdb/persons/${id}`),
  personAssets: (id) => req(`/api/cmdb/persons/${id}/assets`),
  transferPersonAssets: (body) => post('/api/cmdb/persons/transfer', body),

  orgTree: () => req('/api/cmdb/config/org-tree'),
  config: (kind) => req(`/api/cmdb/config/${kind}`),
  createConfig: (kind, body) => post(`/api/cmdb/config/${kind}`, body),
  updateConfig: (kind, id, body) => put(`/api/cmdb/config/${kind}/${id}`, body),
  deleteConfig: (kind, id) => del(`/api/cmdb/config/${kind}/${id}`),
  customFields: () => req('/api/cmdb/custom-fields'),
  saveCustomField: (body) => post('/api/cmdb/custom-fields', body),
  deleteCustomField: (id) => del(`/api/cmdb/custom-fields/${id}`),
  models: (params = {}) => req(`/api/cmdb/models?${toQuery(params)}`),
  createModel: (body) => post('/api/cmdb/models', body),
  updateModel: (id, body) => put(`/api/cmdb/models/${id}`, body),
  deleteModel: (id) => del(`/api/cmdb/models/${id}`),

  ipSummary: () => req('/api/ip_pool/summary'),
  ipSubnets: () => req('/api/ip_subnets'),
  createSubnet: (body) => post('/api/ip_subnets', body),
  updateSubnet: (id, body) => put(`/api/ip_subnets/${id}`, body),
  deleteSubnet: (id) => del(`/api/ip_subnets/${id}`),
  ipEntries: (params = {}) => req(`/api/ip_pool?${toQuery(params)}`),
  ipVisualization: (params = {}) => req(`/api/ip_pool/visualization?${toQuery(params)}`),
  createIP: (body) => post('/api/ip_pool', body),
  updateIP: (id, body) => put(`/api/ip_pool/${id}`, body),
  deleteIP: (id, force = false) => del(`/api/ip_pool/${id}${force ? '?force=1' : ''}`),
  allocateIP: (id, body) => post(`/api/ip_pool/${id}/allocate`, body),
  releaseIP: (id) => post(`/api/ip_pool/${id}/release`),
  exportIPs: (params = {}) => exportFile(`/api/ip_pool/export?${toQuery(params)}`, 'ip_pool.xlsx'),

  stats: () => req('/api/stats'),
  cmdbDashboard: () => req('/api/cmdb/dashboard'),
  logs: (params = {}) => req(`/api/logs?${toQuery(params)}`),

  workOrders: (params = {}) => req(`/api/cmdb/work-orders?${toQuery(params)}`),
  createWorkOrder: (body) => post('/api/cmdb/work-orders', body),
  updateWorkOrder: (id, body) => put(`/api/cmdb/work-orders/${id}`, body),
  deleteWorkOrder: (id) => del(`/api/cmdb/work-orders/${id}`),
  exportWorkOrders: (params = {}) => exportFile(`/api/cmdb/work-orders/export?${toQuery(params)}`, 'cmdb_work_orders.xlsx'),

  credentials: (params = {}) => req(`/api/cmdb/credentials?${toQuery(params)}`),
  createCredential: (body) => post('/api/cmdb/credentials', body),
  updateCredential: (id, body) => put(`/api/cmdb/credentials/${id}`, body),
  deleteCredential: (id) => del(`/api/cmdb/credentials/${id}`),

  labels: (params = {}) => req(`/api/cmdb/labels?${toQuery(params)}`),
  generateLabels: () => post('/api/cmdb/labels/generate'),
  repairLabels: () => post('/api/cmdb/labels/repair'),
  printLabels: (ids) => post('/api/cmdb/labels/print', { ids }),
  printedLabels: () => req('/api/cmdb/labels/printed'),
  labelRule: () => req('/api/cmdb/labels/rule'),
  saveLabelRule: (prefix) => put('/api/cmdb/labels/rule', { prefix }),
  setLabelStatus: (id, status) => put(`/api/cmdb/labels/${id}/status`, { status }),
  deleteLabel: (id) => del(`/api/cmdb/labels/${id}`),
}
