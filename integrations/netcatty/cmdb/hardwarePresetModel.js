// CPU / 内存 / 磁盘常用预设：只保存分项组合，应用时仍走 editHardwareDraft，未识别原文不会被静默覆盖。
export const HARDWARE_PRESET_STORAGE_KEY = 'netcatty.cmdb.hardwarePresets.v1'
export const HARDWARE_PRESET_LIMIT = 16
export const HARDWARE_PRESET_KEYS = ['cpu_info', 'memory_mb', 'disk_info']

const PRESET_PARTS = { cpu_info: ['count', 'model'], memory_mb: ['amount', 'unit'], disk_info: ['count', 'capacity', 'unit', 'medium'] }

export const DEFAULT_HARDWARE_PRESETS = {
  cpu_info: [
    { count: '1', model: 'Intel Core i5-12500' },
    { count: '1', model: 'Intel Core i7-13700' },
    { count: '2', model: 'Intel Xeon Gold 6330' },
    { count: '2', model: 'Intel Xeon Silver 4310' },
    { count: '2', model: 'AMD EPYC 7313' },
  ],
  memory_mb: [
    { amount: '8', unit: 'GB' },
    { amount: '16', unit: 'GB' },
    { amount: '32', unit: 'GB' },
    { amount: '64', unit: 'GB' },
    { amount: '128', unit: 'GB' },
  ],
  disk_info: [
    { count: '', capacity: '512', unit: 'GB', medium: 'SSD' },
    { count: '', capacity: '1', unit: 'TB', medium: 'SSD' },
    { count: '2', capacity: '960', unit: 'GB', medium: 'SATA SSD' },
    { count: '4', capacity: '4', unit: 'TB', medium: 'SAS' },
  ],
}

const clean = value => String(value ?? '').trim()

// 只取预设相关分项；说明/RAID 等补充内容不进入预设，应用时保留当前草稿中的说明。
export function hardwarePresetParts(key, parts = {}) {
  return Object.fromEntries((PRESET_PARTS[key] || []).map(part => [part, clean(parts[part])]))
}

export function hardwarePresetLabel(key, preset = {}) {
  const parts = hardwarePresetParts(key, preset)
  if (key === 'memory_mb') return `${parts.amount} ${parts.unit}`.trim()
  const count = parts.count ? `${parts.count} × ` : ''
  if (key === 'cpu_info') return `${count}${parts.model}`
  return `${count}${parts.capacity} ${parts.unit}${parts.medium ? ` ${parts.medium}` : ''}`
}

export function isUsableHardwarePreset(key, preset = {}) {
  const parts = hardwarePresetParts(key, preset)
  if (key === 'cpu_info') return !!parts.model && (!parts.count || /^[1-9]\d*$/.test(parts.count))
  if (key === 'memory_mb') return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(parts.amount) && /[1-9]/.test(parts.amount) && !!parts.unit
  if (key === 'disk_info') return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(parts.capacity) && /[1-9]/.test(parts.capacity) && !!parts.unit && (!parts.count || /^[1-9]\d*$/.test(parts.count))
  return false
}

function normalizeList(key, list) {
  const seen = new Set()
  const result = []
  for (const item of Array.isArray(list) ? list : []) {
    if (!isUsableHardwarePreset(key, item)) continue
    const parts = hardwarePresetParts(key, item)
    const label = hardwarePresetLabel(key, parts)
    if (seen.has(label)) continue
    seen.add(label)
    result.push(parts)
    if (result.length >= HARDWARE_PRESET_LIMIT) break
  }
  return result
}

// 未保存过的字段使用内置默认；用户删空后保存为空数组，不再自动恢复默认。
export function readHardwarePresets(storage, key) {
  let stored = null
  try { stored = JSON.parse(storage?.getItem(HARDWARE_PRESET_STORAGE_KEY) || 'null') }
  catch (error) { console.warn('读取硬件常用预设失败', error) }
  const list = stored && Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : DEFAULT_HARDWARE_PRESETS[key]
  return normalizeList(key, list)
}

export function saveHardwarePresets(storage, key, list) {
  let stored = {}
  try { stored = JSON.parse(storage?.getItem(HARDWARE_PRESET_STORAGE_KEY) || '{}') || {} }
  catch (error) { console.warn('读取硬件常用预设失败，将重新保存', error) }
  const next = normalizeList(key, list)
  storage?.setItem(HARDWARE_PRESET_STORAGE_KEY, JSON.stringify({ ...stored, [key]: next }))
  return next
}

export function addHardwarePreset(key, list, parts) {
  if (!isUsableHardwarePreset(key, parts)) throw new Error('当前分项不完整，无法存为常用预设')
  const preset = hardwarePresetParts(key, parts)
  const label = hardwarePresetLabel(key, preset)
  return normalizeList(key, [preset, ...list.filter(item => hardwarePresetLabel(key, item) !== label)])
}

export function removeHardwarePreset(key, list, label) {
  return list.filter(item => hardwarePresetLabel(key, item) !== label)
}
