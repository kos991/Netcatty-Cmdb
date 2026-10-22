export const DEFAULT_RACK_UNITS = 42
export const UNKNOWN_ROOM = '未登记机房'
export const UNASSIGNED_CABINET = '未分配机柜'

const clean = (value) => String(value || '').trim()

// 资产只读迁移后的独立字段；旧 cabinet_pos 不再充当机柜身份。
export function rackKey(asset = {}) {
  return JSON.stringify([clean(asset.data_center), clean(asset.cabinet_name)])
}

export function rackLocationName(room, cabinet) {
  return clean(room) ? `${clean(room)} (${clean(cabinet)})` : clean(cabinet)
}

// 新目录使用显式身份；仅历史目录 qualified name 保留解析，不重解析资产字段。
export function rackLocationIdentity(location = {}) {
  if (location.location_type === 'room') return { data_center: clean(location.data_center || location.name), cabinet_name: '' }
  if (location.location_type === 'cabinet') return { data_center: clean(location.data_center), cabinet_name: clean(location.cabinet_name) }
  const name = clean(location.name)
  const qualified = name.match(/^(.+) \(([^()]+)\)$/)
  return qualified ? { data_center: clean(qualified[1]), cabinet_name: clean(qualified[2]) } : { data_center: '', cabinet_name: name }
}

export function buildRackLayout(assets = [], totalUnits = DEFAULT_RACK_UNITS) {
  const occupied = new Map()
  const placed = []
  const unplaced = []
  const conflicts = []
  const ordered = [...assets].sort((left, right) => (Number(left.start_u) || 0) - (Number(right.start_u) || 0) || Number(left.id) - Number(right.id))
  for (const asset of ordered) {
    const start = Number(asset.start_u) || 0
    const height = Number(asset.height_u) || 1
    if (start === 0) {
      unplaced.push(asset)
      continue
    }
    const top = start + height - 1
    if (!Number.isInteger(start) || start < 1 || !Number.isInteger(height) || height < 1 || top > totalUnits) {
      conflicts.push(asset)
      continue
    }
    const units = Array.from({ length: height }, (_, index) => start + index)
    if (units.some((unit) => occupied.has(unit))) {
      conflicts.push(asset)
      continue
    }
    units.forEach((unit) => occupied.set(unit, asset.id))
    placed.push({ asset, start, height, top })
  }
  const tops = new Map(placed.map((item) => [item.top, item]))
  const rows = []
  for (let unit = totalUnits; unit >= 1;) {
    const item = tops.get(unit)
    if (item) {
      rows.push({ type: 'device', unit, ...item })
      unit -= item.height
    } else {
      rows.push({ type: 'empty', unit, height: 1 })
      unit -= 1
    }
  }
  return { totalUnits, rows, placed, unplaced, conflicts, usedUnits: occupied.size }
}

export function rackPlacementError(assets = [], assetID, start, height, totalUnits = DEFAULT_RACK_UNITS) {
  const units = Number(totalUnits)
  if (!Number.isInteger(units) || units < 1 || units > 60) return '机柜 U 数需在 1-60 之间'
  if (!Number.isInteger(height) || height < 1 || height > 60) return '占用 U 数需在 1-60 之间'
  if (!Number.isInteger(start) || start < 0) return '起始 U 位无效'
  if (start === 0) return ''
  const top = start + height - 1
  if (top > units) return `设备占用到 ${top}U，超出机柜 ${units}U`
  const clash = assets.find((item) => {
    if (Number(item.id) === Number(assetID)) return false
    const otherStart = Number(item.start_u) || 0
    if (otherStart < 1) return false
    const otherTop = otherStart + Math.max(1, Number(item.height_u) || 1) - 1
    return start <= otherTop && otherStart <= top
  })
  return clash ? `与 ${clash.name || clash.asset_code || `资产 #${clash.id}`} 的 U 位重叠` : ''
}

export function rackUnitsError(assets = [], totalUnits) {
  const units = Number(totalUnits)
  if (!Number.isInteger(units) || units < 1 || units > 60) return '机柜 U 数需在 1-60 之间'
  const highest = Math.max(0, ...assets.map((item) => (Number(item.start_u) || 0) > 0 ? Number(item.start_u) + Math.max(1, Number(item.height_u) || 1) - 1 : 0))
  return highest > units ? `已有设备占用到 ${highest}U，机柜不能小于 ${highest}U` : ''
}

