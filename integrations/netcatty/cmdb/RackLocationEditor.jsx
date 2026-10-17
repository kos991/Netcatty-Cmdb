import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from './api'
import { directoryChanged } from './hooks'
import { EmptyState, Field, SelectControl } from './ui'
import { defaultRack, rackKey, rackLocationName, rackUnitsError, UNASSIGNED_CABINET } from './rackLayoutModel'

const initialValues = (cabinet) => ({ room: cabinet?.room || '', name: cabinet?.unassigned ? '' : cabinet?.name || '', units: cabinet?.unassigned ? 42 : cabinet?.totalUnits || 42 })
const sameValues = (left, right) => left.room === right.room && left.name === right.name && String(left.units) === String(right.units)

export default function RackLocationEditor({ cabinet, rooms, directoryRooms, cabinets, onSelectCabinet, onMigration, mutationBlocked, focusRequest, onDirtyChange, onBusyChange, onSaved }) {
  const [mode, setMode] = useState(cabinet && !cabinet.unassigned ? 'edit' : 'new')
  const [values, setValues] = useState(() => initialValues(cabinet))
  const [baseline, setBaseline] = useState(() => initialValues(cabinet))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const expectedSelection = useRef(null)
  const unitsRef = useRef(null)
  const panelRef = useRef(null)
  const dirty = !sameValues(values, baseline)
  const editing = mode === 'edit' && cabinet && !cabinet.unassigned
  const cabinetKey = cabinet?.key
  const currentDraft = useRef(null)
  currentDraft.current = { cabinet, dirty, busy, mode }
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  useEffect(() => {
    if (expectedSelection.current === cabinetKey) { expectedSelection.current = null; return }
    expectedSelection.current = null
    const selected = currentDraft.current.cabinet
    const next = initialValues(selected)
    setMode(selected && !selected.unassigned ? 'edit' : 'new')
    setValues(next); setBaseline(next); setError(''); setStatus('')
  }, [cabinetKey])
  useEffect(() => {
    const draft = currentDraft.current
    if (draft.dirty || draft.busy || draft.mode !== 'edit') return
    const next = initialValues(cabinet)
    setValues(next); setBaseline(next)
  }, [cabinet])
  const update = (key, value) => { setValues((current) => ({ ...current, [key]: value })); setStatus('') }
  const changeMode = (nextMode) => {
    if (busy || (dirty && !window.confirm('机房 / 机柜修改尚未保存，是否放弃修改？'))) return false
    const next = nextMode === 'edit' ? initialValues(cabinet) : { room: values.room || cabinet?.room || '', name: '', units: 42 }
    setMode(nextMode); setValues(next); setBaseline(next); setError(''); setStatus('')
    return true
  }
  const focusActions = useRef(null)
  focusActions.current = { cabinet, busy, mode, changeMode }
  useEffect(() => {
    const current = focusActions.current
    if (!focusRequest || !current.cabinet || current.cabinet.unassigned || current.busy) return
    if (current.mode !== 'edit' && !current.changeMode('edit')) return
    const frame = requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ block: 'nearest' })
      unitsRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest])
  const save = async (event) => {
    event.preventDefault()
    if (busy) return
    if (mutationBlocked) { setError('设备属性尚未保存，请先保存或重置设备修改；管理草稿已保留。'); return }
    const room = values.room.trim()
    const name = values.name.trim()
    if (!room && (!editing || cabinet.room)) { setError('请填写机房名称'); return }
    if (mode !== 'room' && !name) { setError('请填写机柜名称'); return }
    if (mode === 'room' && rooms.some((item) => item.key === room)) { setError('该机房已存在'); return }
    const key = rackKey({ data_center: room, cabinet_name: mode === 'room' ? '' : name })
    if (mode !== 'room' && cabinets.some((item) => item.key === key && item.key !== (editing ? cabinet.key : null))) { setError('目标机房中已存在同名机柜；不同机房可使用相同名称'); return }
    const units = Number(values.units)
    const validation = mode === 'room' ? '' : rackUnitsError(editing ? cabinet.devices : [], units)
    if (validation) { setError(validation); return }
    const body = mode === 'room'
      ? { name: room, location_type: 'room', data_center: room, cabinet_name: '', rack_units: 0 }
      : { name: rackLocationName(room, name), location_type: 'cabinet', data_center: room, cabinet_name: name, rack_units: units, remark: editing ? cabinet.location?.remark || '' : '', sort_order: editing ? cabinet.location?.sort_order || 0 : 0 }
    setBusy(true); setError(''); setStatus('')
    try {
      // 历史资产机柜先登记原身份，再由后端原子改名及迁移关联设备。
      let locationID = editing ? cabinet.location?.id : null
      if (editing && !locationID) {
        const registered = await api.createConfig('locations', { name: cabinet.locationName, location_type: 'cabinet', data_center: cabinet.room, cabinet_name: cabinet.name, rack_units: cabinet.totalUnits })
        locationID = registered.id
        if (!locationID) throw new Error('机柜登记未返回位置 ID，请刷新后重试')
      }
      const result = locationID ? await api.updateConfig('locations', locationID, body) : await api.createConfig('locations', body)
      if (!result.item) throw new Error('位置已保存，但返回配置缺失，请刷新目录')
      const savedRoom = result.item.data_center
      const savedName = mode === 'room' ? '' : result.item.cabinet_name
      const savedKey = rackKey({ data_center: savedRoom, cabinet_name: savedName })
      expectedSelection.current = savedKey === cabinetKey ? null : savedKey
      const next = { room: savedRoom, name: savedName, units: mode === 'room' ? 42 : result.item.rack_units }
      setMode(mode === 'room' ? 'new' : 'edit')
      setValues(next); setBaseline(next)
      setStatus(mode === 'room' ? `机房「${savedRoom}」已创建，可继续创建空机柜。` : `机柜「${savedName}」已保存 · ${result.item.rack_units}U`)
      onDirtyChange?.(false)
      await onSaved({ room: savedRoom, name: savedName, preserveDevice: !!editing })
      directoryChanged()
    } catch (saveError) { setError(saveError.message || '保存位置失败') }
    finally { setBusy(false) }
  }
  return <aside ref={panelRef} aria-label="机房与机柜管理" className="rack-management-panel" data-section="rack-location-editor">
    <header className="shrink-0 space-y-2 border-b border-border/60 p-3.5"><h2 className="text-sm font-semibold">机房与机柜管理</h2><div className="flex flex-wrap gap-1.5">
      <Button type="button" variant={mode === 'room' ? 'secondary' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => changeMode('room')}>新建机房</Button>
      <Button type="button" variant={mode === 'new' ? 'secondary' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => changeMode('new')}>新建空柜</Button>
      <Button type="button" variant={mode === 'edit' ? 'secondary' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" disabled={busy || !cabinet || cabinet.unassigned} onClick={() => changeMode('edit')}>编辑选中机柜</Button>
    </div></header>
    <nav aria-label="机房与机柜目录" className="rack-management-directory space-y-2 border-b border-border/60 bg-muted/10 p-3.5">
      {directoryRooms.map((room) => <section key={room.key}><button type="button" disabled={busy} className="mb-1 w-full truncate rounded px-2 py-1 text-left text-xs font-semibold hover:bg-secondary" title={room.name} onClick={() => onSelectCabinet(defaultRack(room.cabinets))}>{room.name}</button><div className="space-y-1">{room.cabinets.map((item) => <button type="button" key={item.key} disabled={busy} data-rack-cabinet={item.locationName || item.key} aria-current={item.key === cabinet?.key ? 'true' : undefined} className={`w-full rounded-md border px-2 py-1.5 text-left text-[11px] ${item.key === cabinet?.key ? 'border-primary/50 bg-primary/10 text-primary' : 'border-transparent hover:bg-secondary'}`} onClick={() => onSelectCabinet(item)}><span className="block truncate">{item.name || UNASSIGNED_CABINET}</span><span className="text-muted-foreground">{item.unassigned ? `${item.deviceCount} 台待分柜` : `${item.totalUnits}U · ${item.deviceCount} 台设备 · 已用 ${item.usedUnits}U`}</span></button>)}</div></section>)}
      {!directoryRooms.length ? <EmptyState label="没有匹配的机房或机柜" /> : null}
    </nav>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5 [scrollbar-width:thin]">
      <form onSubmit={save} className="space-y-3">
        <h3 className="text-xs font-semibold">{mode === 'room' ? '新建机房' : editing ? '编辑机柜' : '新建空机柜'}</h3>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        {status ? <p role="status" className="text-xs text-muted-foreground">{status}</p> : null}
        <fieldset disabled={busy} className="space-y-3">
          <Field label={mode === 'room' ? '机房名称' : '所属机房'} required={!!values.room || !editing}>
            {mode !== 'room' && rooms.some((item) => item.key) ? <SelectControl aria-label="选择已有机房" className="w-full" value={rooms.some((item) => item.key === values.room) ? values.room : ''} onChange={(value) => update('room', value)} options={[{ value: '', label: '选择机房或在下方填写' }, ...rooms.filter((item) => item.key).map((item) => ({ value: item.key, label: item.name }))]} /> : null}
            <Input aria-label="机房名称" className="h-8 text-xs" value={values.room} onChange={(event) => update('room', event.target.value)} />
          </Field>
          {mode !== 'room' ? <><Field label="机柜名称" required><Input aria-label="机柜名称" className="h-8 text-xs" value={values.name} onChange={(event) => update('name', event.target.value)} /></Field>
            <Field label="机柜总 U 数（1–60）" required><div className="flex items-center gap-3"><input aria-label="机柜高度滑块" type="range" min="1" max="60" step="1" value={Number(values.units) || 1} onChange={(event) => update('units', Number(event.target.value))} className="min-w-0 flex-1 accent-primary" /><Input ref={unitsRef} aria-label="机柜总 U 数" type="number" min="1" max="60" step="1" className="h-8 w-20 text-xs" value={values.units} onChange={(event) => update('units', event.target.value)} /></div></Field>
            <p className="text-[11px] text-muted-foreground">这是机柜总高度，不是设备占用 U 数。{editing ? '保存同步关联设备的机房 / 机柜名称，保留现有 U 位；缩柜不能挤出已上架设备。' : '空机柜独立保存，无需先录入设备。'}</p></> : <p className="text-[11px] text-muted-foreground">独立保存机房，创建后可连续添加空机柜。</p>}
        </fieldset>
        <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy || mutationBlocked || (editing && !dirty)}>{busy ? '保存中…' : mode === 'room' ? '创建机房' : editing ? '保存机柜' : '创建机柜'}</Button><Button type="button" variant="outline" size="sm" disabled={busy || !dirty} onClick={() => { setValues(baseline); setError('') }}>重置</Button></div>
      </form>
      <div className="mt-4 border-t border-border/60 pt-3"><Button type="button" data-rack-migration-preview variant="ghost" size="sm" className="h-7 px-0 text-[11px] text-muted-foreground" disabled={busy} onClick={onMigration}>旧位置迁移预览 / 安全回滚</Button><p className="mt-1 text-[11px] text-muted-foreground">目录中选择「未分配机柜」可批量分配设备。</p></div>
    </div>
  </aside>
}
