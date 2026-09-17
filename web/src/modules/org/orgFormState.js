function positiveID(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : 0
}

export function toOrgPath(person = {}) {
  const path = [positiveID(person.org_id), positiveID(person.department_id), positiveID(person.group_id)]
  return path.filter(Boolean)
}

export function fromOrgPath(path = []) {
  return {
    org_id: positiveID(path[0]),
    department_id: positiveID(path[1]),
    group_id: positiveID(path[2]),
  }
}

export function orgTreeToCascader(nodes = []) {
  return nodes.map((node) => {
    const option = { value: node.id, label: node.name }
    const children = orgTreeToCascader(node.children || [])
    if (children.length > 0) option.children = children
    return option
  })
}

function countPeople(persons, predicate) {
  return persons.reduce((count, person) => count + (predicate(person) ? 1 : 0), 0)
}

export function buildOrgNavigationTree(orgTree = [], persons = []) {
  const mapNode = (node, path) => {
    const nextPath = [...path, node]
    const ids = nextPath.map((item) => item.id)
    const count = countPeople(persons, (person) => ids.every((id, index) => {
      const field = ['org_id', 'department_id', 'group_id'][index]
      return positiveID(person[field]) === id
    }))
    const selection = {
      org_name: nextPath[0]?.name || '',
      ...(nextPath[1] ? { department: nextPath[1].name } : {}),
      ...(nextPath[2] ? { group_name: nextPath[2].name } : {}),
    }
    return {
      key: JSON.stringify(selection),
      title: `${node.name} (${count})`,
      nodeType: node.node_type,
      children: (node.children || []).map((child) => mapNode(child, nextPath)),
    }
  }

  return [
    { key: 'all', title: `全部人员 (${persons.length})`, children: [] },
    ...orgTree.map((node) => mapNode(node, [])),
  ]
}
