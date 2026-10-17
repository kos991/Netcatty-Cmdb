function normalizePortName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^gigabitethernet(?=\d)/, 'ge')
    .replace(/^gi(?=\d)/, 'ge')
    .replace(/\s+/g, '')
}

function portNumber(value) {
  return String(value || '').match(/(\d+)\s*$/)?.[1] || String(value || '-')
}

function naturalPortCompare(left, right) {
  return String(left.name).localeCompare(String(right.name), undefined, { numeric: true, sensitivity: 'base' })
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean)
  return []
}

function portState(item) {
  const status = String(item.status || '').toLowerCase()
  if (/error|err-disable|fault|alarm|异常|故障/.test(status)) return 'abnormal'
  if (item.enabled === false) return 'disabled'
  if (/down|inactive|notconnect/.test(status)) return 'down'
  if (item.enabled === true || /^(up|connected)$/.test(status)) return 'enabled'
  return 'unknown'
}

function linkRole(link) {
  if (!link) return ''
  return [link.direction === 'uplink' ? '上联' : link.direction === 'downlink' ? '下联' : '', link.peer_asset_name, link.peer_port]
    .filter(Boolean)
    .join(' ')
}

export function buildSwitchPortPanel(interfaces = [], links = []) {
  const linksByPort = new Map((links || []).map((item) => [normalizePortName(item.local_port), item]))
  const ports = (interfaces || []).map((item) => {
    const link = linksByPort.get(normalizePortName(item.name))
    const role = linkRole(link) || item.description || ''
    return {
      ...item,
      allowedVlans: normalizeStringList(item.allowedVlans),
      number: portNumber(item.name),
      state: portState(item),
      registered: Boolean(link),
      role,
      link: link || null,
    }
  }).sort(naturalPortCompare)
  const duplicateNumbers = new Set(ports.filter(port => ports.filter(other => other.number === port.number).length > 1).map(port => port.number))
  for (const port of ports) if (duplicateNumbers.has(port.number)) port.number = port.name.replace(/^[^\d]+/, '')
  const counts = { enabled: 0, disabled: 0, abnormal: 0, unknown: 0, down: 0, registered: 0, total: ports.length }
  for (const port of ports) {
    counts[port.state] += 1
    if (port.registered) counts.registered += 1
  }
  return { ports, counts }
}
