import React, { useCallback, useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { requestJson } from './transport'
import Catalog from './Catalog'

const KINDS = [['orgs', '资产组织'], ['groups', '资产分组'], ['categories', '设备分类']]
export default function Taxonomy({ onChanged }) {
  const [kind, setKind] = useState('groups')
  const load = useCallback(async () => (await requestJson(`/api/cmdb/taxonomy/${kind}`)).list || [], [kind])
  const title = KINDS.find(([key]) => key === kind)[1]
  return <div className="flex min-h-0 flex-col"><Tabs value={kind} onValueChange={setKind}><TabsList>{KINDS.map(([key, label]) => <TabsTrigger value={key} key={key}>{label}</TabsTrigger>)}</TabsList></Tabs><Catalog key={kind} title={title} load={load} defaults={{ parent_id: 0, sort_order: 0 }}
    onChanged={onChanged}
    save={(values, row) => requestJson(`/api/cmdb/taxonomy/${kind}${row.id ? `/${row.id}` : ''}`, { method: row.id ? 'PUT' : 'POST', body: JSON.stringify(values) })}
    remove={(row) => requestJson(`/api/cmdb/taxonomy/${kind}/${row.id}`, { method: 'DELETE' })}
    columns={[{ key: 'name', label: '名称' }, { key: 'sort_order', label: '排序' }]}
    fields={(values, original, rows) => {
      const excluded = new Set(original?.id ? [original.id] : [])
      let changed = true
      while (changed) { changed = false; rows.forEach((item) => { if (excluded.has(item.parent_id) && !excluded.has(item.id)) { excluded.add(item.id); changed = true } }) }
      return [{ key: 'name', label: '名称', required: true }, { key: 'parent_id', label: '上级', numeric: true, options: [{ value: 0, label: '顶级' }, ...rows.filter((r) => !excluded.has(r.id)).map((r) => ({ value: r.id, label: r.name }))] }, { key: 'sort_order', label: '排序', type: 'number', min: 0 }]
    }} /></div>
}