export function rackCabinets(assets = [], locations = []) {
  const cabinets = new Map()
  const ensure = (identity) => {
    const key = rackKey(identity)
    if (!cabinets.has(key)) {
      const room = clean(identity.data_center)
      const name = clean(identity.cabinet_name)
      cabinets.set(key, { key, room, name, roomLabel: room || UNKNOWN_ROOM, unassigned: !name, locationName: name ? rackLocationName(room, name) : '', devices: [], location: null })
    }
    return cabinets.get(key)
  }
  for (const asset of assets) ensure(asset).devices.push(asset)
  const registeredNames = new Map([...cabinets.values()].filter((item) => !item.unassigned).map((item) => [item.locationName, item]))
  for (const location of locations) {
    const name = clean(location.name)
    if (location.location_type === 'room') {
      ensure(rackLocationIdentity(location)).roomLocation = location
      continue
    }
    if (!name || !(Number(location.rack_units) > 0)) continue
    const cabinet = location.location_type === 'cabinet'
      ? ensure(rackLocationIdentity(location))
      : registeredNames.get(name) || ensure(rackLocationIdentity(location))
    cabinet.location = location
  }
  return [...cabinets.values()].map((item) => {
    const totalUnits = Number(item.location?.rack_units) || DEFAULT_RACK_UNITS
    const layout = buildRackLayout(item.devices, totalUnits)
    return { ...item, totalUnits, deviceCount: item.devices.length, placedCount: item.unassigned ? 0 : layout.placed.length, usedUnits: item.unassigned ? 0 : layout.usedUnits, unplacedCount: item.unassigned ? item.devices.length : layout.unplaced.length, conflictCount: item.unassigned ? 0 : layout.conflicts.length,
      searchText: [item.roomLabel, item.name || UNASSIGNED_CABINET, ...item.devices.flatMap((device) => [device.name, device.asset_code, device.mgmt_ip || device.manage_ip, device.biz_ip])].filter(Boolean).join(' ').toLowerCase(),
    }
  }).sort((left, right) => left.roomLabel.localeCompare(right.roomLabel, 'zh-CN', { numeric: true }) || Number(left.unassigned) - Number(right.unassigned) || left.name.localeCompare(right.name, 'zh-CN', { numeric: true }))
}

export function rackRooms(cabinets = [], keyword = '') {
  const needle = keyword.trim().toLowerCase()
  const rooms = new Map()
  for (const cabinet of cabinets) {
    if (needle && !cabinet.searchText.includes(needle)) continue
    if (!rooms.has(cabinet.room)) rooms.set(cabinet.room, { key: cabinet.room, name: cabinet.roomLabel, cabinets: [] })
    rooms.get(cabinet.room).cabinets.push(cabinet)
  }
  return [...rooms.values()]
}

export function defaultRack(cabinets = []) {
  return [...cabinets].sort((left, right) => Number(left.unassigned) - Number(right.unassigned) || right.placedCount - left.placedCount || right.deviceCount - left.deviceCount)[0] || null
}

export function rackAssignmentChanges(room, cabinet) {
  return { data_center: clean(room), cabinet_name: clean(cabinet), cabinet_pos: '', start_u: 0 }
}

const DEVICE_FIELDS = ['name', 'asset_code', 'device_type', 'vendor', 'model', 'data_center', 'cabinet_name', 'mgmt_ip', 'status']

export function rackDeviceValues(asset = {}) {
  return {
    ...Object.fromEntries(DEVICE_FIELDS.map((key) => [key, String(asset[key] || '')])),
    category_id: Number(asset.category_id) || 0,
    start_u: Number(asset.start_u) || 0,
    height_u: Number(asset.height_u) || 1,
  }
}

// 仅提交编辑过的字段，保留设备工作区维护的其他历史资料。
export function rackDeviceChanges(asset, values) {
  const before = rackDeviceValues(asset)
  const after = rackDeviceValues(values)
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => value !== before[key]))
}
