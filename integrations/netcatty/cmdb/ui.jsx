import React from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Combobox } from '@/components/ui/combobox'
import { Spinner } from '@/components/ui/spinner'
import { AsidePanel } from '@/components/ui/aside-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import './cmdb-ui.css'

const EMPTY_VALUE = '__cmdb_empty__'

export function PageHeader({ title, description, actions }) {
  return <header className="cmdb-page-header flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2">
    <div className="min-w-0">
      <h1 className="text-[13px] font-semibold text-foreground">{title}</h1>
      {description ? <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2 [&_button]:h-[34px] [&_button]:text-[12px]">{actions}</div> : null}
  </header>
}

export function Toolbar({ children, className, hidden = false }) {
  return <div hidden={hidden} className={cn(hidden ? 'hidden' : 'flex', 'cmdb-toolbar shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-3.5 py-2', className)}>{children}</div>
}

export function SearchBox({ value, onChange, onSearch, placeholder, inputRef, className, ...props }) {
  return <div className={cn('relative min-w-0 basis-[220px] flex-1 sm:max-w-sm', className)}>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      ref={inputRef}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') onSearch?.() }}
      placeholder={placeholder}
      className="h-[34px] pl-9 pr-8 text-[12px]"
      {...props}
    />
    {value ? <button type="button" aria-label="清空" onClick={() => onChange?.('')} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button> : null}
  </div>
}

export function SelectControl({ value, onChange, options = [], placeholder = '请选择', prefix, className, disabled, id, searchable = false, 'aria-label': label }) {
  const [open, setOpen] = React.useState(false)
  const normalized = value === undefined || value === null || value === '' ? EMPTY_VALUE : String(value)
  if (searchable) return <Combobox ariaLabel={label || placeholder} disabled={disabled} className={className} triggerClassName="h-[34px] text-[12px]" allowCreate={false} options={options.map((option) => typeof option === 'object' ? { ...option, value: String(option.value ?? '') } : { value: String(option), label: String(option) })} value={normalized === EMPTY_VALUE ? '' : normalized} onValueChange={onChange} placeholder={placeholder} emptyText="没有匹配选项" />
  return <Select value={normalized} open={open} onOpenChange={setOpen} onValueChange={(next) => { if ((!next || next === EMPTY_VALUE) && normalized !== EMPTY_VALUE && !open) return; onChange?.(next === EMPTY_VALUE ? '' : next) }} disabled={disabled}>
    <SelectTrigger id={id} aria-label={label || prefix || placeholder} className={cn('h-[34px] min-w-[132px] text-[12px]', className)}>{prefix ? <span className="shrink-0 text-muted-foreground">{prefix}：</span> : null}<SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent>
      {options.map((option) => {
        const item = typeof option === 'object' ? option : { value: option, label: option }
        const itemValue = item.value === '' || item.value === undefined || item.value === null ? EMPTY_VALUE : String(item.value)
        return <SelectItem key={itemValue} value={itemValue} disabled={item.disabled}>{item.label}</SelectItem>
      })}
    </SelectContent>
  </Select>
}

export function Field({ label, required, error, className, children, htmlFor }) {
  return <div className={cn('cmdb-field grid min-w-0 gap-1.5', className)}>
    <Label htmlFor={htmlFor} className="text-xs font-normal leading-[17px] text-muted-foreground">{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>
    {children}
    {error ? <span className="text-xs text-destructive">{error}</span> : null}
  </div>
}

export function FormGrid({ children, className }) {
  return <div className={cn('cmdb-form-grid grid min-w-0 grid-cols-1 gap-x-3.5 gap-y-3 sm:grid-cols-2', className)}>{children}</div>
}

export function ModalForm({ open, onOpenChange, title, children, onSubmit, submitLabel = '保存', busy, wide = false }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={cn('cmdb-record-shell cmdb-modal-form flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0', wide ? 'sm:max-w-[860px]' : 'sm:max-w-xl')}>
      <DialogHeader className="cmdb-record-header pr-12"><DialogTitle className="text-sm font-semibold leading-5">{title}</DialogTitle></DialogHeader>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit?.() }} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="cmdb-record-body grid content-start gap-4">{children}</div>
        <DialogFooter className="cmdb-record-footer">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button type="submit" className="cmdb-primary-action" disabled={busy}>{busy ? <Spinner className="mr-2" /> : null}{submitLabel}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

export function DetailSheet({ open, onOpenChange, title, children, actions }) {
  return <AsidePanel
    open={open}
    onClose={() => onOpenChange?.(false)}
    title={title}
    className="cmdb-record-shell"
    headerClassName="cmdb-record-header"
    actions={actions}
    width="w-[420px]"
    layout="overlay"
    resizable
    persistWidthStorageKey="netcatty_cmdb_detail_panel_width_v1"
    resizeAriaLabel="调整详情面板宽度"
    dataSection="cmdb-detail-panel"
  >
    <div className="cmdb-record-body">{children}</div>
  </AsidePanel>
}

export function StatusPill({ children, tone = 'neutral' }) {
  const tones = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    danger: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    neutral: 'border-border bg-muted/50 text-muted-foreground',
  }
  return <Badge variant="outline" className={cn('shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', tones[tone] || tones.neutral)}>{children || '-'}</Badge>
}

