export function subnetSelectorItems(subnets = []) {
  return (Array.isArray(subnets) ? subnets : []).map((item) => {
    const name = item.name || item.subnet || '未命名网段'
    const details = [
      item.cidr || item.prefix,
      item.vlan ? `VLAN ${item.vlan}` : '',
      item.vni ? `VNI ${item.vni}` : '',
      `使用率 ${Number(item.usage_rate) || 0}%`,
    ].filter(Boolean)
    return { value: item.subnet || name, label: name, description: details.join(' · ') }
  })
}
