import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from './api'
import { allPages, directoryChanged } from './hooks'
import { requestJson } from './transport'
import { ErrorBanner, Field, SelectControl } from './ui'
import InfrastructureEditor from './InfrastructureEditor'
import { infrastructureSavePayload, saveInfrastructureDraftPhotos } from './infrastructureEditorModel'
import { buildNetcattyLinkPayload } from './NetcattyConnection'
import { useNetcattyConnectionEditor } from './NetcattyConnectionFields'
import { supportsInfrastructurePhotos } from './state'
import { rackCabinets, rackDeviceChanges, rackKey, rackPlacementError } from './rackLayoutModel'

export default function RackMountDialog({ cabinet, unit, devices, onClose, onSaved, onBusyChange }) {
  const [mode, setMode] = useState('choose')
  const [deviceID, setDeviceID] = useState('')
  const [record, setRecord] = useState(null)
  const [directory, setDirectory] = useState(null)
  const [photoDraft, setPhotoDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const createdID = useRef(0)
  const netcatty = useNetcattyConnectionEditor('infrastructure')
  const available = devices.filter((item) => supportsInfrastructurePhotos(item) && !Number(item.start_u))
  useEffect(() => { onBusyChange(busy || photoBusy); return () => onBusyChange(false) }, [busy, photoBusy, onBusyChange])
  const close = () => {
    if (busy || photoBusy) return
    if (mode === 'new' && !window.confirm(createdID.current ? '设备档案已创建，关闭将保留档案但放弃尚未完成的凭证 / 照片修改，是否继续？' : '新增设备尚未完成，是否关闭并放弃未保存内容？')) return
    if (createdID.current) directoryChanged()
    onClose()
  }
  const validatePlacement = async (next, id = 0) => {
    if (!supportsInfrastructurePhotos(next)) throw new Error('虚拟资源不能上架到实体机柜，请选择实体设备类型')
    if (rackKey(next) !== cabinet.key) throw new Error('请保留选中的机房与机柜；其他位置可在设备创建后编辑')
    const [rows, locations] = await Promise.all([allPages(api.infrastructure, { scope: 'infrastructure' }), api.config('locations')])
    const current = rackCabinets(rows.filter(supportsInfrastructurePhotos), locations.list || []).find((item) => item.key === cabinet.key)
    if (!current || current.unassigned) throw new Error('目标机柜已变更，请刷新目录后重新选择')
    if (Number(next.start_u) < 1) throw new Error('请填写有效起始 U 位，0 表示未上架')
    const validation = rackPlacementError(current.devices, id, Number(next.start_u), Number(next.height_u || 1), current.totalUnits)
    if (validation) throw new Error(validation)
  }
  const beginCreate = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const [meta, people, types, fields] = await Promise.all([requestJson('/api/cmdb/meta'), allPages(api.persons), api.taxonomy('infrastructure-categories'), api.customFields()])
      await netcatty.begin()
      setDirectory({ meta, people, deviceTypes: types.list || [], customFields: fields.list || [] })
      setRecord({ status: '在库', asset_class: 'physical', device_type: 'server', org_id: 0, category_id: 0, model_id: 0, owner_id: 0, interfaces: [], data_center: cabinet.room, cabinet_name: cabinet.name, start_u: unit, height_u: 1 })
      setMode('new')
    } catch (nextError) { setError(nextError.message || '读取设备目录失败') }
    finally { setBusy(false) }
  }
  const mountExisting = async () => {
    if (busy || !deviceID) return
    setBusy(true); setError('')
    try {
      const detail = await api.infrastructureAsset(deviceID)
      const asset = detail.asset
      if (!asset || Number(asset.start_u)) throw new Error('所选设备已上架或不存在，请刷新后重新选择')
      const next = { ...asset, data_center: cabinet.room, cabinet_name: cabinet.name, start_u: unit, height_u: Number(asset.height_u) || 1 }
      await validatePlacement(next, asset.id)
      await api.updateInfrastructure(asset.id, rackDeviceChanges(asset, next))
      directoryChanged()
      await onSaved(next)
      onClose()
    } catch (nextError) { setError(nextError.message || '设备上架失败') }
    finally { setBusy(false) }
  }
  const create = async (next) => {
    if (busy || photoBusy) return
    setBusy(true); setError('')
    try {
      if (netcatty.error) throw new Error(netcatty.error)
      buildNetcattyLinkPayload('infrastructure', createdID.current || 1, netcatty.connection, netcatty.hosts, netcatty.credentials)
      await validatePlacement(next, createdID.current)
      const payload = infrastructureSavePayload(next)
      if (createdID.current) await api.replaceInfrastructure(createdID.current, payload)
      else {
        const result = await api.createInfrastructure(payload)
        if (!result.id) throw new Error('设备保存未返回 ID，请刷新确认后重试')
        createdID.current = result.id
      }
      await netcatty.persist(createdID.current)
      await saveInfrastructureDraftPhotos(createdID.current, photoDraft, api.saveAssetImage)
      directoryChanged()
      await onSaved({ ...next, id: createdID.current })
      onClose()
    } catch (nextError) { setError(`${createdID.current ? '设备已创建，请在此重试完成凭证 / 照片保存：' : ''}${nextError.message || '新增设备失败'}`) }
    finally { setBusy(false) }
  }
  return <>
    <Dialog open={mode === 'choose'} onOpenChange={(open) => { if (!open) close() }}><DialogContent className="cmdb-record-shell cmdb-modal-form flex flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-lg" data-section="rack-mount-dialog">
      <DialogHeader className="cmdb-record-header pr-12"><DialogTitle className="text-sm">{cabinet.roomLabel} / {cabinet.name} · {unit}U 上架设备</DialogTitle></DialogHeader>
      <div className="cmdb-record-body space-y-3">
        <p className="text-xs text-muted-foreground">新增基础设施档案，或选择尚未上架的实体设备。保存前会重新检查机柜高度与 U 位冲突。</p>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="button" data-rack-create-device className="cmdb-primary-action w-full justify-start" disabled={busy} onClick={beginCreate}>新增基础设施并上架</Button>
        <Field label="选择已有未上架设备"><SelectControl searchable className="w-full" aria-label="选择已有设备上架" disabled={busy} value={deviceID} onChange={setDeviceID} options={[{ value: '', label: '选择已有设备' }, ...available.map((item) => ({ value: String(item.id), label: [item.name || `资产 #${item.id}`, item.asset_code, item.mgmt_ip].filter(Boolean).join(' · ') }))]} /></Field>
        {!available.length ? <p className="text-xs text-muted-foreground">没有尚未上架的实体设备，可直接新增基础设施。</p> : null}
      </div>
      <DialogFooter className="cmdb-record-footer"><Button type="button" variant="outline" disabled={busy} onClick={close}>取消</Button><Button type="button" className="cmdb-primary-action" data-rack-mount-existing disabled={busy || !deviceID} onClick={mountExisting}>{busy ? '处理中…' : `上架到 ${unit}U`}</Button></DialogFooter>
    </DialogContent></Dialog>
    {mode === 'new' ? <><InfrastructureEditor open record={record} directory={directory} busy={busy || netcatty.loading} onBusyChange={setPhotoBusy} onOpenChange={(open) => { if (!open) close() }} onSubmit={create} netcatty={netcatty} photoDraft={photoDraft} onPhotoDraftChange={setPhotoDraft} />{error ? <div role="alert" className="fixed bottom-5 left-1/2 z-[100] w-[min(90vw,680px)] -translate-x-1/2 rounded-md border border-destructive bg-background p-3 text-xs text-destructive">{error}</div> : null}</> : null}
  </>
}
