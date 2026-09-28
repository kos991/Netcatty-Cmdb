const byOrder = (left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0) || Number(left.id || 0) - Number(right.id || 0)

export function buildTaxonomyTree(rows = []) {
  const ordered = [...rows].sort(byOrder)
  const byId = new Map(ordered.map((row) => [Number(row.id), { ...row, children: [] }]))
  const roots = []
  ordered.forEach((row) => {
    const node = byId.get(Number(row.id))
    const parent = byId.get(Number(row.parent_id))
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  })
  return roots
}

export function filterTaxonomyTree(tree = [], keyword = '') {
  const query = keyword.trim().toLocaleLowerCase()
  if (!query) return tree
  return tree.flatMap((node) => {
    const children = filterTaxonomyTree(node.children || [], query)
    if (String(node.name || '').toLocaleLowerCase().includes(query) || children.length) return [{ ...node, children }]
    return []
  })
}

function collectDescendantIds(rows, id) {
  const excluded = new Set(id ? [Number(id)] : [])
  let changed = true
  while (changed) {
    changed = false
    rows.forEach((row) => {
      if (excluded.has(Number(row.parent_id)) && !excluded.has(Number(row.id))) {
        excluded.add(Number(row.id))
        changed = true
      }
    })
  }
  return excluded
}

export function taxonomyParentOptions(rows = [], currentId = 0) {
  const excluded = collectDescendantIds(rows, currentId)
  const options = [{ value: 0, label: '顶级分类' }]
  const append = (nodes, depth = 0) => nodes.forEach((node) => {
    if (!excluded.has(Number(node.id))) options.push({ value: node.id, label: `${'　'.repeat(depth)}${node.name}` })
    append(node.children || [], depth + 1)
  })
  append(buildTaxonomyTree(rows))
  return options
}
