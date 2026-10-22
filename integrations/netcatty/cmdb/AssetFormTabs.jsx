import React, { useMemo, useState } from 'react'
import { Cpu, KeyRound, MapPin, Network, Server, Settings2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AssetDetailTabBar } from './AssetDetailTabs'

// 新增/编辑与详情共用图标页签：窄侧栏纯图标，宽于 600px 显示短文字。
const FORM_ICONS = { basic: Settings2, ownership: MapPin, network: Network, hardware: Cpu, credentials: KeyRound, hosting: Server }

export function AssetFormTabs({ tabs, value, onChange, dataSection = 'asset-form-tabs' }) {
  // 分区由同一表单内的隐藏面板承载，不声明指向不存在的 aria-controls。
  return <AssetDetailTabBar tabs={tabs.map((tab) => ({ ...tab, icon: tab.icon || FORM_ICONS[tab.key] || Settings2 }))} value={value} onChange={onChange} dataSection={dataSection} />
}

// 隐藏分区保持挂载：切换页签、展开/还原、切换设备类型都不重置草稿。
export function AssetFormPanel({ active, children, section }) {
  return <div hidden={!active} data-form-section={section} className="space-y-3">{children}</div>
}

const draftSignature = (value) => JSON.stringify(value || {})

export function useAssetDraftGuard(baseline, values, onDiscard) {
  const [discardOpen, setDiscardOpen] = useState(false)
  const dirty = useMemo(() => draftSignature(baseline) !== draftSignature(values), [baseline, values])
  return {
    dirty,
    discardOpen,
    setDiscardOpen,
    requestClose: () => { if (dirty) setDiscardOpen(true); else onDiscard() },
    discard: () => { setDiscardOpen(false); onDiscard() },
  }
}

export function AssetDraftDiscardDialog({ guard, busy }) {
  return <ConfirmDialog open={guard.discardOpen} onOpenChange={guard.setDiscardOpen} title="放弃未保存的修改？" message="选择取消可继续编辑并保留当前填写内容；放弃后本次修改不会保存。" confirmLabel="放弃修改" destructive busy={busy} onConfirm={guard.discard} />
}
