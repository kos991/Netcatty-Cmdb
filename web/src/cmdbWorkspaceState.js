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

export function resolveIPFocus(target, consumedTarget, subnets, entries) {
  if (!target || target === consumedTarget) return null
  const subnet = target.data?.网段 || target.data?.subnet || target.subtitle
  if (!subnets.some((item) => item.subnet === subnet)) return null
  const ip = target.title || target.data?.IP || target.data?.ip
  const entry = entries.find((item) => item.subnet === subnet && ((target.id && item.id === target.id) || (ip && item.ip === ip))) || null
  return { subnet, entry }
}

export function buildPersonTree(persons) {
  const organizations = new Map()
  for (const person of persons) {
    const org = person.org_name
    if (!org) continue
    if (!organizations.has(org)) organizations.set(org, { count: 0, departments: new Map() })
    const node = organizations.get(org)
    node.count++
    if (person.department) node.departments.set(person.department, (node.departments.get(person.department) || 0) + 1)
  }
  return [
    { key: 'all', title: `全部人员 (${persons.length})` },
    ...Array.from(organizations, ([org, node]) => ({
      key: JSON.stringify({ org_name: org }), title: `${org} (${node.count})`,
      children: Array.from(node.departments, ([department, count]) => ({
        key: JSON.stringify({ org_name: org, department }), title: `${department} (${count})`,
      })),
    })),
  ]
}
