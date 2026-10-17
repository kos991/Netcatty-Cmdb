import React, { useEffect, useState } from 'react'
import { ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { vaultHeaderIconButtonClass } from '@/components/vault/VaultPageHeader'
import { readAssetFilterSelection, removeAssetFilter, saveAssetFilterSelection } from './assetFilterModel'

export function useAssetFilterSelection(page, items, defaults, setFilters, onRemoved) {
  const keys = items.map((item) => item.key)
  const [visible, setVisible] = useState(() => readAssetFilterSelection(globalThis.localStorage, page, keys, defaults))
  useEffect(() => { saveAssetFilterSelection(globalThis.localStorage, page, visible) }, [page, visible])
  const toggle = (key) => {
    if (visible.includes(key)) {
      setFilters((current) => removeAssetFilter(visible, key, current).filters)
      setVisible((current) => current.filter((item) => item !== key))
      onRemoved?.()
    } else {
      setVisible(keys.filter((item) => visible.includes(item) || item === key))
    }
  }
  return { visible, toggle }
}

export default function AssetFilterPicker({ items, visible, onToggle, expanded = true, onExpandedChange }) {
  return <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className={`${vaultHeaderIconButtonClass} h-9 w-9`} aria-label="选择筛选项" title={`筛选项（已显示 ${visible.length}/${items.length}）`}><ListFilter size={16} /></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-48 p-1.5">
      {onExpandedChange ? <label className="mb-1 flex min-h-8 cursor-pointer items-center gap-2 border-b border-border px-2 pb-1 text-xs"><input type="checkbox" checked={expanded} onChange={event => onExpandedChange(event.target.checked)} />显示条件查询栏</label> : null}
      <div className="max-h-72 overflow-y-auto">{items.map((item) => <label key={item.key} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-2 text-xs hover:bg-muted"><input type="checkbox" checked={visible.includes(item.key)} onChange={() => { onToggle(item.key); onExpandedChange?.(true) }} />{item.label}</label>)}</div>
    </PopoverContent>
  </Popover>
}
