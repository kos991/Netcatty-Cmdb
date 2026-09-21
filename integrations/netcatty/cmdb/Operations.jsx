import React, { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ActionIcon, SelectControl } from './ui'
import WorkOrders from './WorkOrders'

export default function Operations({ focusTarget }) {
  const [view, setView] = useState('create')
  useEffect(() => {
    if (focusTarget?.tableKey === 'asset_logs') setView('stats')
  }, [focusTarget])

  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-[62px] shrink-0 items-center gap-3 border-b border-border/70 px-4">
      <strong className="text-sm">工单管理</strong>
      <span className="flex-1" />
      <SelectControl
        aria-label="工单页面"
        value={view}
        onChange={setView}
        className="w-[132px]"
        options={[{ value: 'create', label: '新建工单' }, { value: 'stats', label: '工单统计' }]}
      />
      <ActionIcon label="刷新当前页面" onClick={() => window.dispatchEvent(new Event('cmdb:refresh-work-orders'))}><RefreshCw size={15} /></ActionIcon>
    </header>
    <WorkOrders mode={view} />
  </div>
}
