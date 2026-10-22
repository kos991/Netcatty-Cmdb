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

export default function RackDeviceEditor({ asset, cabinets, rooms, meta, deviceTypes, externalBusy = false, managementDirty = false, onDirtyChange, onBusyChange, onSaved, onOpenAsset }) {
  const { hosts, updateHostAddress } = useNetcattyDirectory()
  const [values, setValues] = useState(() => rackDeviceValues(asset))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const locked = busy || photoBusy || externalBusy
  const changes = useMemo(() => rackDeviceChanges(asset, values), [asset, values])
  const dirty = Object.keys(changes).length > 0
  useEffect(() => { onDirtyChange(dirty, busy || photoBusy) }, [dirty, busy, photoBusy, onDirtyChange])
  useEffect(() => { onBusyChange(busy || photoBusy); return () => onBusyChange(false) }, [busy, photoBusy, onBusyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => { if (!dirty) setValues(rackDeviceValues(asset)) }, [asset, dirty])
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }))
  const roomCabinets = cabinets.filter((item) => item.room === values.data_center && !item.unassigned)
  const target = cabinets.find((item) => item.key === rackKey(values) && !item.unassigned)
  const validation = !values.name.trim() ? '设备名称不能为空' : !target && Number(values.start_u) !== 0 ? '请先选择目标机柜再上架' : rackPlacementError(target?.devices || [], asset.id, Number(values.start_u), Number(values.height_u), target?.totalUnits || 42)
  const save = async (unplace = false) => {
    if (locked) return
    const next = { ...values, name: values.name.trim(), data_center: values.data_center.trim(), cabinet_name: values.cabinet_name.trim(), ...(unplace ? { start_u: 0 } : {}) }
    if (managementDirty && rackKey(next) !== rackKey(asset)) { setError('请先保存或重置右侧管理草稿，再将设备移到其他机柜；当前草稿已保留。'); return }
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
  return <section className="cmdb-record-shell rack-device-editor flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-section="rack-device-editor">
    <header className="cmdb-record-header shrink-0"><div className="flex min-w-0 items-center justify-between gap-2.5"><h2 className="min-w-0 break-words text-sm font-semibold" title={asset.name}>{asset.name || '设备属性'}</h2><Button type="button" variant="ghost" size="sm" className="h-[34px] shrink-0 gap-1 px-2 text-[13px] text-muted-foreground" disabled={locked} onClick={() => onOpenAsset?.(asset.id)}>设备详情<ChevronRight size={14} /></Button></div><p className="mt-1 text-[11px] text-muted-foreground">当前选中 · {Number(asset.start_u) > 0 ? `${asset.start_u}–${Number(asset.start_u) + Number(asset.height_u || 1) - 1}U · ${asset.height_u || 1}U` : '未上架'}</p></header>
    <div className="cmdb-record-body min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto">
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <section className="cmdb-record-section">
        <h3 className="flex items-center gap-[7px]"><Server size={14} className="text-muted-foreground" />设备属性</h3>
        <fieldset disabled={locked} className="cmdb-record-fields">
          <Field label="设备名称" required className="col-span-2"><Input aria-label="设备名称" value={values.name} onChange={(event) => update('name', event.target.value)} /></Field>
          <Field label="资产编号"><Input aria-label="资产编号" value={values.asset_code} onChange={(event) => update('asset_code', event.target.value)} /></Field>
          <Field label="设备类型"><SelectControl aria-label="设备类型" searchable className="w-full" value={values.device_type} options={[{ value: '', label: '未配置' }, ...typeOptions]} onChange={(value) => setValues((current) => ({ ...current, device_type: value, category_id: value === current.device_type ? current.category_id : deviceTypes.find((item) => item.name === value)?.id || 0 }))} /></Field>
          <Field label="品牌 / 厂商"><VendorBrandInput value={values.vendor} onChange={(value) => update('vendor', value)} /></Field>
          <Field label="型号"><Input aria-label="型号" value={values.model} onChange={(event) => update('model', event.target.value)} /></Field>
        </fieldset>
      </section>
      <section className="cmdb-record-section">
        <h3 className="flex items-center gap-[7px]"><Network size={14} className="text-muted-foreground" />机柜位置</h3>
        <fieldset disabled={locked} className="cmdb-record-fields">
          <Field label="所属机房" className="col-span-2"><SelectControl aria-label="设备所属机房" searchable className="w-full" value={values.data_center} options={[{ value: '', label: '未登记机房' }, ...optionsWithCurrent(rooms.map((item) => item.key), values.data_center)]} onChange={(value) => setValues((current) => ({ ...current, data_center: value, cabinet_name: '', start_u: 0 }))} /></Field>
          <Field label="机柜" className="col-span-2"><SelectControl aria-label="设备机柜" searchable className="w-full" value={values.cabinet_name} options={[{ value: '', label: '未分配机柜' }, ...optionsWithCurrent(roomCabinets.map((item) => item.name), values.cabinet_name)]} onChange={(value) => setValues((current) => ({ ...current, cabinet_name: value, start_u: 0 }))} /></Field>
          <Field label="起始 U 位"><Input aria-label="起始 U 位" title="0 = 未上架" type="number" min="0" max={target?.totalUnits || 60} step="1" value={values.start_u} onChange={(event) => update('start_u', event.target.value)} /></Field>
          <Field label="占用 U 数"><Input aria-label="占用 U 数" type="number" min="1" max="60" step="1" value={values.height_u} onChange={(event) => update('height_u', event.target.value)} /></Field>
        </fieldset>
        {validation ? <p role="alert" className="mt-3 text-xs text-destructive">{validation}</p> : target ? <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px]"><span className="text-muted-foreground">{Number(values.start_u) ? `范围 ${values.start_u}–${Number(values.start_u) + Number(values.height_u) - 1}U` : '未上架'} / 共 {target.totalUnits}U</span><span className="text-emerald-600 dark:text-emerald-400">{Number(values.start_u) ? '● 位置可用' : '选择空闲 U 位上架'}</span></div> : null}
      </section>
      <section className="cmdb-record-section">
        <h3 className="flex items-center gap-[7px]"><Image size={14} className="text-muted-foreground" />设备照片</h3>
        <fieldset disabled={locked} className="min-w-0">
          <DeviceImages kind="infrastructure" id={asset.id} mainOnly onBusyChange={setPhotoBusy} />
        </fieldset>
      </section>
      <section className="cmdb-record-section">
        <h3 className="flex items-center gap-[7px]"><Server size={14} className="text-muted-foreground" />管理信息</h3>
        <fieldset disabled={locked} className="cmdb-record-fields">
          <Field label="管理 IP"><Input aria-label="管理 IP" className="font-mono" value={values.mgmt_ip} onChange={(event) => update('mgmt_ip', event.target.value)} /></Field>
          <Field label="状态"><SelectControl aria-label="设备状态" className="w-full" value={values.status} onChange={(value) => update('status', value)} options={[{ value: '', label: '未配置' }, ...optionsWithCurrent(meta.statuses, values.status)]} /></Field>
        </fieldset>
      </section>
    </div>
    <footer className="cmdb-record-footer"><Button type="button" variant="ghost" size="sm" className="mr-auto text-destructive hover:text-destructive" disabled={locked || (!Number(asset.start_u) && !Number(values.start_u))} onClick={() => save(true)}>下架设备</Button><Button type="button" variant="outline" size="sm" disabled={locked || !dirty} onClick={() => { setValues(rackDeviceValues(asset)); setError('') }}>重置</Button><Button type="button" size="sm" className="cmdb-primary-action" disabled={locked || !dirty || !!validation} onClick={() => save()}>{busy ? '保存中…' : '保存设备'}</Button></footer>
  </section>
}
