import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from './api'
import { allPages, useDirectory } from './hooks'
import { EmptyState, ErrorBanner } from './ui'
import { buildRackLayout, DEFAULT_RACK_UNITS, rackKey, rackLocationName, UNKNOWN_ROOM } from './rackLayoutModel'
import { deviceTypeLabel } from './deviceWorkspaceModel'
import { supportsInfrastructurePhotos } from './state'
import './rack-management.css'

const UNIT_HEIGHT = 24
const deviceTitle = (asset) => asset.name || asset.asset_code || `资产 #${asset.id}`
const deviceSubtitle = (asset) => [deviceTypeLabel(asset), asset.mgmt_ip || asset.manage_ip].filter(Boolean).join(' · ')

function RackDiagram({ layout, cabinetKey, selectedDeviceID, onSelectDevice, onSelectUnit, onOpenAsset, preview }) {
  const scrollRef = useRef(null)
  const locatedSelection = useRef('')
  const selectedID = Number(selectedDeviceID) || 0
  const selected = layout.placed.find((item) => Number(item.asset.id) === selectedID)

  useLayoutEffect(() => {
    const selectionKey = `${cabinetKey}:${selectedID}`
    if (locatedSelection.current === selectionKey || !scrollRef.current) return
    locatedSelection.current = selectionKey
    const container = scrollRef.current
    const placement = layout.placed.find((item) => Number(item.asset.id) === selectedID)
    const top = placement ? (layout.totalUnits - placement.top) * UNIT_HEIGHT : 0
    const bottom = top + (placement?.height || 1) * UNIT_HEIGHT
    if (!placement || top < container.scrollTop) container.scrollTop = top
    else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = Math.max(0, bottom - container.clientHeight)
  }, [cabinetKey, selectedID, layout])

  return <div ref={scrollRef} className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overscroll-contain pr-[5px] [scrollbar-width:thin]" style={{ minHeight: UNIT_HEIGHT * 6 }} data-section="device-rack-units" aria-label={`${layout.totalUnits}U 机柜图`}><div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-[3px] border border-[#62676d] bg-[#edf0f1] dark:border-border dark:bg-muted/30">
    {layout.rows.map((row) => {
      const isSelected = row.type === 'device' && Number(row.asset.id) === selectedID
      const interactive = row.type === 'device' && (!!onSelectDevice || (!!onOpenAsset && (!preview || !isSelected)))
      return <div key={row.unit} className="flex w-full" style={{ height: row.height * UNIT_HEIGHT }}>
        <div className="w-[42px] shrink-0 border-r border-[#d7dbdf] bg-[#f2f3f4] text-[#555e69] tabular-nums dark:border-border dark:bg-muted/25 dark:text-muted-foreground">
          {Array.from({ length: row.height }, (_, index) => {
            const unit = row.unit - index
            const currentStart = selected?.start === unit
            const labelClass = `flex w-full items-center justify-center border-b border-[#d7dbdf] text-[10px] dark:border-border ${currentStart ? 'bg-primary/10 font-semibold text-primary' : ''}`
            return row.type === 'empty' && onSelectUnit ? <button key={unit} type="button" aria-label={`从 ${unit}U 新增或上架设备`} className={`${labelClass} hover:bg-primary/10 hover:text-primary`} style={{ height: UNIT_HEIGHT }} onClick={() => onSelectUnit(unit)}>{unit}</button> : <span key={unit} className={labelClass} style={{ height: UNIT_HEIGHT }} aria-hidden="true">{unit}</span>
          })}
        </div>
        {row.type === 'device' ? <button
          type="button"
          aria-label={`${deviceTitle(row.asset)}，${row.start} 至 ${row.top}U，占 ${row.height}U`}
          aria-pressed={isSelected}
          disabled={!interactive}
          onClick={() => onSelectDevice ? onSelectDevice(row.asset.id) : onOpenAsset?.(row.asset.id)}
          title={[deviceTitle(row.asset), row.asset.asset_code, deviceSubtitle(row.asset), `${row.start}–${row.top}U（${row.height}U）`].filter(Boolean).join(' · ')}
          className={`relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden border-b border-b-white/20 border-l-[3px] px-2 text-left text-[11px] leading-[13px] text-white transition-colors disabled:opacity-100 ${isSelected ? 'rack-device-selected border-l-transparent bg-[#176d29]' : 'border-l-transparent bg-[#1d8730] enabled:hover:bg-[#176d29]'} ${interactive ? '' : 'cursor-default'}`}
          data-asset-id={row.asset.id}
          data-selected={isSelected || undefined}
        ><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{row.height}U {deviceTitle(row.asset)}</span>{row.height > 1 ? <span className="block truncate text-[9px] leading-[10px] text-white/90">{row.asset.model || '未知型号'}</span> : null}</span><span className={`absolute right-1.5 top-[5px] h-1.5 w-1.5 rounded-full ${['在用', '正常', '运行中'].includes(row.asset.status) ? 'bg-[#9dcc75]' : 'bg-white/50'}`} title={row.asset.status || '未配置状态'} /></button>
          : onSelectUnit ? <button type="button" aria-label={`选择 ${row.unit}U 上架位置`} data-rack-unit={row.unit} onClick={() => onSelectUnit(row.unit)} style={{ borderBottomColor: 'hsl(var(--primary) / 0.75)' }} className="min-w-0 flex-1 border-b border-dashed bg-[#edf0f1] transition-colors hover:bg-primary/10 dark:bg-muted/20" /> : <div style={{ borderBottomColor: 'hsl(var(--primary) / 0.75)' }} className="min-w-0 flex-1 border-b border-dashed bg-[#edf0f1] dark:bg-muted/20" aria-hidden="true" />}
      </div>
    })}
  </div></div>
}

