import React from 'react'
import { Maximize2, Minimize2, Pencil, X } from 'lucide-react'
import { AsidePanel, AsidePanelContent, AsidePanelFooter } from '@/components/ui/aside-panel'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ActionIcon, StatusPill, statusTone } from './ui'

export function AssetPanel({ open, onClose, title, subtitle, status, icon: Icon, expanded = false, onExpandedChange, onEdit, actions, children, footer, dataSection = 'cmdb-asset-panel' }) {
  return <AsidePanel open={open} onClose={onClose} width={expanded ? 'w-full' : 'w-[420px]'} dataSection={dataSection}>
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-4">
      {Icon ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Icon size={16} /></span> : null}
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-semibold">{title}</h2>{status ? <StatusPill tone={statusTone(status)}>{status}</StatusPill> : null}</div>{subtitle ? <p className="truncate text-[11px] text-muted-foreground" title={subtitle}>{subtitle}</p> : null}</div>
      <div className="flex shrink-0 items-center gap-0.5">{actions}{onExpandedChange ? <ActionIcon label={expanded ? '还原面板' : '展开面板'} onClick={() => onExpandedChange(!expanded)}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</ActionIcon> : null}{onEdit ? <ActionIcon label="编辑" onClick={onEdit}><Pencil size={15} /></ActionIcon> : null}<ActionIcon label="关闭详情" onClick={onClose}><X size={16} /></ActionIcon></div>
    </header>
    <AsidePanelContent className="min-h-0">{children}</AsidePanelContent>
    {footer ? <AsidePanelFooter>{footer}</AsidePanelFooter> : null}
  </AsidePanel>
}

export function AssetPanelSection({ title, icon: Icon, children, action }) {
  return <Card className="space-y-3 rounded-md border-border/80 bg-card p-3 shadow-none"><div className="flex min-h-5 items-center gap-2"><Icon size={15} className="shrink-0 text-muted-foreground" /><h3 className="min-w-0 flex-1 text-xs font-semibold">{title}</h3>{action}</div>{children}</Card>
}

export function AssetPanelFields({ items }) {
  return <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">{items.map(([label, value]) => <div key={label} className="min-w-0 border-b border-border/50 py-2 last:border-0"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 min-w-0 break-words text-xs text-foreground">{value === '' || value === undefined || value === null ? '-' : value}</dd></div>)}</dl>
}

export function AssetPanelSave({ onCancel, onSave, busy, label = '保存' }) {
  return <div className="flex gap-2"><Button variant="outline" className="h-10" onClick={onCancel} disabled={busy}>取消</Button><Button className="h-10 flex-1" onClick={onSave} disabled={busy}>{busy ? '保存中…' : label}</Button></div>
}
