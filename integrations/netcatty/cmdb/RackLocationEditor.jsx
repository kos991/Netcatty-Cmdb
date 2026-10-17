import React, { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { api } from './api'
import { directoryChanged } from './hooks'
import { Field, ModalForm, SelectControl } from './ui'
import { rackKey, rackLocationName, rackUnitsError } from './rackLayoutModel'

export default function RackLocationEditor({ mode, cabinet, room = '', rooms, cabinets, onClose, onSaved, onDirtyChange, onBusyChange }) {
  const [values, setValues] = useState({ room, name: '', units: 42 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = mode === 'edit' || mode === 'capacity'
  const initial = { room: cabinet?.room ?? room, name: editing ? cabinet?.name || '' : '', units: cabinet?.totalUnits || 42 }
  const dirty = !!mode && (values.room !== initial.room || values.name !== initial.name || String(values.units) !== String(initial.units))
  useEffect(() => { onDirtyChange?.(dirty, busy) }, [dirty, busy, onDirtyChange])
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const close = () => { if (!busy && (!dirty || window.confirm('位置修改尚未保存，是否放弃修改？'))) onClose() }
  useEffect(() => {
    if (!mode) return
    setValues({ room: cabinet?.room ?? room, name: ['edit', 'capacity'].includes(mode) ? cabinet?.name || '' : '', units: cabinet?.totalUnits || 42 })
    setError('')
  }, [mode, cabinet, room])
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }))
  const save = async () => {
    if (busy) return
    const roomName = values.room.trim()
    const name = values.name.trim()
    if (!roomName && mode !== 'capacity') { setError('请填写机房名称'); return }
    if (mode !== 'room' && !name) { setError('请填写机柜名称'); return }
    if (mode === 'room' && rooms.some((item) => item.key === roomName)) { setError('该机房已存在'); return }
    const key = rackKey({ data_center: roomName, cabinet_name: name })
    if (mode !== 'room' && cabinets.some((item) => item.key === key && item.key !== (editing ? cabinet?.key : null))) { setError('目标机房中已存在同名机柜'); return }
    const units = Number(values.units)
    const validation = mode === 'room' ? '' : rackUnitsError(editing ? cabinet?.devices || [] : [], units)
    if (validation) { setError(validation); return }
    const body = mode === 'room'
      ? { name: roomName, location_type: 'room', data_center: roomName, cabinet_name: '', rack_units: 0 }
      : { name: rackLocationName(roomName, name), location_type: 'cabinet', data_center: roomName, cabinet_name: name, rack_units: units }
    setBusy(true); setError('')
    try {
      // 历史资产机柜没有目录时先登记原身份，再由后端原子改名/迁移关联设备。
      let locationID = editing ? cabinet?.location?.id : null
      if (editing && !locationID) {
        const registered = await api.createConfig('locations', { name: cabinet.locationName, location_type: 'cabinet', data_center: cabinet.room, cabinet_name: cabinet.name, rack_units: cabinet.totalUnits })
        locationID = registered.id
        if (!locationID) throw new Error('机柜登记未返回位置 ID，请刷新后重试')
      }
      const result = locationID ? await api.updateConfig('locations', locationID, body) : await api.createConfig('locations', body)
      if (!result.item) throw new Error('位置已保存，但返回配置缺失，请刷新目录')
      directoryChanged()
      onDirtyChange?.(false)
      onSaved({ room: result.item.data_center, name: mode === 'room' ? '' : result.item.cabinet_name })
      onClose()
    } catch (saveError) { setError(saveError.message || '保存位置失败') }
    finally { setBusy(false) }
  }
  return <ModalForm open={!!mode} onOpenChange={(open) => { if (!open) close() }} title={mode === 'room' ? '新建机房' : mode === 'capacity' ? '编辑机柜总 U 数' : editing ? '编辑机柜' : '新建机柜'} submitLabel={mode === 'room' ? '创建机房' : editing ? '保存修改' : '创建机柜'} onSubmit={save} busy={busy}>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <Field label={mode === 'room' ? '机房名称' : '所属机房'} required>
      {mode !== 'room' && mode !== 'capacity' && rooms.length ? <SelectControl aria-label="选择已有机房" value={rooms.some((item) => item.key === values.room) ? values.room : ''} onChange={(value) => update('room', value)} options={[{ value: '', label: '选择机房或在下方填写' }, ...rooms.filter((item) => item.key).map((item) => ({ value: item.key, label: item.name }))]} /> : null}
      <Input aria-label="机房名称" readOnly={mode === 'capacity'} className="h-9 text-xs" value={values.room} onChange={(event) => update('room', event.target.value)} />
    </Field>
    {mode !== 'room' ? <>
      <Field label="机柜名称" required><Input aria-label="机柜名称" readOnly={mode === 'capacity'} className="h-9 text-xs" value={values.name} onChange={(event) => update('name', event.target.value)} /></Field>
      <Field label="机柜总 U 数（1–60）" required><div className="flex items-center gap-3"><input aria-label="机柜高度滑块" type="range" min="1" max="60" step="1" value={Number.isInteger(Number(values.units)) && Number(values.units) >= 1 && Number(values.units) <= 60 ? values.units : initial.units} onChange={(event) => update('units', Number(event.target.value))} className="min-w-0 flex-1 accent-primary" /><Input aria-label="机柜总 U 数" type="number" min="1" max="60" step="1" required className="h-9 w-20 text-xs" value={values.units} onChange={(event) => update('units', event.target.value)} /></div></Field>
      {editing ? <p className="text-xs text-muted-foreground">{mode === 'capacity' ? '保存当前机柜的总 U 数，保留设备现有位置；缩小高度不能挤出已上架设备。' : '保存将同步该机柜的设备机房与机柜名称，保留现有 U 位。缩小高度不能挤出已有设备。'}</p> : null}
    </> : <p className="text-xs text-muted-foreground">机房将独立保存，无需先添加设备或机柜。</p>}
  </ModalForm>
}
