import React, { useState } from 'react'
import { Archive, ArrowLeftRight, ChevronDown, Copy, Eye, Pencil, Wrench } from 'lucide-react'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'

// 三类资产统一的行操作：一个紧凑“操作”按钮，菜单按“查看/编辑 → 业务流程 → 注销归档”分组，保留全部原有操作。
export default function AssetRowActions({ name = '', onEdit, onDetail, onClone, onTransfer, onMaintenance, onArchive }) {
  const [open, setOpen] = useState(false)
  const groups = [
    [
      { label: '查看详情', icon: Eye, action: onDetail },
      { label: '编辑资产', icon: Pencil, action: onEdit },
    ],
    [
      { label: '克隆资产', icon: Copy, action: onClone },
      { label: '调换使用人', icon: ArrowLeftRight, action: onTransfer },
      { label: '维修换件', icon: Wrench, action: onMaintenance },
    ],
    [{ label: '注销归档', icon: Archive, action: onArchive, danger: true }],
  ].map(group => group.filter(item => item.action)).filter(group => group.length)
  const triggerLabel = name ? `${name} 的操作` : '资产操作'
  return <div className="flex items-center justify-end">
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <button type="button" aria-label={triggerLabel} title={triggerLabel} aria-haspopup="menu" aria-expanded={open} data-asset-row-actions className="cmdb-asset-row-actions inline-flex h-7 items-center gap-0.5 rounded-md border border-border/70 bg-background px-2 text-[11px] text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          操作<ChevronDown size={12} className="text-muted-foreground" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-36" keyboardNavigation>
        {groups.map((group, index) => <div key={index} role="group" aria-label={index === 0 ? '查看与编辑' : group.some(item => item.danger) ? '归档' : '业务流程'} className={index ? 'mt-1 border-t border-border/60 pt-1' : ''}>
          {group.map(({ label, icon: Icon, action, danger }) => <button key={label} type="button" role="menuitem" className={`flex h-8 w-full items-center gap-2 rounded px-2 text-xs hover:bg-secondary ${danger ? 'text-destructive' : ''}`} onClick={() => { setOpen(false); action() }}><Icon size={14} />{label}</button>)}
        </div>)}
      </DropdownContent>
    </Dropdown>
  </div>
}
