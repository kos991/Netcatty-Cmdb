import React, { useCallback } from 'react'
import { api } from './api'
import { flattenOrgTree } from './state'
import { choices } from './Fields'
import Catalog from './Catalog'

export const ORG_TYPES = { organization: '组织', department: '部门', group: '分组' }
export default function Organizations() {
  const load = useCallback(async () => flattenOrgTree((await api.orgTree()).list || []), [])
  return <Catalog title="组织节点" load={load} defaults={{ node_type: 'organization', parent_id: 0, sort_order: 0 }}
    save={(values, record) => { const body = { ...values, parent_id: values.node_type === 'organization' ? 0 : values.parent_id }; return record.id ? api.updateConfig('org-nodes', record.id, body) : api.createConfig('org-nodes', body) }}
    remove={(row) => api.deleteConfig('org-nodes', row.id)}
    columns={[{ key: 'name', label: '名称', render: (v, row) => <span style={{ paddingLeft: row.depth * 16 }}>{v}</span> }, { key: 'node_type', label: '类型', render: (v) => ORG_TYPES[v] }, { key: 'sort_order', label: '排序' }]}
    fields={(values, record, items) => [
      { key: 'node_type', label: '节点类型', disabled: !!record?.id, options: Object.entries(ORG_TYPES).map(([value, label]) => ({ value, label })), derive: () => ({ parent_id: 0 }) },
      { key: 'parent_id', label: '上级节点', required: values.node_type !== 'organization', numeric: true, hidden: values.node_type === 'organization', options: choices(items.filter((item) => item.node_type === (values.node_type === 'group' ? 'department' : 'organization') && item.id !== record?.id).map((item) => ({ value: item.id, label: item.name }))) },
      { key: 'name', label: '名称', required: true }, { key: 'sort_order', label: '排序', type: 'number', min: 0 },
    ]} />
}
