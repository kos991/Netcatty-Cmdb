import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Columns2, Maximize2, Minimize2, Pencil, X } from 'lucide-react'
import { AsidePanel } from '@/components/ui/aside-panel'
import { Button } from '@/components/ui/button'
import { ActionIcon, StatusPill, statusTone } from './ui'
import './asset-panel.css'

export const ASSET_PANEL_DEFAULT_WIDTH = 420
export const ASSET_PANEL_MIN_WIDTH = 360
export const ASSET_PANEL_MAX_WIDTH = 720
export const ASSET_PANEL_WIDTH_STORAGE_KEY = 'netcatty.cmdb.assetPanel.width'
export const ASSET_PANEL_COLUMNS_STORAGE_KEY = 'netcatty.cmdb.assetPanel.columns'
const ASSET_PANEL_COLUMNS_EVENT = 'cmdb:asset-panel-columns'

const clampPanelWidth = (value) => Math.max(ASSET_PANEL_MIN_WIDTH, Math.min(ASSET_PANEL_MAX_WIDTH, Number(value)))

// 正文单/双列与面板全宽相互独立：全宽只改面板宽度，单双列只改正文栅格；选择在所有资产/人员面板间共享。
let currentBodyColumns = (() => {
  try { return globalThis.localStorage?.getItem(ASSET_PANEL_COLUMNS_STORAGE_KEY) === '1' ? 1 : 2 }
  catch (error) { console.warn('读取面板正文列数失败', error); return 2 }
})()

export function useAssetPanelColumns() {
  const [columns, setColumns] = useState(currentBodyColumns)
  useEffect(() => {
    const sync = () => setColumns(currentBodyColumns)
    window.addEventListener(ASSET_PANEL_COLUMNS_EVENT, sync)
    return () => window.removeEventListener(ASSET_PANEL_COLUMNS_EVENT, sync)
  }, [])
  const change = useCallback((next) => {
    currentBodyColumns = next === 1 ? 1 : 2
    try { globalThis.localStorage?.setItem(ASSET_PANEL_COLUMNS_STORAGE_KEY, String(currentBodyColumns)) }
    catch (error) { console.warn('保存面板正文列数失败', error) }
    window.dispatchEvent(new Event(ASSET_PANEL_COLUMNS_EVENT))
  }, [])
  return [columns, change]
}

export const assetPanelColumnsClass = (columns) => columns === 1 ? 'cmdb-panel-single-column' : 'cmdb-panel-double-column'

export function useAssetPanelLayout(open, expanded, onPanelOpenChange) {
  const [width, setWidth] = useState(ASSET_PANEL_DEFAULT_WIDTH)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  // 展开态宿主会报告全宽，不能覆盖还原时使用的分栏宽度。
  const reportWidth = useCallback((value) => {
    if (expandedRef.current) return
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) setWidth(clampPanelWidth(numeric))
  }, [])
  useEffect(() => {
    onPanelOpenChange?.(open, open ? (expanded ? 'full' : width) : 0)
  }, [open, expanded, width, onPanelOpenChange])
  useEffect(() => () => onPanelOpenChange?.(false, 0), [onPanelOpenChange])
  // 非资产页（如人员）没有 cmdb-asset-page 外框，直接用内边距让位；资产页由 CSS 变量单一负责。
  return { onWidthChange: reportWidth, style: open && !expanded ? { paddingInlineEnd: `min(${width}px, 100%)` } : undefined }
}

