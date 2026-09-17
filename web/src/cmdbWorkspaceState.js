export const MODULES = [
  { key: 'search', label: '全局查询', icon: 'Search' },
  { key: 'assets', label: '终端资产', icon: 'Monitor' },
  { key: 'infrastructure', label: '基础设施', icon: 'Server' },
  { key: 'systems', label: '业务系统', icon: 'AppWindow' },
  { key: 'people', label: '组织与人员', icon: 'Users' },
  { key: 'ip', label: 'IP 规划池', icon: 'Network' },
  { key: 'operations', label: '统计与履历', icon: 'ChartNoAxesCombined' },
  { key: 'config', label: '配置中心', icon: 'Settings2' },
]

const SEARCH_TARGETS = {
  assets: { module: 'assets' },
  cmdb_assets: { module: 'infrastructure' },
  server_apps: { module: 'systems' },
  persons: { module: 'people' },
  asset_logs: { module: 'operations' },
  ip_pool: { module: 'ip' },
}

export function resolveSearchTarget(result) {
  const target = SEARCH_TARGETS[result?.tableKey]
  return target ? { ...target, focusTarget: result } : null
}

export function panelKeyFor(module) {
  return module
}

export function resolveIPFocus(target, consumedTarget, subnets, entries, entryLoad) {
  if (!target || target === consumedTarget || !subnets) return null
  const subnet = target.data?.网段 || target.data?.subnet || target.subtitle
  if (!subnets.some((item) => item.subnet === subnet)) return { subnet: null, entry: null, consumed: true }
  if (entryLoad?.subnet !== subnet || !['ready', 'error'].includes(entryLoad.status)) return { subnet, entry: null, consumed: false }
  if (entryLoad.status === 'error') return { subnet, entry: null, consumed: true }
  const ip = target.title || target.data?.IP || target.data?.ip
  const entry = entries.find((item) => item.subnet === subnet && ((target.id && item.id === target.id) || (ip && item.ip === ip))) || null
  return { subnet, entry, consumed: true }
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