// 详情仅预览；完整机柜页负责编辑、冲突和未上架设备管理，共用同一真实 U 位图。
export default function RackView({ asset, cabinet: selectedCabinet, devices: providedDevices, selectedDeviceID, onSelectDevice, onSelectUnit, onOpenAsset, onOpenCabinet }) {
  const room = selectedCabinet?.room ?? String(asset?.data_center || '').trim()
  const name = selectedCabinet?.name ?? String(asset?.cabinet_name || '').trim()
  const key = rackKey({ data_center: room, cabinet_name: name })
  const locationName = rackLocationName(room, name)
  const provided = Array.isArray(providedDevices)
  const loader = useCallback(async () => {
    if (provided || !name) return null
    const [rows, locations] = await Promise.all([allPages(api.infrastructure, { scope: 'infrastructure' }), api.config('locations')])
    const location = (locations.list || []).find((item) => item.location_type !== 'room' && (item.location_type === 'cabinet'
      ? rackKey(item) === key
      : item.name === locationName)) || null
    return { key, devices: rows.filter((item) => supportsInfrastructurePhotos(item) && rackKey(item) === key), location }
  }, [provided, name, key, locationName])
  const query = useDirectory(loader)
  const loaded = query.data?.key === key ? query.data : null
  const devices = provided ? providedDevices : loaded?.devices
  const configuredUnits = provided
    ? selectedCabinet?.location?.rack_units ?? selectedCabinet?.rack_units ?? selectedCabinet?.totalUnits
    : loaded?.location?.rack_units
  const units = configuredUnits == null || configuredUnits === '' || Number(configuredUnits) === 0 ? DEFAULT_RACK_UNITS : Number(configuredUnits)
  const validUnits = Number.isInteger(units) && units >= 1 && units <= 60
  const layout = useMemo(() => devices && validUnits ? buildRackLayout(devices, units) : null, [devices, validUnits, units])
  const selfID = Number(asset?.id) || 0
  const currentID = selectedDeviceID ?? selfID
  const preview = !!asset

  if (!name) return <EmptyState label="未分配机柜，请编辑设备安装位置，或在完整机柜页分配机柜" />
  if (!provided && query.error) return <ErrorBanner message={query.error} onRetry={query.reload} />
  if (!devices) return <div className="p-3 text-xs text-muted-foreground">正在加载机柜…</div>
  if (!validUnits) return <ErrorBanner message="机柜高度配置无效，请在完整机柜页设置 1–60U 的机柜高度" />
  return <section className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${preview ? 'h-full' : 'max-[900px]:h-[480px] max-[900px]:flex-none'}`} data-section="device-rack">
    {preview ? <header className="mb-3 flex shrink-0 items-center justify-between gap-2 border-b border-border/60 pb-2">
      <div className="min-w-0"><h3 className="truncate text-sm font-semibold" title={`${room || UNKNOWN_ROOM} / ${name}`}>{room || UNKNOWN_ROOM} / {name}</h3><p className="mt-0.5 text-xs text-muted-foreground">{units}U · 已用 {layout.usedUnits}U</p></div>
      {onOpenCabinet ? <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={() => onOpenCabinet({ room, name, assetID: selfID })}>完整机柜<ArrowUpRight size={13} /></Button> : null}
    </header> : null}
    <RackDiagram layout={layout} cabinetKey={key} selectedDeviceID={currentID} onSelectDevice={onSelectDevice} onSelectUnit={onSelectUnit} onOpenAsset={onOpenAsset} preview={preview} />
  </section>
}
