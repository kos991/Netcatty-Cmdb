export function summarizeWorkOrders(rows = [], now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return {
    total: list.length,
    pending: list.filter((item) => ['新建', '已分配'].includes(item?.status)).length,
    processing: list.filter((item) => item?.status === '处理中').length,
    completedThisMonth: list.filter((item) => {
      const actualTime = String(item?.actual_time || '')
      if (!['已解决', '已关闭'].includes(item?.status) || !/^\d{4}-\d{2}-\d{2}(?:[ T]|$)/.test(actualTime)) return false
      const [year, monthNumber, day] = actualTime.slice(0, 10).split('-').map(Number)
      const date = new Date(year, monthNumber - 1, day)
      return date.getFullYear() === year && date.getMonth() === monthNumber - 1 && date.getDate() === day && actualTime.startsWith(month)
    }).length,
  }
}
