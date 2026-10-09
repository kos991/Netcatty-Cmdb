export const ORG_TYPES = { organization: '组织', department: '部门', group: '分组' }

const PARENT_TYPES = { department: 'organization', group: 'department' }
const PERSON_FIELDS = { organization: 'org_id', department: 'department_id', group: 'group_id' }

export function organizationPersonEditorPath(record = {}, tree = []) {
  const orgID = Number(record.org_id) || 0
  const org = tree.find((node) => Number(node.id) === orgID)
  if (!org) return { org_id: 0, department_id: 0, group_id: 0 }

  const departmentID = Number(record.department_id) || 0
  const department = (org.children || []).find((node) => Number(node.id) === departmentID)
  if (!department) return { org_id: Number(org.id), department_id: 0, group_id: 0 }

  const groupID = Number(record.group_id) || 0
  const group = (department.children || []).find((node) => Number(node.id) === groupID)
  return {
    org_id: Number(org.id),
    department_id: Number(department.id),
    group_id: group ? Number(group.id) : 0,
  }
}

export function organizationParentOptions(rows, nodeType) {
  if (nodeType === 'organization') return [{ value: 0, label: '顶级组织' }]
  const parentType = PARENT_TYPES[nodeType]
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  return [
    { value: 0, label: `请选择上级${ORG_TYPES[parentType]}` },
    ...rows.filter((row) => row.node_type === parentType).map((row) => ({
      value: row.id,
      label: parentType === 'department' && byId.has(Number(row.parent_id)) ? `${byId.get(Number(row.parent_id)).name} / ${row.name}` : row.name,
    })),
  ]
}

export function organizationEditorPayload(draft, rows) {
  const name = String(draft.name || '').trim()
  if (!name) throw new Error('组织节点名称不能为空')
  const node_type = draft.node_type
  if (!Object.hasOwn(ORG_TYPES, node_type)) throw new Error('请选择有效的节点类型')
  const parent_id = node_type === 'organization' ? 0 : Number(draft.parent_id || 0)
  if (node_type !== 'organization' && !rows.some((row) => Number(row.id) === parent_id && row.node_type === PARENT_TYPES[node_type])) throw new Error(`请选择有效的上级${ORG_TYPES[PARENT_TYPES[node_type]]}`)
  const sort_order = Number(draft.sort_order || 0)
  if (!Number.isInteger(sort_order) || sort_order < 0) throw new Error('排序必须是非负整数')
  return { name, node_type, parent_id, sort_order }
}

export function organizationPersonCount(node, people) {
  if (!node?.id) return 0
  const field = PERSON_FIELDS[node.node_type]
  return people.filter((person) => Number(person[field]) === Number(node.id)).length
}

export function organizationSelectionForNode(tree, nodeId, path = []) {
  for (const node of tree) {
    const branch = [...path, node]
    if (Number(node.id) === Number(nodeId)) return {
      org_name: branch[0].name,
      ...(branch[1] ? { department: branch[1].name } : {}),
      ...(branch[2] ? { group_name: branch[2].name } : {}),
    }
    const result = organizationSelectionForNode(node.children || [], nodeId, branch)
    if (result.org_name) return result
  }
  return {}
}
