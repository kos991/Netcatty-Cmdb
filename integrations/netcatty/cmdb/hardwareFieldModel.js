export const HARDWARE_UNITS = ['MB', 'GB', 'TB', 'PB']
const UNIT_MB = { MB: 1n, GB: 1024n, TB: 1048576n, PB: 1073741824n }
const INT64_MAX = 9223372036854775807n
const DECIMAL = /^(?:\d+(?:\.\d+)?|\.\d+)$/
const text = value => String(value ?? '')

// Decimal arithmetic happens before Number conversion: fractional MB are never rounded.
export function memoryAmountToMB(amount, unit = 'MB') {
  const source = text(amount).trim()
  if (!DECIMAL.test(source) || !UNIT_MB[unit]) throw new Error('请输入非负内存容量')
  const [whole, fraction = ''] = source.split('.')
  const denominator = 10n ** BigInt(fraction.length)
  const numerator = BigInt((whole || '0') + fraction) * UNIT_MB[unit]
  if (numerator % denominator) throw new Error('内存换算后必须是整数 MB，不能取整')
  const integer = numerator / denominator
  if (integer > INT64_MAX) throw new Error('内存超过后端 int64 范围')
  const value = Number(integer)
  if (BigInt(JSON.stringify(value)) !== integer) throw new Error('该内存值无法通过现有 JSON 数字协议无损保存，请调整容量')
  return value
}

export function validateHardwareScalar(key, value) {
  if (key !== 'memory_mb' && key !== 'vcpu') return
  if (value === undefined || value === null || value === '') return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || BigInt(value) > INT64_MAX) throw new Error(key === 'vcpu' ? 'vCPU 必须为 int64 范围内的非负整数' : '内存必须为 int64 范围内的非负整数 MB')
}

export function parseHardwareField(key, value) {
  const source = text(value)
  const parts = key === 'memory_mb' ? { amount: '', unit: 'GB' }
    : key === 'vcpu' ? { count: source }
      : key === 'cpu_info' ? { count: '', model: '', note: '' }
        : { count: '', capacity: '', unit: 'GB', medium: '', note: '' }
  if (!source) return { recognized: true, parts }
  if (key === 'vcpu') return { recognized: /^\d+$/.test(source), parts }
  if (key === 'memory_mb') {
    try {
      validateHardwareScalar(key, value)
      if (memoryAmountToMB(source) !== value) return { recognized: false, parts }
      const unit = ['PB', 'TB', 'GB'].find(item => value >= Number(UNIT_MB[item]) && BigInt(value) % UNIT_MB[item] === 0n) || 'MB'
      return { recognized: true, parts: { amount: String(value / Number(UNIT_MB[unit])), unit } }
    } catch { return { recognized: false, parts } }
  }
  if (key === 'cpu_info') {
    const match = source.match(/^(?:(\d+)\s*[×x*]\s*)?([^/\n]+?)(?:\s*\/\s*([\s\S]*))?$/)
    if (!match || (!match[1] && !/^(?:Intel|AMD|Apple|ARM|海光|鲲鹏|龙芯)(?:\b|\s)/i.test(match[2]))) return { recognized: false, parts }
    return { recognized: true, parts: { count: match[1] || '', model: match[2].trim(), note: match[3] || '' } }
  }
  const match = source.match(/^(?:(\d+)\s*[×x*]\s*)?(\d+(?:\.\d+)?|\.\d+)\s*(MB|GB|TB|PB)\b\s*([^/\n]*?)(?:\s*\/\s*([\s\S]*))?$/i)
  if (!match) return { recognized: false, parts }
  return { recognized: true, parts: { count: match[1] || '', capacity: match[2], unit: match[3].toUpperCase(), medium: match[4].trim(), note: match[5] || '' } }
}

export function composeHardwareField(key, parts) {
  if (key === 'vcpu') {
    if (!parts.count) return 0
    if (!/^\d+$/.test(parts.count)) throw new Error('vCPU 必须为非负整数，不限预设核数')
    return memoryAmountToMB(parts.count)
  }
  if (key === 'memory_mb') return parts.amount === '' ? 0 : memoryAmountToMB(parts.amount, parts.unit)
  if (Object.entries(parts).every(([key, value]) => key === 'unit' || !value)) return ''
  if (parts.count && (!/^\d+$/.test(parts.count) || BigInt(parts.count) < 1n)) throw new Error('数量必须为正整数，可留空')
  const count = parts.count ? `${parts.count} × ` : ''
  const note = parts.note ? ` / ${parts.note}` : ''
  if (key === 'cpu_info') {
    if (!parts.model.trim()) throw new Error('请补全 CPU 型号；分项草稿已保留，原文未改动')
    return `${count}${parts.model}${note}`
  }
  if (!DECIMAL.test(parts.capacity) || !/[1-9]/.test(parts.capacity)) throw new Error('请填写有效的单盘容量；分项草稿已保留，原文未改动')
  return `${count}${parts.capacity} ${parts.unit}${parts.medium ? ` ${parts.medium}` : ''}${note}`
}

export function createHardwareDraft(key, source) {
  return { source, ...parseHardwareField(key, source), edited: false, error: '', previous: null }
}

export function reconcileHardwareDraft(key, draft, source) {
  if (!draft) return createHardwareDraft(key, source)
  if (Object.is(draft.source, source)) return draft
  return { ...createHardwareDraft(key, source), previous: draft.edited || draft.rawError || text(draft.source) ? { parts: { ...draft.parts }, source: draft.source, rawText: draft.rawText } : draft.previous }
}

export function editHardwareDraft(key, draft, part, value, explicit = false) {
  const next = { ...draft, parts: { ...draft.parts, ...(part ? { [part]: value } : {}) }, edited: true, error: '', rawError: '', rawText: undefined }
  if (!next.recognized && !explicit) return next
  try {
    next.source = composeHardwareField(key, next.parts)
    next.recognized = true
  } catch (error) { next.error = error.message }
  return next
}

export function validateHardwareDraft(key, draft, source) {
  validateHardwareScalar(key, source)
  const current = reconcileHardwareDraft(key, draft, source)
  if (current.rawError) throw new Error(current.rawError)
  if (current.recognized && current.error) throw new Error(current.error)
}