export function statusTone(value = '') {
  if (/在线|在用|运行|正常|已安装|空闲|在职/.test(value)) return 'success'
  if (/维修|维护|备用|保留|调休|待/.test(value)) return 'warning'
  if (/故障|报废|异常|离职|注销|停止|占用/.test(value)) return 'danger'
  return 'neutral'
}

export function DataTable({ columns, rows = [], rowKey = 'id', loading, empty = '暂无数据', selected = [], onSelectedChange, onRowClick, compact = false, dense = true, rowClassName, pinSelection = false, assetLayout = false, highlightKey = null }) {
  const selectable = typeof onSelectedChange === 'function'
  const selectedSet = new Set(selected)
  const allSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row[rowKey]))
  const hasPinnedColumns = pinSelection || columns.some((column) => column.sticky)
  const selectionWidth = assetLayout ? 32 : pinSelection ? 40 : 36
  const totalWeight = assetLayout ? columns.reduce((sum, column) => sum + (column.key === 'actions' ? 0 : column.width || 1), 0) : 0
  const actionWidth = columns.find(column => column.key === 'actions')?.width || 80
  const columnStyle = (column, index) => ({
    ...(assetLayout ? { width: column.key === 'actions' ? actionWidth : `calc(${((column.width || 1) / totalWeight * 100).toFixed(4)}% - ${((column.width || 1) / totalWeight * (actionWidth + (selectable ? selectionWidth : 0))).toFixed(4)}px)` } : column.width ? { width: column.width, minWidth: column.width } : {}),
    ...(column.sticky === 'left' ? { left: assetLayout ? (selectable ? selectionWidth : 0) : (selectable && pinSelection ? selectionWidth : 0) + columns.slice(0, index).filter((item) => item.sticky === 'left').reduce((sum, item) => sum + item.width, 0) } : {}),
    ...(column.sticky === 'right' ? { right: assetLayout ? (column.key === 'actions' ? 0 : actionWidth) : columns.slice(index + 1).filter((item) => item.sticky === 'right').reduce((sum, item) => sum + item.width, 0) } : {}),
  })
  const tight = dense && !assetLayout
  return <div className={cn('min-h-0 min-w-0 flex-1 overflow-auto', assetLayout && 'cmdb-asset-table-viewport')}>
    <table className={cn('w-full text-left text-[12px]', assetLayout && 'cmdb-asset-table table-fixed', hasPinnedColumns ? 'border-separate border-spacing-0' : 'border-collapse', compact && !assetLayout ? 'table-fixed' : !assetLayout ? 'min-w-[760px]' : '')}>
      <thead className={cn('sticky top-0 z-20 bg-background text-[11px] text-muted-foreground')}>
        <tr className="border-b border-border/30">
          {selectable ? <th style={{ width: selectionWidth, minWidth: selectionWidth }} className={cn('px-3 py-1', hasPinnedColumns && 'border-b border-border/30', pinSelection && 'sticky left-0 z-10 bg-background')}><input type="checkbox" aria-label="选择全部" checked={allSelected} onChange={(event) => onSelectedChange(event.target.checked ? rows.map((row) => row[rowKey]) : [])} /></th> : null}
          {columns.map((column, index) => <th key={column.key} style={columnStyle(column, index)} title={column.headerTitle || (typeof column.label === 'string' ? column.label : undefined)} aria-label={column.headerTitle} className={cn('whitespace-nowrap bg-background px-3 font-normal', assetLayout ? 'h-11 py-3' : 'h-9 py-2', column.headerClassName, hasPinnedColumns && 'border-b border-border/30', column.sticky && 'sticky z-10')}>{column.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {loading ? <tr><td colSpan={columns.length + (selectable ? 1 : 0)} className="h-40 text-center"><Spinner className="mx-auto text-muted-foreground" /></td></tr> : null}
        {!loading && !rows.length ? <tr><td colSpan={columns.length + (selectable ? 1 : 0)}><EmptyState label={empty} /></td></tr> : null}
        {!loading && rows.map((row) => <tr key={row[rowKey]} data-row-key={row[rowKey]} onClick={() => onRowClick?.(row)} className={cn('group border-b border-border/30 bg-background transition-colors hover:bg-secondary/50', onRowClick && 'cursor-pointer', highlightKey != null && String(highlightKey) === String(row[rowKey]) && 'bg-primary/10 ring-1 ring-inset ring-primary/40')}>
          {selectable ? <td className={cn('bg-inherit px-3 py-1', hasPinnedColumns && 'border-b border-border/30', pinSelection && 'sticky left-0 z-10')} onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label="选择此行" checked={selectedSet.has(row[rowKey])} onChange={(event) => onSelectedChange(event.target.checked ? [...selected, row[rowKey]] : selected.filter((id) => id !== row[rowKey]))} /></td> : null}
          {columns.map((column, index) => <td key={column.key} style={columnStyle(column, index)} className={cn('bg-inherit px-3 align-middle text-foreground', assetLayout ? 'h-[57px] py-2.5' : tight ? 'h-10 py-1.5' : 'h-[57px] py-2.5', rowClassName, column.className, hasPinnedColumns && 'border-b border-border/30', column.sticky && 'sticky z-10')}>{column.render ? column.render(row[column.key], row) : (row[column.key] ?? '-')}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>
}

export function Pagination({ page, pageSize, total, onChange, pageSizes = [10, 20, 50, 100] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/70 px-3.5 py-2 text-[11px] text-muted-foreground">
    <span>共 {total} 条，第 {page} / {pages} 页</span>
    <div className="flex items-center gap-2">
        <SelectControl value={pageSize} onChange={(value) => onChange(1, Number(value))} options={pageSizes.map((value) => ({ value, label: `${value} 条/页` }))} className="h-[30px] w-[108px] min-w-0" />
      <Button type="button" variant="outline" className="h-[29px] px-2.5 text-[11px]" disabled={page <= 1} onClick={() => onChange(page - 1, pageSize)}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>
      <Button type="button" variant="outline" className="h-[29px] px-2.5 text-[11px]" disabled={page >= pages} onClick={() => onChange(page + 1, pageSize)}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button>
    </div>
  </footer>
}

export function EmptyState({ label = '暂无数据' }) {
  return <div className="grid min-h-36 place-items-center p-6 text-center text-sm text-muted-foreground"><div><Inbox className="mx-auto mb-2 h-7 w-7 opacity-50" /><span>{label}</span></div></div>
}

export function ErrorBanner({ title = '加载失败', message, onRetry }) {
  return <div role="alert" className="mx-5 my-4 flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
    <div className="min-w-0 flex-1"><strong className="block font-medium text-foreground">{title}</strong><p className="mt-0.5 break-words text-muted-foreground">{message}</p></div>
    {onRetry ? <Button type="button" variant="outline" size="sm" onClick={onRetry}>重试</Button> : null}
  </div>
}

export function DefinitionList({ items }) {
  return <dl className="cmdb-definition-list grid min-w-0 grid-cols-1 gap-x-3.5 gap-y-3 sm:grid-cols-2">
    {items.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="text-xs leading-[17px] text-muted-foreground">{label}</dt><dd className="mt-1 min-w-0 break-words text-[13px] leading-5 text-foreground">{value === '' || value === undefined || value === null ? '-' : value}</dd>
    </div>)}
  </dl>
}

export function Metric({ label, value, note, tone = 'default' }) {
  return <div className={cn('min-w-0 border-r border-border/60 px-3.5 py-2.5 last:border-r-0', tone === 'accent' && 'bg-primary/5')}>
    <p className="text-[10px] text-muted-foreground">{label}</p>
    <strong className="mt-0.5 block font-mono text-base font-semibold tabular-nums text-foreground">{value ?? 0}</strong>
    {note ? <div className="mt-1 text-[11px] text-muted-foreground">{note}</div> : null}
  </div>
}

export function ActionIcon({ label, children, danger, className, ...props }) {
  return <Button type="button" variant="ghost" size="icon" className={cn('h-[28px] w-[28px] shrink-0', danger && 'text-destructive hover:text-destructive', className)} aria-label={label} title={label} {...props}>{children}</Button>
}

// 三类资产列表首列统一样式：主名称 12px 加粗链接色，副信息 10px 灰色，均截断并保留完整悬停提示。
export function AssetNameCell({ title, subtitle, onOpen }) {
  return <div className="min-w-0">
    <Button type="button" variant="link" title={title} className="h-auto max-w-full justify-start truncate p-0 text-left text-[12px] font-semibold" onClick={onOpen}>{title}</Button>
    {subtitle ? <p title={subtitle} className="mt-1 truncate text-[10px] leading-[1.45] text-muted-foreground">{subtitle}</p> : null}
  </div>
}
