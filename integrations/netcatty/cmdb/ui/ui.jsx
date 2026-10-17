import React from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Combobox } from '@/components/ui/combobox'
import { Spinner } from '@/components/ui/spinner'
import { AsidePanel, AsidePanelContent } from '@/components/ui/aside-panel'
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

const EMPTY_VALUE = '__cmdb_empty__'

export function PageHeader({ title, description, actions }) {
  return <header className="flex min-h-[48px] flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-1.5">
    <div className="min-w-0">
      <h1 className="text-[13px] font-semibold text-foreground">{title}</h1>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2 [&_button]:h-[32px] [&_button]:text-[12px]">{actions}</div> : null}
  </header>
}

export function Toolbar({ children, className }) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-4 py-2', className)}>{children}</div>
}

export function SearchBox({ value, onChange, onSearch, placeholder, inputRef, className, ...props }) {
  return <div className={cn('relative min-w-[220px] flex-1 sm:max-w-sm', className)}>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      ref={inputRef}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') onSearch?.() }}
      placeholder={placeholder}
      className="h-[32px] pl-9 pr-8 text-[12px]"
      {...props}
    />
    {value ? <button type="button" aria-label="清空" onClick={() => onChange?.('')} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button> : null}
  </div>
}

export function SelectControl({ value, onChange, options = [], placeholder = '请选择', className, disabled, id, searchable = false, 'aria-label': label }) {
  const [open, setOpen] = React.useState(false)
  const normalized = value === undefined || value === null || value === '' ? EMPTY_VALUE : String(value)
  if (searchable) return <Combobox ariaLabel={label || placeholder} disabled={disabled} className={className} triggerClassName="h-[32px] text-[12px]" allowCreate={false} options={options.map((option) => typeof option === 'object' ? { ...option, value: String(option.value ?? '') } : { value: String(option), label: String(option) })} value={normalized === EMPTY_VALUE ? '' : normalized} onValueChange={onChange} placeholder={placeholder} emptyText="没有匹配选项" />
  return <Select value={normalized} open={open} onOpenChange={setOpen} onValueChange={(next) => { if ((!next || next === EMPTY_VALUE) && normalized !== EMPTY_VALUE && !open) return; onChange?.(next === EMPTY_VALUE ? '' : next) }} disabled={disabled}>
    <SelectTrigger id={id} aria-label={label || placeholder} className={cn('h-[32px] min-w-[132px] text-[12px]', className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent>
      {options.map((option) => {
        const item = typeof option === 'object' ? option : { value: option, label: option }
        const itemValue = item.value === '' || item.value === undefined || item.value === null ? EMPTY_VALUE : String(item.value)
        return <SelectItem key={itemValue} value={itemValue} disabled={item.disabled}>{item.label}</SelectItem>
      })}
    </SelectContent>
  </Select>
}

export function Field({ label, required, error, className, children }) {
  return <div className={cn('grid gap-1.5', className)}>
    <Label className="text-xs text-muted-foreground">{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>
    {children}
    {error ? <span className="text-xs text-destructive">{error}</span> : null}
  </div>
}

export function FormGrid({ children, className }) {
  return <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}>{children}</div>
}

export function ModalForm({ open, onOpenChange, title, children, onSubmit, submitLabel = '保存', busy, wide = false }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={cn('max-h-[88vh] overflow-y-auto', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit?.() }} className="grid gap-4">
        {children}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button type="submit" disabled={busy}>{busy ? <Spinner className="mr-2" /> : null}{submitLabel}</Button>
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
    actions={actions}
    width="w-[420px]"
    layout="overlay"
    resizable
    persistWidthStorageKey="netcatty_cmdb_detail_panel_width_v1"
    resizeAriaLabel="调整详情面板宽度"
    dataSection="cmdb-detail-panel"
  >
    <AsidePanelContent>{children}</AsidePanelContent>
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
  return <Badge variant="outline" className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', tones[tone] || tones.neutral)}>{children || '-'}</Badge>
}

export function statusTone(value = '') {
  if (/在线|在用|运行|正常|已安装|空闲|在职/.test(value)) return 'success'
  if (/维修|维护|备用|保留|调休|待/.test(value)) return 'warning'
  if (/故障|报废|异常|离职|注销|停止|占用/.test(value)) return 'danger'
  return 'neutral'
}

export function DataTable({ columns, rows = [], rowKey = 'id', loading, empty = '暂无数据', selected = [], onSelectedChange, onRowClick, compact = false }) {
  const selectable = typeof onSelectedChange === 'function'
  const selectedSet = new Set(selected)
  const allSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row[rowKey]))
  return <div className="min-h-0 flex-1 overflow-auto">
    <table className={cn('w-full border-collapse text-left text-[12px]', compact ? 'table-fixed' : 'min-w-[760px]')}>
      <thead className="sticky top-0 z-[1] bg-secondary/30 text-[11px] text-muted-foreground backdrop-blur">
        <tr className="border-b border-border/30">
          {selectable ? <th className="w-9 px-3 py-1"><input type="checkbox" aria-label="选择全部" checked={allSelected} onChange={(event) => onSelectedChange(event.target.checked ? rows.map((row) => row[rowKey]) : [])} /></th> : null}
          {columns.map((column) => <th key={column.key} className={cn('h-[30px] whitespace-nowrap px-3 py-1 font-medium', column.headerClassName)}>{column.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {loading ? <tr><td colSpan={columns.length + (selectable ? 1 : 0)} className="h-40 text-center"><Spinner className="mx-auto text-muted-foreground" /></td></tr> : null}
        {!loading && !rows.length ? <tr><td colSpan={columns.length + (selectable ? 1 : 0)}><EmptyState label={empty} /></td></tr> : null}
        {!loading && rows.map((row) => <tr key={row[rowKey]} onClick={() => onRowClick?.(row)} className={cn('group border-b border-border/30 transition-colors hover:bg-secondary/60', onRowClick && 'cursor-pointer')}>
          {selectable ? <td className="px-3 py-1" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label="选择此行" checked={selectedSet.has(row[rowKey])} onChange={(event) => onSelectedChange(event.target.checked ? [...selected, row[rowKey]] : selected.filter((id) => id !== row[rowKey]))} /></td> : null}
          {columns.map((column) => <td key={column.key} className={cn('h-[38px] px-3 py-1 align-middle text-foreground', column.className)}>{column.render ? column.render(row[column.key], row) : (row[column.key] ?? '-')}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>
}

export function Pagination({ page, pageSize, total, onChange, pageSizes = [10, 20, 50, 100] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">
    <span>共 {total} 条，第 {page} / {pages} 页</span>
    <div className="flex items-center gap-2">
        <SelectControl value={pageSize} onChange={(value) => onChange(1, Number(value))} options={pageSizes.map((value) => ({ value, label: `${value} 条/页` }))} className="w-[108px] min-w-0" />
      <Button type="button" variant="outline" size="icon" className="h-[30px] w-[30px]" aria-label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1, pageSize)}><ChevronLeft className="h-4 w-4" /></Button>
      <Button type="button" variant="outline" size="icon" className="h-[30px] w-[30px]" aria-label="下一页" disabled={page >= pages} onClick={() => onChange(page + 1, pageSize)}><ChevronRight className="h-4 w-4" /></Button>
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
  return <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
    {items.map(([label, value]) => <div key={label} className="min-w-0 border-b border-border/40 py-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 min-w-0 break-words text-xs text-foreground">{value === '' || value === undefined || value === null ? '-' : value}</dd>
    </div>)}
  </dl>
}

export function Metric({ label, value, note, tone = 'default' }) {
  return <div className={cn('border-r border-border/60 px-4 py-3 last:border-r-0', tone === 'accent' && 'bg-primary/5')}>
    <p className="text-xs text-muted-foreground">{label}</p>
    <strong className="mt-0.5 block font-mono text-xl font-semibold tabular-nums text-foreground">{value ?? 0}</strong>
    {note ? <div className="mt-1 text-xs text-muted-foreground">{note}</div> : null}
  </div>
}

export function ActionIcon({ label, children, danger, ...props }) {
  return <Button type="button" variant="ghost" size="icon" className={cn('h-[28px] w-[28px]', danger && 'text-destructive hover:text-destructive')} aria-label={label} title={label} {...props}>{children}</Button>
}
