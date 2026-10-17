export function subnetSelectorItems(subnets = [], summaries = []) {
  const usageByName = new Map((Array.isArray(summaries) ? summaries : []).map((item) => [item.subnet || item.name, item]))
  return (Array.isArray(subnets) ? subnets : []).map((item) => {
    const name = item.name || item.subnet || '未命名网段'
    const usage = usageByName.get(name) || item
    const details = [
      item.cidr || item.prefix,
      item.vlan ? `VLAN ${item.vlan}` : '',
      item.vni ? `VNI ${item.vni}` : '',
      `使用率 ${Number(usage.usage_rate) || 0}%`,
    ].filter(Boolean)
    return { id: item.id, value: name, label: name, category: String(item.category || '').trim() || '未分类', description: details.join(' · ') }
  })
}

export function subnetSelectorGroups(subnets = [], summaries = [], keyword = '') {
  const search = keyword.trim().toLowerCase()
  const groups = new Map()
  for (const item of subnetSelectorItems(subnets, summaries)) {
    if (search && !`${item.label} ${item.description} ${item.category}`.toLowerCase().includes(search)) continue
    if (!groups.has(item.category)) groups.set(item.category, [])
    groups.get(item.category).push(item)
  }
  return [...groups].map(([category, items]) => ({ category, items }))
}

export function initialSubnetDraft(subnets = [], { initialCreate = false, initialSubnetID } = {}) {
  if (initialCreate) return { name: '', category: '', prefix: '', cidr: '', gateway: '', vlan: '', vni: '', purpose: '', sort_order: 0, remark: '' }
  const selected = initialSubnetID == null ? subnets[0] : subnets.find((item) => String(item.id) === String(initialSubnetID))
  return selected ? { ...selected } : null
}
