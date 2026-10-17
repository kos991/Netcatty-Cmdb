import React from 'react'
import { Activity, Cpu, History, Image as ImageIcon, KeyRound, MapPin, MonitorCog, Network, Server } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const TAB_ICONS = {
  hardware: Cpu,
  operations: Activity,
  network: Network,
  usage: MapPin,
  cabinet: Server,
  hosting: Server,
  system: MonitorCog,
  photos: ImageIcon,
  records: History,
  relations: KeyRound,
}

// 与 Netcatty 系统管理侧栏的纯图标模式一致：单行小图标，名称放在悬停提示里。
export function AssetDetailTabBar({ tabs, value, onChange, panelId, dataSection = 'asset-detail-tabs' }) {
  const handleKeyDown = (event) => {
    const index = tabs.findIndex(tab => tab.key === value)
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    if (next < 0 || !tabs.length) return
    event.preventDefault()
    onChange(tabs[next].key)
    event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus()
  }
  return <div role="tablist" aria-label="详情分区" data-section={dataSection} onKeyDown={handleKeyDown} className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/50 px-2">
    {tabs.map(({ key, label, icon }) => {
      const Icon = icon || TAB_ICONS[key] || Activity
      const active = value === key
      return <Tooltip key={key}>
        <TooltipTrigger asChild>
          <button id={`${dataSection}-${key}`} type="button" role="tab" aria-selected={active} aria-controls={panelId} aria-label={label} tabIndex={active ? 0 : -1} data-tab={key} onClick={() => onChange(key)} className={`grid h-6 w-7 shrink-0 place-items-center rounded transition-colors ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}>
            <Icon size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>{label}</TooltipContent>
      </Tooltip>
    })}
  </div>
}
