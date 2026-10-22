import React, { useEffect, useRef, useState } from 'react'
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

const LABEL_THRESHOLD = 600

// 与 Netcatty 系统管理侧栏一致：窄侧栏为纯图标，拖宽后自动显示“图标 + 短文字”。
export function AssetDetailTabBar({ tabs, value, onChange, panelId, dataSection = 'asset-detail-tabs' }) {
  const listRef = useRef(null)
  const [showLabels, setShowLabels] = useState(false)

  useEffect(() => {
    const node = listRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? 0
      setShowLabels(width >= LABEL_THRESHOLD)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

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

  return <div ref={listRef} role="tablist" aria-label="详情分区" data-section={dataSection} data-show-labels={showLabels ? 'true' : 'false'} onKeyDown={handleKeyDown} className="flex h-[42px] min-h-[42px] shrink-0 items-center gap-[3px] overflow-x-auto border-b border-border/60 bg-background px-[10px] py-[5px]">
    {tabs.map(({ key, label, icon }) => {
      const Icon = icon || TAB_ICONS[key] || Activity
      const active = value === key
      return <Tooltip key={key}>
        <TooltipTrigger asChild>
          <button id={`${dataSection}-${key}`} type="button" role="tab" aria-selected={active} aria-controls={panelId} aria-label={label} title={label} tabIndex={active ? 0 : -1} data-tab={key} onClick={() => onChange(key)} className={`flex shrink-0 items-center justify-center transition-colors ${showLabels ? 'h-7 min-w-[44px] gap-[5px] px-2' : 'h-[26px] w-7 gap-0'} rounded-[5px] ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}>
            <Icon size={14} className="shrink-0" />
            {showLabels ? <span className="whitespace-nowrap text-[11px] leading-none">{label}</span> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>{label}</TooltipContent>
      </Tooltip>
    })}
  </div>
}
