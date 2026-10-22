import React from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { AssetFormTabs } from './AssetFormTabs'

// 三类资产共用的 860px 居中新增表单：页头、图标分区页签、独立滚动正文和固定底栏。
export default function AssetCreateDialog({ open, onOpenChange, title, subtitle, icon: Icon, tabs, tab, onTabChange, children, footer, busy, dataSection = 'cmdb-asset-create' }) {
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onOpenChange(false) }}>
    <DialogContent className="cmdb-record-shell flex h-[min(680px,calc(100dvh-48px))] max-h-[calc(100dvh-48px)] w-[min(860px,calc(100vw-32px))] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden p-0" data-section={dataSection}>
      <header className="cmdb-record-header pr-12">
        {Icon ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Icon size={16} /></span> : null}
        <div className="min-w-0 flex-1"><DialogTitle className="truncate text-sm font-semibold leading-5">{title}</DialogTitle>{subtitle ? <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p> : null}</div>
      </header>
      {tabs?.length ? <AssetFormTabs tabs={tabs} value={tab} onChange={onTabChange} dataSection={`${dataSection}-tabs`} /> : null}
      <div className="cmdb-record-body min-h-0 flex-1 space-y-3" aria-busy={busy || undefined}>{children}</div>
      {footer ? <div className="cmdb-record-footer">{footer}</div> : null}
    </DialogContent>
  </Dialog>
}
