import React, { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Image, Network, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { api } from './api'
import { directoryChanged } from './hooks'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { syncFollowingNetcattyHosts } from './NetcattyConnection'
import { Field, SelectControl } from './ui'
import DeviceImages from './DeviceImages'
import VendorBrandInput from './VendorBrandInput'
import { deviceTypeLabel } from './deviceWorkspaceModel'
import { rackDeviceChanges, rackDeviceValues, rackKey, rackPlacementError } from './rackLayoutModel'

export default function RackDeviceEditor({ asset, cabinets, rooms, meta, deviceTypes, placementRequest, onDirtyChange, onBusyChange, onSaved, onOpenAsset }) {
  const { hosts, updateHostAddress } = useNetcattyDirectory()
  const [values, setValues] = useState(() => rackDeviceValues(asset))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const changes = useMemo(() => rackDeviceChanges(asset, values), [asset, values])
  const dirty = Object.keys(changes).length > 0
  useEffect(() => { onDirtyChange(dirty, busy || photoBusy) }, [dirty, busy, photoBusy, onDirtyChange])
  useEffect(() => { onBusyChange(busy || photoBusy); return () => onBusyChange(false) }, [busy, photoBusy, onBusyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => { if (!dirty) setValues(rackDeviceValues(asset)) }, [asset, dirty])
  useEffect(() => {
    if (!placementRequest || Number(placementRequest.deviceID) !== Number(asset.id)) return
    setValues((current) => ({ ...current, data_center: placementRequest.room, cabinet_name: placementRequest.name, start_u: placementRequest.unit }))
    setError('')
  }, [placementRequest, asset.id])
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }))
  const roomCabinets = cabinets.filter((item) => item.room === values.data_center && !item.unassigned)
  const target = cabinets.find((item) => item.key === rackKey(values) && !item.unassigned)
  const validation = !values.name.trim() ? '设备名称不能为空' : !target && Number(values.start_u) !== 0 ? '请先选择目标机柜再上架' : rackPlacementError(target?.devices || [], asset.id, Number(values.start_u), Number(values.height_u), target?.totalUnits || 42)
  const save = async (unplace = false) => {
    if (busy) return
    const next = { ...values, name: values.name.trim(), data_center: values.data_center.trim(), cabinet_name: values.cabinet_name.trim(), ...(unplace ? { start_u: 0 } : {}) }
    const placement = rackPlacementError(target?.devices || [], asset.id, Number(next.start_u), Number(next.height_u), target?.totalUnits || 42)
    if (!next.name || (!target && Number(next.start_u) !== 0) || placement) { setError(!next.name ? '设备名称不能为空' : placement || '请先选择目标机柜再上架'); return }
    const patch = rackDeviceChanges(asset, next)
    if (!Object.keys(patch).length) return
    setBusy(true); setError('')
    let assetSaved = false
    try {
      await api.updateInfrastructure(asset.id, patch)
      assetSaved = true
      setValues(rackDeviceValues({ ...asset, ...next }))
      onDirtyChange(false)
      if (Object.hasOwn(patch, 'mgmt_ip')) {
        try {
          await syncFollowingNetcattyHosts(api, { assetType: 'infrastructure', assetId: asset.id, hosts, updateHostAddress })
        } catch (syncError) {
          const message = `资产已保存，但 Netcatty 跟随地址同步失败：${syncError.message || '请在凭证中心重试同步地址'}`
          setError(message)
          toast.error(message)
        }
      }
      directoryChanged()
      await onSaved({ ...asset, ...next })
    } catch (saveError) { setError(assetSaved ? `资产已保存，但刷新机柜视图失败：${saveError.message || '请重新打开机柜'}` : saveError.message || '保存设备失败') }
    finally { setBusy(false) }
  }
  const optionsWithCurrent = (options, current) => [...new Set([...(options || []), current].filter(Boolean))]
  const currentTypeLabel = deviceTypeLabel({ device_type: values.device_type })
  const typeOptions = deviceTypes.filter((item) => item.name === values.device_type || item.name !== currentTypeLabel).map((item) => ({ value: item.name, label: item.name }))
  if (values.device_type && !typeOptions.some((item) => item.value === values.device_type)) typeOptions.push({ value: values.device_type, label: currentTypeLabel })
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-section="rack-device-editor">
    <header className="shrink-0 border-b border-border/60 px-5 pb-[13px] pt-4 max-[1100px]:p-3.5"><div className="flex min-w-0 items-center justify-between gap-2.5"><h2 className="min-w-0 truncate text-sm font-semibold" title={asset.name}>{asset.name || '设备属性'}</h2><Button type="button" variant="ghost" size="sm" className="h-[27px] shrink-0 gap-1 px-[7px] text-xs text-muted-foreground" disabled={busy || photoBusy} onClick={() => onOpenAsset?.(asset.id)}>设备详情<ChevronRight size={14} /></Button></div><p className="mt-[7px] text-[11px] text-muted-foreground">当前选中 · {Number(asset.start_u) > 0 ? `${asset.start_u}–${Number(asset.start_u) + Number(asset.height_u || 1) - 1}U · ${asset.height_u || 1}U` : '未上架'}</p></header>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:thin] max-[1100px]:p-3.5 [&_label]:text-[11px] [&_fieldset>div]:min-w-0 [&_fieldset>div>div]:h-[34px] [&_fieldset_input]:h-[34px] [&_fieldset_input]:text-xs [&_fieldset_button[role=combobox]]:h-[34px]">
      {error ? <p role="alert" className="mb-3 text-xs text-destructive">{error}</p> : null}
      <h3 className="mb-3 flex items-center gap-[7px] text-xs font-semibold"><Server size={14} className="text-muted-foreground" />设备属性</h3>
      <fieldset disabled={busy || photoBusy} className="grid min-w-0 grid-cols-2 gap-x-3.5 gap-y-[11px]">
        <Field label="设备名称" required className="col-span-2"><Input aria-label="设备名称" value={values.name} onChange={(event) => update('name', event.target.value)} /></Field>
        <Field label="资产编号"><Input aria-label="资产编号" value={values.asset_code} onChange={(event) => update('asset_code', event.target.value)} /></Field>
        <Field label="设备类型"><SelectControl aria-label="设备类型" searchable className="w-full" value={values.device_type} options={[{ value: '', label: '未配置' }, ...typeOptions]} onChange={(value) => setValues((current) => ({ ...current, device_type: value, category_id: value === current.device_type ? current.category_id : deviceTypes.find((item) => item.name === value)?.id || 0 }))} /></Field>
        <Field label="品牌 / 厂商"><VendorBrandInput value={values.vendor} onChange={(value) => update('vendor', value)} /></Field>
        <Field label="型号"><Input aria-label="型号" value={values.model} onChange={(event) => update('model', event.target.value)} /></Field>
      </fieldset>
      <h3 className="mb-3 mt-4 flex items-center gap-[7px] border-t border-border/60 pt-4 text-xs font-semibold"><Network size={14} className="text-muted-foreground" />机柜位置</h3>
      <fieldset disabled={busy || photoBusy} className="grid min-w-0 grid-cols-2 gap-x-3.5 gap-y-[11px]">
        <Field label="所属机房"><SelectControl aria-label="设备所属机房" searchable className="w-full" value={values.data_center} options={[{ value: '', label: '未登记机房' }, ...optionsWithCurrent(rooms.map((item) => item.key), values.data_center)]} onChange={(value) => setValues((current) => ({ ...current, data_center: value, cabinet_name: '', start_u: 0 }))} /></Field>
        <Field label="机柜"><SelectControl aria-label="设备机柜" searchable className="w-full" value={values.cabinet_name} options={[{ value: '', label: '未分配机柜' }, ...optionsWithCurrent(roomCabinets.map((item) => item.name), values.cabinet_name)]} onChange={(value) => setValues((current) => ({ ...current, cabinet_name: value, start_u: 0 }))} /></Field>
        <Field label="起始 U 位"><Input aria-label="起始 U 位" title="0 = 未上架" type="number" min="0" max={target?.totalUnits || 60} step="1" value={values.start_u} onChange={(event) => update('start_u', event.target.value)} /></Field>
        <Field label="占用 U 数"><Input aria-label="占用 U 数" type="number" min="1" max="60" step="1" value={values.height_u} onChange={(event) => update('height_u', event.target.value)} /></Field>
      </fieldset>
      {validation ? <p role="alert" className="mt-2.5 text-xs text-destructive">{validation}</p> : target ? <div className="mt-2.5 flex flex-wrap justify-between gap-2 text-[11px]"><span className="text-muted-foreground">{Number(values.start_u) ? `范围 ${values.start_u}–${Number(values.start_u) + Number(values.height_u) - 1}U` : '未上架'} / 共 {target.totalUnits}U</span><span className="text-emerald-600 dark:text-emerald-400">{Number(values.start_u) ? '● 位置可用' : '选择空闲 U 位上架'}</span></div> : null}
      <h3 className="mb-3 mt-4 flex items-center gap-[7px] border-t border-border/60 pt-4 text-xs font-semibold"><Image size={14} className="text-muted-foreground" />设备照片</h3>
      <div className="min-w-0 [&>div>div.grid]:grid-cols-1 [&>div>div.grid]:gap-2.5 [&>div>div.grid>div]:relative [&>div>div.grid>div]:space-y-0 [&>div>div.grid>div>div]:absolute [&>div>div.grid>div>div]:inset-x-2 [&>div>div.grid>div>div]:top-1 [&>div>div.grid>div>div]:z-10 [&>div>div.grid>div>div>span]:text-[10px] [&>div>div.grid>div>div>span]:font-normal [&>div>div.grid>div>div>span]:text-muted-foreground [&>div>div.grid>div>button]:aspect-[5/1] [&>div>div.grid>div>button]:h-auto [&>div>div.grid>div>button]:min-h-[68px]">
        <DeviceImages kind="infrastructure" id={asset.id} onBusyChange={setPhotoBusy} />
      </div>
      <fieldset disabled={busy || photoBusy} className="mt-4 grid min-w-0 grid-cols-2 gap-x-3.5 gap-y-[11px] border-t border-border/60 pt-4">
        <Field label="管理 IP"><Input aria-label="管理 IP" className="font-mono" value={values.mgmt_ip} onChange={(event) => update('mgmt_ip', event.target.value)} /></Field>
        <Field label="状态"><SelectControl aria-label="设备状态" className="w-full" value={values.status} onChange={(value) => update('status', value)} options={[{ value: '', label: '未配置' }, ...optionsWithCurrent(meta.statuses, values.status)]} /></Field>
      </fieldset>
    </div>
    <footer className="sticky bottom-0 flex shrink-0 items-center justify-end gap-2 border-t border-border/60 bg-background px-5 py-[11px] max-[1100px]:px-3.5 max-[1100px]:py-2.5 [&_button]:h-[34px] [&_button]:text-xs"><Button type="button" variant="ghost" size="sm" className="mr-auto text-destructive hover:text-destructive" disabled={busy || photoBusy || (!Number(asset.start_u) && !Number(values.start_u))} onClick={() => save(true)}>下架设备</Button><Button type="button" variant="outline" size="sm" disabled={busy || photoBusy || !dirty} onClick={() => { setValues(rackDeviceValues(asset)); setError('') }}>重置</Button><Button type="button" size="sm" className="min-w-[100px]" disabled={busy || photoBusy || !dirty || !!validation} onClick={() => save()}>{busy ? '保存中…' : '保存设备'}</Button></footer>
  </section>
}
