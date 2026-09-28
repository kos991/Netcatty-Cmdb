import React from 'react'
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ActionIcon, ErrorBanner, SelectControl, StatusPill, statusTone } from './ui'
import { choices } from './Fields'
import { shiftWorkOrderDate } from './state'

const DATE_MODES = [
  { value: 'day', label: '单日' },
  { value: 'range', label: '区间' },
  { value: 'all', label: '全部日期' },
]

export default function WorkOrderList({ dateScope, onDateScopeChange, filters, onFilterChange, onResetFilters, page, onPageChange, query, selectedId, onSelect, categories, operationTypes, priorities, statuses, results }) {
  const rows = query.error ? [] : query.data?.list || []
  const total = query.data?.total || 0
  const pages = Math.max(1, Math.ceil(total / 20))

  return <aside data-work-order-list className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border/70 bg-background">
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-3">
      <strong className="text-xs font-semibold">工单列表</strong>
      <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label="更多筛选" title="更多筛选" className="h-8 w-8"><Filter size={15} /></Button></PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="max-h-[min(70vh,520px)] w-[min(320px,calc(100vw-32px))] overflow-y-auto p-3">
          <div className="mb-3 flex items-center justify-between"><strong className="text-xs">筛选条件</strong><Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onResetFilters}>重置</Button></div>
          <div className="grid gap-3">
            <SelectControl aria-label="工单类别" value={filters.biz_type} onChange={(value) => onFilterChange('biz_type', value)} options={choices(categories, '全部类别')} className="w-full" />
            <SelectControl aria-label="运维类型" value={filters.operation_type} onChange={(value) => onFilterChange('operation_type', value)} options={choices(operationTypes, '全部运维类型')} className="w-full" />
            <SelectControl aria-label="优先级" value={filters.priority} onChange={(value) => onFilterChange('priority', value)} options={choices(priorities, '全部优先级')} className="w-full" />
            <SelectControl aria-label="处理结果" value={filters.result} onChange={(value) => onFilterChange('result', value)} options={choices(results, '全部结果')} className="w-full" />
            <Input aria-label="经办人" className="h-8 text-xs" placeholder="经办人" value={filters.maintainer} onChange={(event) => onFilterChange('maintainer', event.target.value)} />
            <Input aria-label="负责人" className="h-8 text-xs" placeholder="负责人" value={filters.owner} onChange={(event) => onFilterChange('owner', event.target.value)} />
            <Input aria-label="关联资产" className="h-8 text-xs" placeholder="关联资产名称" value={filters.asset_keyword} onChange={(event) => onFilterChange('asset_keyword', event.target.value)} />
          </div>
        </PopoverContent></Popover>
    </header>
    <div className="shrink-0 space-y-2.5 border-b border-border/40 px-3 py-3">
      <div className="flex min-w-0 items-center gap-1.5">
        {dateScope.mode === 'day' ? <>
          <ActionIcon label="前一天" onClick={() => onDateScopeChange({ ...dateScope, day: shiftWorkOrderDate(dateScope.day, -1) })}><ChevronLeft size={15} /></ActionIcon>
          <Input type="date" aria-label="选择日期" className="h-8 min-w-0 flex-1 text-xs" value={dateScope.day} onChange={(event) => onDateScopeChange({ ...dateScope, day: event.target.value })} />
          <ActionIcon label="后一天" onClick={() => onDateScopeChange({ ...dateScope, day: shiftWorkOrderDate(dateScope.day, 1) })}><ChevronRight size={15} /></ActionIcon>
        </> : <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dateScope.mode === 'range' ? '按发生时间筛选' : '查看全部日期'}</span>}
        <SelectControl aria-label="日期范围" value={dateScope.mode} onChange={(mode) => onDateScopeChange({ ...dateScope, mode })} options={DATE_MODES} className="w-[100px] min-w-0 shrink-0" />
      </div>
      {dateScope.mode === 'range' ? <div className="grid grid-cols-2 gap-2"><Input type="date" aria-label="开始日期" className="h-8 min-w-0 text-xs" value={dateScope.from || ''} max={dateScope.to || undefined} onChange={(event) => onDateScopeChange({ ...dateScope, from: event.target.value })} /><Input type="date" aria-label="结束日期" className="h-8 min-w-0 text-xs" value={dateScope.to || ''} min={dateScope.from || undefined} onChange={(event) => onDateScopeChange({ ...dateScope, to: event.target.value })} /></div> : null}
      <SelectControl aria-label="工单状态" value={filters.status} onChange={(value) => onFilterChange('status', value)} options={choices(statuses, '全部状态')} className="w-full min-w-0" />
    </div>
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="sticky top-0 z-[1] border-b border-border/40 bg-background px-4 py-2 text-[11px] text-muted-foreground">当前筛选 {total} 条</div>
      {query.error ? <ErrorBanner message={query.error} onRetry={query.reload} /> : query.loading ? <p className="px-4 py-8 text-center text-xs text-muted-foreground">正在加载工单...</p> : rows.length ? rows.map((row) => <button key={row.id} type="button" aria-pressed={selectedId === row.id} onClick={() => onSelect(row)} className={`w-full border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === row.id ? 'bg-muted/60' : ''}`}>
        <div className="flex min-w-0 items-center gap-2"><strong className="min-w-0 flex-1 truncate text-xs font-medium">{row.subject || '未命名工单'}</strong><StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill></div>
        <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground"><span className="min-w-0 truncate">{row.order_no || '-'} · {row.biz_type || '-'}</span><time className="shrink-0 tabular-nums">{String(row.plan_time || '').slice(11, 16)}</time></div>
      </button>) : <p className="px-4 py-10 text-center text-xs text-muted-foreground">当前条件下没有工单</p>}
    </div>
    <footer className="flex h-11 shrink-0 items-center justify-between border-t border-border/60 px-4 text-[11px] text-muted-foreground"><span>第 {page} / {pages} 页</span><div className="flex gap-1"><ActionIcon label="上一页" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={15} /></ActionIcon><ActionIcon label="下一页" disabled={page >= pages} onClick={() => onPageChange(page + 1)}><ChevronRight size={15} /></ActionIcon></div></footer>
  </aside>
}
