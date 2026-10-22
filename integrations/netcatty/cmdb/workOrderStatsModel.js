const MONTH_TIME_PREFIX = /^\d{4}-\d{2}-\d{2}(?:[ T]|$)/

function isValidMonthTimestamp(value, month) {
  const actualTime = String(value || '')
  if (!MONTH_TIME_PREFIX.test(actualTime) || !actualTime.startsWith(month)) return false
  const [year, monthNumber, day] = actualTime.slice(0, 10).split('-').map(Number)
  const date = new Date(year, monthNumber - 1, day)
  return date.getFullYear() === year && date.getMonth() === monthNumber - 1 && date.getDate() === day
}

export function getNextWorkOrderStatus(status) {
  if (status === '新建' || status === '已分配') return '处理中'
  if (status === '处理中') return '已解决'
  if (status === '已解决') return '已关闭'
  return ''
}

export function getEditableWorkOrderStatuses(status) {
  const choices = [status, getNextWorkOrderStatus(status)]
  if (!['已关闭', '已取消'].includes(status)) choices.push('已取消')
  return [...new Set(choices.filter(Boolean))]
}

export function canBulkCloseWorkOrders(rows = [], ids = []) {
  if (!Array.isArray(rows) || !Array.isArray(ids) || ids.length === 0) return false
  const byId = new Map(rows.filter(Boolean).map((row) => [row.id, row]))
  return ids.every((id) => byId.get(id)?.status === '已解决')
}

export function buildWorkOrderClosures(rows = [], results = {}) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: Number(row?.id) || 0,
    result: String(results?.[row?.id] || '').trim(),
  })).filter((item) => item.id > 0)
}

export function missingWorkOrderClosureResults(rows = [], results = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !String(results?.[row?.id] || '').trim())
    .map((row) => row?.order_no || row?.subject || `#${row?.id || '?'}`)
}

export function summarizeWorkOrders(rows = [], now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return {
    total: list.length,
    new: list.filter((item) => ['新建', '已分配'].includes(item?.status)).length,
    processing: list.filter((item) => item?.status === '处理中').length,
    resolved: list.filter((item) => item?.status === '已解决').length,
    closed: list.filter((item) => item?.status === '已关闭').length,
    cancelled: list.filter((item) => item?.status === '已取消').length,
    completedThisMonth: list.filter((item) => ['已解决', '已关闭'].includes(item?.status) && isValidMonthTimestamp(item?.actual_time, month)).length,
  }
}