export function AssetPanelFrame({ open, expanded = false, onClose, onWidthChange, children, dataSection = 'cmdb-asset-panel', className = '' }) {
  const [columns] = useAssetPanelColumns()
  const frameRef = useRef(null)
  const pageRef = useRef(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  // 宽度只有宿主一个来源：宿主回调同时驱动页面让位变量与列表状态，不再自建观察器。
  const handleWidth = useCallback((width) => {
    const page = pageRef.current || frameRef.current?.closest('.cmdb-asset-page')
    pageRef.current = page
    if (!expandedRef.current && page && width > 0) page.style.setProperty('--cmdb-panel-space', `${Math.round(width)}px`)
    onWidthChange?.(width)
  }, [onWidthChange])
  useEffect(() => {
    const page = pageRef.current || frameRef.current?.closest('.cmdb-asset-page')
    pageRef.current = page
    // 清理先于宿主回调执行顺序不确定：打开/还原时按已渲染宽度补一次让位值。
    const rendered = Math.round(frameRef.current?.getBoundingClientRect().width || 0)
    page?.style.setProperty('--cmdb-panel-space', open && !expanded && rendered > 0 ? `${rendered}px` : '0px')
    // 关闭/卸载后释放让位，列表恢复全宽。
    return () => page?.style.setProperty('--cmdb-panel-space', '0px')
  }, [open, expanded])
  return <AsidePanel open={open} onClose={onClose} width={expanded ? 'w-full' : `w-[${ASSET_PANEL_DEFAULT_WIDTH}px]`} layout="overlay" resizable={!expanded} minWidthPx={ASSET_PANEL_MIN_WIDTH} maxWidthPx={ASSET_PANEL_MAX_WIDTH} persistWidthStorageKey={ASSET_PANEL_WIDTH_STORAGE_KEY} resizeAriaLabel="调整资产面板宽度" onWidthChange={handleWidth} dataSection={dataSection} className={`cmdb-asset-panel ${assetPanelColumnsClass(columns)} ${className}`}>
    <div ref={frameRef} className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
  </AsidePanel>
}

// 第一条栏：对象信息 + 放大/还原（面板全宽）、左右分栏（正文单双列）、关闭，恰好三项且互不共用状态。
export function AssetPanelHeader({ title, subtitle, status, icon: Icon, expanded = false, onExpandedChange, onClose }) {
  const [columns, setColumns] = useAssetPanelColumns()
  const doubleColumns = columns === 2
  return <header className="cmdb-record-header cmdb-asset-panel-header" data-section="asset-panel-header">
    {Icon ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Icon size={16} /></span> : null}
    <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><h2 className="min-w-0 truncate text-sm font-semibold leading-5" title={typeof title === 'string' ? title : undefined}>{title}</h2>{status ? <StatusPill tone={statusTone(status)}>{status}</StatusPill> : null}</div>{subtitle ? <p className="truncate text-[11px] text-muted-foreground" title={subtitle}>{subtitle}</p> : null}</div>
    <div className="cmdb-asset-panel-controls flex shrink-0 items-center gap-px">
      <ActionIcon label={expanded ? '还原面板宽度' : '放大为全宽'} aria-pressed={expanded} data-panel-control="expand" onClick={() => onExpandedChange?.(!expanded)}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</ActionIcon>
      <ActionIcon label={doubleColumns ? '正文改为单列' : '正文改为左右双列'} aria-pressed={doubleColumns} data-panel-control="columns" onClick={() => setColumns(doubleColumns ? 1 : 2)}><Columns2 size={15} /></ActionIcon>
      <ActionIcon label="关闭" data-panel-control="close" onClick={onClose}><X size={16} /></ActionIcon>
    </div>
  </header>
}

// 第二条栏：业务操作，编辑入口在此渲染，不再丢失。
export function AssetPanelActions({ onEdit, children }) {
  return <div role="toolbar" aria-label="资产操作" className="cmdb-asset-panel-actions flex min-h-10 shrink-0 items-center gap-px overflow-x-auto border-b border-border/60 bg-background px-[10px] py-1">{onEdit ? <ActionIcon label="编辑资产" onClick={onEdit}><Pencil size={15} /></ActionIcon> : null}{children}</div>
}

export function AssetPanel({ open, onClose, title, subtitle, status, icon, expanded: controlledExpanded, onExpandedChange, onWidthChange, onEdit, actions, tabs, children, footer, dataSection = 'cmdb-asset-panel' }) {
  const [localExpanded, setLocalExpanded] = useState(false)
  const expanded = controlledExpanded ?? localExpanded
  const changeExpanded = useCallback((value) => { setLocalExpanded(value); onExpandedChange?.(value) }, [onExpandedChange])
  useEffect(() => { if (!open) setLocalExpanded(false) }, [open])
  return <AssetPanelFrame open={open} expanded={expanded} onClose={onClose} onWidthChange={onWidthChange} dataSection={dataSection}>
    <AssetPanelHeader title={title} subtitle={subtitle} status={status} icon={icon} expanded={expanded} onExpandedChange={changeExpanded} onClose={onClose} />
    {onEdit || actions ? <AssetPanelActions onEdit={onEdit}>{actions}</AssetPanelActions> : null}
    {tabs}
    <div className="cmdb-record-body flex-1">{children}</div>
    {footer ? <div className="cmdb-record-footer">{footer}</div> : null}
  </AssetPanelFrame>
}

export function AssetPanelSection({ title, icon: Icon, children, action }) {
  return <section className="cmdb-record-section cmdb-asset-section">
    <div className="mb-3 flex min-h-5 items-center gap-2">{Icon ? <Icon size={15} className="shrink-0 text-muted-foreground" /> : null}<h3 className="min-w-0 flex-1">{title}</h3>{action}</div>
    <div className="min-w-0 space-y-3">{children}</div>
  </section>
}

export function AssetPanelFields({ items }) {
  return <dl className="cmdb-record-fields cmdb-asset-fields">{items.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs leading-[17px] text-muted-foreground">{label}</dt><dd className="mt-1.5 min-w-0 break-words text-[13px] leading-5 text-foreground">{value === '' || value === undefined || value === null || value === '-' ? '未配置' : value}</dd></div>)}</dl>
}

export function AssetPanelSave({ onCancel, onSave, busy, label = '保存' }) {
  return <div className="flex justify-end gap-2"><Button type="button" variant="outline" className="h-[34px] min-w-[72px] text-xs" onClick={onCancel} disabled={busy}>取消</Button><Button type="button" className="cmdb-primary-action h-[34px] min-w-[96px] text-xs" onClick={onSave} disabled={busy}>{busy ? '保存中…' : label}</Button></div>
}
