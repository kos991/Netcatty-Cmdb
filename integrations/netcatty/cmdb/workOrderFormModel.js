const text = (value) => String(value ?? '').trim()

export function includeCurrentWorkOrderValue(options = [], currentValue) {
  const values = Array.isArray(options) ? [...options] : []
  const current = text(currentValue)
  if (current && !values.some((value) => text(value) === current)) values.push(current)
  return values
}

export function chooseWorkOrderDefault(options = [], preferredValue = '') {
  const values = Array.isArray(options) ? options.map(text).filter(Boolean) : []
  const preferred = text(preferredValue)
  return values.includes(preferred) ? preferred : values[0] || preferred
}

export function resolveWorkOrderEditValues(record = {}, projects = []) {
  const projectId = Number(record.project_id) || 0
  const project = (Array.isArray(projects) ? projects : []).find((item) => Number(item?.id) === projectId)
  const projectName = text(record.project_name) || text(project?.name) || (projectId ? `项目 #${projectId}` : '当前项目')

  return {
    ...record,
    priority: text(record.priority) || 'P3（普通）',
    status: text(record.status) || '新建',
    project_name: projectName,
    plan_time: String(record.plan_time || '').replace(' ', 'T'),
    actual_time: String(record.actual_time || '').replace(' ', 'T'),
  }
}
