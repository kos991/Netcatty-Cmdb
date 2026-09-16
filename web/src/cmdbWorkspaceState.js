export const MODULES = [
  { key: 'search', label: '全局查询' },
  { key: 'assets', label: '终端资产' },
  { key: 'infrastructure', label: '基础设施资源' },
  { key: 'systems', label: '业务系统' },
  { key: 'base', label: '基础管理' },
  { key: 'operations', label: '运维分析' },
]

export const SUBMODULES = {
  base: [{ key: 'people', label: '组织与人员' }, { key: 'ip', label: 'IP 规划池' }],
  operations: [{ key: 'dashboard', label: '统计概览' }, { key: 'audit', label: '运维履历' }],
}

const SEARCH_TARGETS = {
  assets: { module: 'assets' },
  cmdb_assets: { module: 'infrastructure' },
  server_apps: { module: 'systems' },
  persons: { module: 'base', submodule: 'people' },
  asset_logs: { module: 'operations', submodule: 'audit' },
  ip_pool: { module: 'base', submodule: 'ip' },
}

export function resolveSearchTarget(result) {
  const target = SEARCH_TARGETS[result?.tableKey]
  return target ? { ...target, focusTarget: result } : null
}

export function panelKeyFor(module, baseTab, operationsTab) {
  return module === 'base' ? `base:${baseTab}` : module === 'operations' ? `operations:${operationsTab}` : module
}
