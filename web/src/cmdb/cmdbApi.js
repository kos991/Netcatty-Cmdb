import { exportFile, importFile, requestJson } from '../cmdbTransport'

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

const post = (url, data) => req(url, { method: 'POST', body: JSON.stringify(data || {}) })
const put = (url, data) => req(url, { method: 'PUT', body: JSON.stringify(data || {}) })
const del = (url) => req(url, { method: 'DELETE' })

export const cmdbApi = {
  // 资源管理
  meta: () => req('/api/cmdb/meta'),
  listAssets: (params = {}) => req(`/api/cmdb/assets?${toQuery(params)}`),
  getAsset: (id) => req(`/api/cmdb/assets/${id}`),
  syncLegacy: () => req('/api/cmdb/sync/legacy', { method: 'POST' }),

  // 资源写操作（批量编辑 / 克隆 / 归档）
  createAsset: (d) => post('/api/cmdb/assets', d),
  updateAsset: (id, d) => put(`/api/cmdb/assets/${id}`, d),
  deleteAsset: (id) => del(`/api/cmdb/assets/${id}`),
  batchAssets: (ids, action, changes) =>
    post('/api/cmdb/assets/batch', { ids, action, changes }),
  assetFilters: () => req('/api/cmdb/assets/filters'),
  exportAssets: (params = {}) =>
    exportFile(`/api/cmdb/assets/export?${toQuery(params)}`, 'cmdb_assets.xlsx'),
  templateUrl: () => '/api/cmdb/assets/template',
  importAssets: (file, commit = false, token) =>
    importFile('/api/cmdb/assets/import', { file, commit, token }),

  // 人员管理与名下资产穿透
  listPersons: (p = {}) => req(`/api/cmdb/persons?${toQuery(p)}`),
  createPerson: (d) => post('/api/cmdb/persons', d),
  updatePerson: (id, d) => put(`/api/cmdb/persons/${id}`, d),
  deletePerson: (id) => del(`/api/cmdb/persons/${id}`),
  getPersonAssets: (id) => req(`/api/cmdb/persons/${id}/assets`),
  transferPersonAssets: (d) => post('/api/cmdb/persons/transfer', d),

  // 自定义字段
  listCustomFields: () => req('/api/cmdb/custom-fields'),
  saveCustomField: (d) => post('/api/cmdb/custom-fields', d),
  deleteCustomField: (id) => del(`/api/cmdb/custom-fields/${id}`),

  // 仪表盘
  dashboard: () => req('/api/cmdb/dashboard'),

  // 工单管理
  listWorkOrders: (p = {}) => req(`/api/cmdb/work-orders?${toQuery(p)}`),
  createWorkOrder: (d) => post('/api/cmdb/work-orders', d),
  updateWorkOrder: (id, d) => put(`/api/cmdb/work-orders/${id}`, d),
  deleteWorkOrder: (id) => del(`/api/cmdb/work-orders/${id}`),

  // 资产盘点
  listInventory: (p = {}) => req(`/api/cmdb/inventory?${toQuery(p)}`),
  createInventory: (d) => post('/api/cmdb/inventory', d),
  updateInventory: (id, d) => put(`/api/cmdb/inventory/${id}`, d),
  deleteInventory: (id) => del(`/api/cmdb/inventory/${id}`),

  // 凭证中心
  listCredentials: (p = {}) => req(`/api/cmdb/credentials?${toQuery(p)}`),
  createCredential: (d) => post('/api/cmdb/credentials', d),
  updateCredential: (id, d) => put(`/api/cmdb/credentials/${id}`, d),
  deleteCredential: (id) => del(`/api/cmdb/credentials/${id}`),

  // 编码与标签
  listLabels: (p = {}) => req(`/api/cmdb/labels?${toQuery(p)}`),
  generateLabels: (prefix) => post('/api/cmdb/labels/generate', { prefix }),
  repairLabels: () => post('/api/cmdb/labels/repair'),
  printLabels: (ids) => post('/api/cmdb/labels/print', { ids }),
  listPrintedLabels: () => req('/api/cmdb/labels/printed'),
  setLabelStatus: (id, status) => put(`/api/cmdb/labels/${id}/status`, { status }),
  deleteLabel: (id) => del(`/api/cmdb/labels/${id}`),
  getLabelRule: () => req('/api/cmdb/labels/rule'),
  saveLabelRule: (prefix) => put('/api/cmdb/labels/rule', { prefix }),

  // 配置中心（设备模型库）
  listModels: (p = {}) => req(`/api/cmdb/models?${toQuery(p)}`),
  createModel: (d) => post('/api/cmdb/models', d),
  updateModel: (id, d) => put(`/api/cmdb/models/${id}`, d),
  deleteModel: (id) => del(`/api/cmdb/models/${id}`),

  // 分类管理（组织 / 分组 / 设备分类 三个维度）
  listTaxonomy: (kind) => req(`/api/cmdb/taxonomy/${kind}`),
  createTaxonomy: (kind, d) => post(`/api/cmdb/taxonomy/${kind}`, d),
  updateTaxonomy: (kind, id, d) => put(`/api/cmdb/taxonomy/${kind}/${id}`, d),
  deleteTaxonomy: (kind, id) => del(`/api/cmdb/taxonomy/${kind}/${id}`),
}
