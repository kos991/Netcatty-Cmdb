export function subnetSelectorItems(subnets = [], summaries = []) {
  const usageByName = new Map((Array.isArray(summaries) ? summaries : []).map((item) => [item.subnet || item.name, item]))
  return (Array.isArray(subnets) ? subnets : []).map((item) => {
    const name = item.name || item.subnet || '未命名网段'
    const usage = usageByName.get(name) || item
    const segments = Array.isArray(item.segments) ? item.segments : []
    const details = [
      item.cidr || item.prefix,
      item.vlan ? `VLAN ${item.vlan}` : '',
      item.vni ? `VNI ${item.vni}` : '',
      segments.length ? `${segments.length} 个分段` : '',
      `使用率 ${Number(usage.usage_rate) || 0}%`,
    ].filter(Boolean)
    const segmentNames = segments.map((segment) => segment.name).filter(Boolean).slice(0, 4).join('、')
    return { id: item.id, value: name, label: name, category: String(item.category || '').trim() || '未分类', description: details.join(' · '), ...(segments.length ? { segmentNames: `${segmentNames}${segments.length > 4 ? ' 等' : ''}`, segmentCount: segments.length, segments: segments.map(({ name, floor, start_ip, end_ip, count }) => ({ name, floor, start_ip, end_ip, count })) } : {}) }
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
  if (initialCreate) return { name: '', category: '', prefix: '', cidr: '', gateway: '', vlan: '', vni: '', purpose: '', sort_order: 0, remark: '', segments: [] }
  const selected = initialSubnetID == null ? subnets[0] : subnets.find((item) => String(item.id) === String(initialSubnetID))
  return selected ? { ...selected } : null
}

export function ipv4Number(value) {
  const parts = String(value || '').trim().split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255 || (part.length > 1 && part.startsWith('0')))) return null
  return parts.reduce((total, part) => total * 256 + Number(part), 0)
}

export function segmentAddressCount(row) {
  const start = ipv4Number(row?.start_ip); const end = ipv4Number(row?.end_ip)
  return start == null || end == null || start > end ? 0 : end - start + 1
}

// 从备注里的「部门 楼层 数量 起始IP-结束IP」行生成分段，结束地址可只写末段。
// 例如：速载 3楼 31 138.64.7.2－40；刑一 4楼 12 138.64.7.41－60。
export function parseSegmentsFromRemark(remark = '') {
  const rows = []
  for (const raw of String(remark || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = line.match(/^(\S+)\s+(\S*?)\s*(\d+)?\s*(\d{1,3}(?:\.\d{1,3}){3})\s*[-－—~至]\s*(\d{1,3}(?:\.\d{1,3}){3}|\d{1,3})\s*$/)
    if (!match) continue
    const [, name, floor, count, start, endRaw] = match
    const end = endRaw.includes('.') ? endRaw : `${start.split('.').slice(0, 3).join('.')}.${endRaw}`
    const row = { name, floor, start_ip: start, end_ip: end, count: Number(count) || 0, remark: '' }
    if (!segmentAddressCount(row)) continue
    rows.push(row)
  }
  return rows
}
