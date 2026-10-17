import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { VaultHeaderSearch, VaultPageHeader } from '@/components/vault/VaultPageHeader'
import { api } from './api'
import { allPages, directoryChanged, useDirectory } from './hooks'
import { EmptyState, ErrorBanner, SelectControl } from './ui'
import RackView from './RackView'
import RackDeviceEditor from './RackDeviceEditor'
import RackLocationEditor from './RackLocationEditor'
import { requestJson } from './transport'
import { supportsInfrastructurePhotos } from './state'
import { buildRackLayout, defaultRack, rackAssignmentChanges, rackCabinets, rackKey, rackRooms, UNASSIGNED_CABINET } from './rackLayoutModel'

const loadOverview = async () => {
  const [devices, locations, meta, types, project] = await Promise.all([
    allPages(api.infrastructure, { scope: 'infrastructure' }), api.config('locations'),
    requestJson('/api/cmdb/meta'), api.taxonomy('infrastructure-categories'), api.currentProject(),
  ])
  return { cabinets: rackCabinets(devices.filter(supportsInfrastructurePhotos), locations.list || []), meta, deviceTypes: types.list || [], projectKey: project.sync_id || project.id }
}
const locationText = (value = {}) => `机房：${value.data_center || '未登记'}；机柜：${value.cabinet_name || '未分配'}；旧位置：${value.cabinet_pos || '无'}`

function MigrationDialog({ open, onOpenChange, preview, loading, error, result, busy, onApply, onRollback }) {
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value) }}><DialogContent className="flex max-h-[84vh] max-w-[calc(100vw-2rem)] flex-col sm:max-w-3xl" data-section="rack-migration-dialog">
    <DialogHeader><DialogTitle>旧安装位置一次性拆分</DialogTitle></DialogHeader>
    <p className="text-xs text-muted-foreground">仅拆分可确认的历史位置，保留已填写机房；先核对前后变化，再确认迁移。迁移前备份数据库；回滚遇到后续修改会拒绝覆盖。</p>
    {loading ? <p className="text-xs text-muted-foreground">正在获取最新预览…</p> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {result ? <div role="status" className="rounded-md border border-border bg-muted/20 p-2 text-xs"><p>{result.message}</p>{result.backup_path ? <p className="mt-1 break-all font-mono text-[11px]">备份：{result.backup_path}</p> : null}</div> : null}
    <div className="min-h-0 space-y-3 overflow-y-auto">
      <p className="text-xs font-medium">可迁移 {preview?.total || 0} 条 · 需人工确认 {preview?.conflicts?.length || 0} 条</p>
      {preview?.list?.length ? <table className="w-full table-fixed text-[11px]"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="w-24 py-1 font-normal">设备</th><th className="font-normal">迁移前</th><th className="font-normal">迁移后</th></tr></thead><tbody>{preview.list.map((item) => <tr key={item.id} className="border-b border-border/50 align-top"><td className="break-words py-2 pr-2">{item.name || `#${item.id}`}</td><td className="break-words py-2 pr-2">{locationText(item.before)}</td><td className="break-words py-2">{locationText(item.after)}</td></tr>)}</tbody></table> : null}
      {preview?.locations?.length ? <section><h4 className="mb-1 text-xs font-medium">机柜高度目录同步（{preview.locations.length}）</h4><table className="w-full table-fixed text-[11px]"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 font-normal">迁移前</th><th className="font-normal">迁移后</th></tr></thead><tbody>{preview.locations.map((item) => <tr key={item.id} className="border-b border-border/50 align-top"><td className="break-words py-2 pr-2">{item.before.name} · {item.before.rack_units}U</td><td className="break-words py-2">{item.after.name} · {item.after.rack_units}U</td></tr>)}</tbody></table></section> : null}
      {preview?.conflicts?.length ? <section><h4 className="text-xs font-medium text-destructive">以下记录不自动迁移</h4>{preview.conflicts.map((item, index) => <div key={item.id || index} className="border-b border-border/50 py-2 text-[11px]"><strong>{item.name || `#${item.id || index + 1}`}</strong><p className="break-words text-muted-foreground">{item.reason || item.message || '位置含义不明确，请在资产编辑中分别填写机房和机柜'}</p>{item.before ? <p className="break-words">{locationText(item.before)}</p> : null}</div>)}</section> : null}
    </div>
    <DialogFooter className="flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || loading || !preview?.rollback_available} onClick={onRollback}>{busy === 'rollback' ? '回滚中…' : '安全回滚上次迁移'}</Button><Button type="button" variant="outline" disabled={!!busy} onClick={() => onOpenChange(false)}>关闭</Button><Button type="button" disabled={!!busy || loading || !preview?.total || !preview?.token || !!preview?.conflicts?.length} onClick={onApply}>{busy === 'apply' ? '迁移中…' : `确认迁移 ${preview?.total || 0} 条`}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function RoomDevices({ bucket, cabinets, onOpenAsset, onChanged, onBeforeChange }) {
  const [selected, setSelected] = useState([])
  const [cabinet, setCabinet] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const existing = cabinets.filter((item) => item.room === bucket.room && !item.unassigned)
  const toggle = (id, checked) => setSelected((ids) => checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id))
  const assign = async () => {
    if (!selected.length || !cabinet.trim() || busy) return
    if (onBeforeChange && !onBeforeChange()) return
    setBusy(true); setError('')
    try {
      await api.batchInfrastructure(selected, 'edit', rackAssignmentChanges(bucket.room, cabinet))
      setSelected([])
      directoryChanged()
      onChanged()
    } catch (saveError) { setError(saveError.message || '批量分配机柜失败') }
    finally { setBusy(false) }
  }
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-section="rack-room-devices">
    <header className="shrink-0 border-b border-border/60 pb-2"><h3 className="truncate text-sm font-semibold" title={bucket.roomLabel}>{bucket.roomLabel} / {UNASSIGNED_CABINET}</h3><p className="text-[11px] text-muted-foreground">{bucket.deviceCount} 台设备仅登记机房或尚未登记位置；分配机柜后仍需上架。</p></header>
    <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border p-2">
      <span className="text-[11px] text-muted-foreground">已选 {selected.length} 台</span>
      {existing.length ? <SelectControl aria-label="选择本机房机柜" className="min-w-0 max-w-full" value={existing.some((item) => item.name === cabinet) ? cabinet : ''} onChange={setCabinet} options={[{ value: '', label: '选择本机房已有机柜' }, ...existing.map((item) => ({ value: item.name, label: item.name }))]} /> : null}
      <Input aria-label="目标机柜名称" value={cabinet} onChange={(event) => setCabinet(event.target.value)} placeholder="机柜名称（可新建，勿填写机房）" className="h-8 min-w-0 flex-1 basis-44 text-xs" />
      <Button size="sm" className="h-8" disabled={busy || !selected.length || !cabinet.trim()} onClick={assign}>{busy ? '分配中…' : '批量分配机柜'}</Button>
      <p className="w-full text-[11px] text-muted-foreground">仅分配到当前机房；U 位统一重置为 0，避免沿用旧位置。机房未登记的设备保持未登记。</p>
    </div>
    {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
    <div className="mt-3 min-h-0 overflow-y-auto"><table className="w-full table-fixed text-xs"><thead className="sticky top-0 bg-background text-muted-foreground"><tr className="border-b border-border"><th className="w-8 py-2 text-left"><input type="checkbox" aria-label="全选未分配设备" disabled={busy} checked={selected.length === bucket.devices.length && !!selected.length} onChange={(event) => setSelected(event.target.checked ? bucket.devices.map((item) => item.id) : [])} /></th><th className="text-left font-normal">设备 / 资产编号</th><th className="w-[38%] text-left font-normal">管理 IP</th></tr></thead><tbody>{bucket.devices.map((item) => <tr key={item.id} className="border-b border-border/50"><td className="py-2"><input type="checkbox" aria-label={`选择 ${item.name || item.asset_code || item.id}`} disabled={busy} checked={selected.includes(item.id)} onChange={(event) => toggle(item.id, event.target.checked)} /></td><td className="min-w-0 py-2 pr-2"><button type="button" className="block w-full truncate text-left font-medium hover:text-primary" onClick={() => onOpenAsset?.(item.id)} title={item.name || item.asset_code}>{item.name || item.asset_code || `#${item.id}`}</button><span className="block truncate font-mono text-[10px] text-muted-foreground" title={item.asset_code}>{item.asset_code || '无资产编号'}</span></td><td className="truncate font-mono text-[11px]" title={item.mgmt_ip || item.manage_ip}>{item.mgmt_ip || item.manage_ip || '未配置'}</td></tr>)}</tbody></table></div>
  </section>
}

export default function RackOverview({ keyword = '', onKeywordChange, onAddressView, onOpenAsset, focusTarget, onDirtyChange }) {
  const query = useDirectory(loadOverview)
  const [selection, setSelection] = useState({ key: '', deviceID: 0 })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorRevision, setEditorRevision] = useState(0)
  const [placementRequest, setPlacementRequest] = useState(null)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [locationMode, setLocationMode] = useState('')
  const [locationMenuOpen, setLocationMenuOpen] = useState(false)
  const [locationDirty, setLocationDirty] = useState(false)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [migrationPreview, setMigrationPreview] = useState(null)
  const [migrationLoading, setMigrationLoading] = useState(false)
  const [migrationBusy, setMigrationBusy] = useState('')
  const [migrationError, setMigrationError] = useState('')
  const [migrationResult, setMigrationResult] = useState(null)
  const restoredProject = useRef(null)
  const handledFocus = useRef(null)
  const pendingSelection = useRef(null)
  const handledKeyword = useRef('')
  const cabinets = useMemo(() => query.data?.cabinets || [], [query.data])
  const rooms = useMemo(() => rackRooms(cabinets), [cabinets])
  const directoryRooms = useMemo(() => rackRooms(cabinets, keyword), [cabinets, keyword])
  const current = cabinets.find((item) => item.key === selection.key)
  const asset = current?.devices.find((item) => Number(item.id) === Number(selection.deviceID))
  const roomCabinets = cabinets.filter((item) => item.room === current?.room)
  const layout = useMemo(() => buildRackLayout(current?.devices || [], current?.totalUnits || 42), [current])
  const changeDirty = useCallback((value) => setDirty(value), [])
  useEffect(() => { onDirtyChange?.(dirty || locationDirty, saving || !!migrationBusy) }, [dirty, locationDirty, saving, migrationBusy, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false, false), [onDirtyChange])
  const mayLeave = useCallback(() => {
    if (saving) return false
    if (dirty || locationDirty) {
      if (!window.confirm('设备修改尚未保存，是否放弃修改并继续？')) return false
      changeDirty(false)
      setEditorRevision((value) => value + 1)
      setLocationDirty(false)
      setLocationMode('')
    }
    setPlacementRequest(null)
    return true
  }, [saving, dirty, locationDirty, changeDirty])
  const selectCabinet = (item, deviceID) => {
    if (!item || !mayLeave()) return
    setSelection({ key: item.key, deviceID: deviceID ?? item.devices[0]?.id ?? 0 })
    setDirectoryOpen(false)
  }
  const selectDevice = (id) => {
    if (Number(id) === Number(selection.deviceID) || !mayLeave()) return
    setSelection((value) => ({ ...value, deviceID: id }))
  }
  useEffect(() => {
    if (!query.data) return
    if (pendingSelection.current) {
      if (!cabinets.some((item) => item.key === pendingSelection.current.key)) return
      setSelection(pendingSelection.current)
      pendingSelection.current = null
      return
    }
    const projectKey = query.data.projectKey
    if (restoredProject.current !== projectKey) {
      restoredProject.current = projectKey
      let remembered
      try { remembered = JSON.parse(globalThis.localStorage?.getItem(`netcatty.cmdb.rack.selection.v1.${projectKey}`) || 'null') }
      catch (error) { console.warn('读取机柜选择失败', error) }
      const initial = cabinets.find((item) => item.key === remembered?.key) || defaultRack(cabinets)
      setSelection({ key: initial?.key || '', deviceID: initial?.devices.some((item) => Number(item.id) === Number(remembered?.deviceID)) ? remembered.deviceID : initial?.devices[0]?.id || 0 })
    } else if (!current && cabinets.length) {
      const initial = defaultRack(cabinets)
      setSelection({ key: initial.key, deviceID: initial.devices[0]?.id || 0 })
    } else if (current && !asset && !dirty && Number(selection.deviceID) !== Number(current.devices[0]?.id || 0)) {
      setSelection((value) => ({ ...value, deviceID: current.devices[0]?.id || 0 }))
    }
  }, [query.data, cabinets, current, asset, dirty, selection.deviceID])
  useEffect(() => {
    if (!current || !query.data?.projectKey) return
    try { globalThis.localStorage?.setItem(`netcatty.cmdb.rack.selection.v1.${query.data.projectKey}`, JSON.stringify(selection)) }
    catch (error) { console.warn('保存机柜选择失败', error) }
  }, [selection, current, query.data?.projectKey])
  useEffect(() => {
    if (!focusTarget || !query.data || handledFocus.current === focusTarget) return
    handledFocus.current = focusTarget
    handledKeyword.current = keyword
    const key = rackKey({ data_center: focusTarget.room, cabinet_name: focusTarget.name })
    const target = cabinets.find((item) => item.key === key)
    if (target && mayLeave()) setSelection({ key: target.key, deviceID: focusTarget.assetID || target.devices[0]?.id || 0 })
  }, [focusTarget, query.data, cabinets, keyword, mayLeave])
  useEffect(() => {
    if (!query.data || handledKeyword.current === keyword) return
    handledKeyword.current = keyword
    if (!keyword.trim()) return
    const matches = directoryRooms.flatMap((room) => room.cabinets)
    if (!matches.some((item) => item.key === selection.key)) {
      const target = defaultRack(matches)
      if (target && mayLeave()) setSelection({ key: target.key, deviceID: target.devices[0]?.id || 0 })
    }
  }, [keyword, query.data, directoryRooms, selection.key, mayLeave])
  const openLocation = (mode) => { if (mayLeave()) setLocationMode(mode) }
  const afterSaved = async (saved) => {
    changeDirty(false)
    setPlacementRequest(null)
    pendingSelection.current = { key: rackKey(saved), deviceID: saved.id }
    await query.reload()
  }
  const openMigration = async () => {
    if (!mayLeave()) return
    setMigrationOpen(true); setMigrationLoading(true); setMigrationError(''); setMigrationResult(null); setMigrationPreview(null)
    try { setMigrationPreview(await api.rackMigrationPreview()) }
    catch (error) { setMigrationError(error.message) }
    finally { setMigrationLoading(false) }
  }
  const mutateMigration = async (action) => {
    if (migrationBusy) return
    setMigrationBusy(action); setMigrationError('')
    try {
      const result = action === 'apply' ? await api.migrateRackLocations(migrationPreview.token) : await api.rollbackRackMigration()
      setMigrationResult({ message: `${action === 'apply' ? '迁移' : '回滚'}完成，共 ${result.updated} 条`, backup_path: result.backup_path })
      setMigrationPreview(await api.rackMigrationPreview())
      directoryChanged()
      await query.reload()
    } catch (error) { setMigrationError(error.message) }
    finally { setMigrationBusy('') }
  }
  if (query.error) return <ErrorBanner message={query.error} onRetry={query.reload} />
  if (!query.data) return <p className="p-4 text-xs text-muted-foreground">正在汇总机房与机柜…</p>
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card" data-section="rack-overview">
    <VaultPageHeader dataSection="cmdb-rack-header" contentClassName="h-auto min-h-[54px] min-w-0 flex-wrap gap-2.5 px-3.5 py-[9px] min-[1100px]:flex-nowrap">
      <Dropdown open={locationMenuOpen} onOpenChange={setLocationMenuOpen}><DropdownTrigger asChild><Button type="button" variant="secondary" className="h-[34px] shrink-0 gap-1.5 rounded-[7px] border border-border bg-muted px-2.5 text-xs font-medium text-foreground"><Plus size={15} />新增机柜<ChevronDown size={14} /></Button></DropdownTrigger><DropdownContent align="start" className="w-44 p-1">{[['new', '新建机柜'], ['room', '新建机房']].map(([mode, label]) => <button type="button" key={mode} className="flex h-9 w-full items-center rounded px-2 text-xs hover:bg-secondary" onClick={() => { setLocationMenuOpen(false); openLocation(mode) }}>{label}</button>)}</DropdownContent></Dropdown>
      <div className="flex h-[34px] shrink-0 items-center rounded-md border border-border bg-muted/30 p-0.5" aria-label="机柜与网络视图"><Button type="button" variant="secondary" size="sm" className="h-7 px-3 text-xs" aria-pressed>设备机柜</Button><Button type="button" variant="ghost" size="sm" className="h-7 px-3 text-xs" aria-pressed={false} onClick={onAddressView}>地址池</Button></div>
      <div className="relative w-[115px] min-w-0 shrink-0 [&>div]:h-[34px] [&>div>svg]:pr-2 [&_button]:hidden [&_input]:pl-[39px] [&_input]:pr-0"><span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-xs text-muted-foreground">机房</span><SelectControl aria-label="当前机房" searchable value={current?.room || ''} onChange={(room) => selectCabinet(defaultRack(cabinets.filter((item) => item.room === room)))} options={rooms.map((item) => ({ value: item.key, label: item.name }))} className="w-[220px]" /></div>
      <div className="relative w-[90px] min-w-0 shrink-0"><span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-xs text-muted-foreground">机柜</span><SelectControl aria-label="当前机柜" value={current?.key || ''} onChange={(key) => { if (key === '__all_cabinets__') { if (mayLeave()) setDirectoryOpen(true) } else if (key === '__edit_cabinet__') openLocation('edit'); else selectCabinet(cabinets.find((item) => item.key === key)) }} options={[...roomCabinets.map((item) => ({ value: item.key, label: item.name || UNASSIGNED_CABINET })), ...(!current || current.unassigned ? [] : [{ value: '__edit_cabinet__', label: '编辑当前机柜' }]), { value: '__all_cabinets__', label: '全部机柜 / 批量分配 / 迁移' }]} className="h-[34px] w-full min-w-0 gap-1 pl-[39px] pr-2 [&>span:first-child]:truncate" /></div>
      <VaultHeaderSearch data-rack-search value={keyword} onChange={(event) => onKeywordChange?.(event.target.value)} placeholder="搜索机房、机柜、设备或 IP" className="min-w-[140px] max-w-[520px] flex-[1_1_240px]" inputClassName="h-[34px] rounded-[7px] text-xs" />
    </VaultPageHeader>
    <main aria-label="机柜与设备" className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(360px,2fr)] grid-rows-[minmax(0,1fr)] overflow-hidden max-[1100px]:grid-cols-[minmax(0,3fr)_minmax(330px,2fr)] max-[900px]:flex max-[900px]:flex-col max-[900px]:overflow-y-auto">
      <section className="flex min-h-0 min-w-0 flex-col border-r border-border/60 px-5 pb-3 pt-4 max-[1100px]:p-3.5 max-[900px]:shrink-0 max-[900px]:border-b max-[900px]:border-r-0">
        {current ? current.unassigned ? current.devices.length ? <RoomDevices key={current.key} bucket={current} cabinets={cabinets} onOpenAsset={selectDevice} onBeforeChange={mayLeave} onChanged={query.reload} /> : <EmptyState label="当前机房为空；可新建机柜，设备由基础设施页面录入" /> : <>
          <div className="flex shrink-0 items-center justify-between gap-2"><h1 className="truncate text-sm font-semibold">{current.name} 机柜</h1><Button type="button" variant="outline" size="sm" className="h-[27px] shrink-0 gap-1.5 px-2 text-[11px] text-muted-foreground" aria-label="编辑机柜总 U 数" title="编辑机柜总 U 数" onClick={() => openLocation('capacity')}>{current.totalUnits}U<Pencil size={12} /></Button></div>
          <p className="mt-[7px] shrink-0 text-xs text-muted-foreground">已用 {current.usedUnits}U · 空闲 {Math.max(0, current.totalUnits - current.usedUnits)}U · 已上架 {current.placedCount} 台</p>
          <div role="progressbar" aria-label="机柜 U 位使用量" aria-valuemin={0} aria-valuemax={current.totalUnits} aria-valuenow={current.usedUnits} className="mb-3.5 mt-[13px] h-1 shrink-0 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, current.usedUnits / current.totalUnits * 100)}%` }} /></div>
          <RackView cabinet={current} devices={current.devices} selectedDeviceID={selection.deviceID} onSelectDevice={selectDevice} onSelectUnit={asset && !saving ? (unit) => setPlacementRequest({ deviceID: asset.id, room: current.room, name: current.name, unit }) : undefined} />
          <details key={current.key} className="group mt-3 max-h-40 shrink-0 overflow-y-auto border-t border-border pt-[9px]" data-section="rack-unplaced-devices"><summary className="flex h-[27px] cursor-pointer list-none items-center gap-1.5 text-xs [&::-webkit-details-marker]:hidden"><ChevronRight size={13} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" /><span>未上架 {layout.unplaced.length}</span><span className="mx-1.5 text-border">/</span><span className={layout.conflicts.length ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>冲突 {layout.conflicts.length}</span><span className="ml-auto text-[11px] text-muted-foreground">查看设备</span></summary><div className="flex flex-wrap gap-2 pt-2">{[...layout.conflicts, ...layout.unplaced].map((item) => <Button key={item.id} type="button" variant={Number(item.id) === Number(selection.deviceID) ? 'secondary' : 'outline'} size="sm" className={`h-7 max-w-full text-[11px] ${layout.conflicts.includes(item) ? 'text-destructive' : ''}`} title={item.name || item.asset_code} onClick={() => selectDevice(item.id)}><span className="truncate">{item.name || item.asset_code || `#${item.id}`}</span>{layout.conflicts.includes(item) ? ' · 冲突' : ''}</Button>)}{!layout.unplaced.length && !layout.conflicts.length ? <span className="text-[11px] text-muted-foreground">所有设备均已上架，无位置冲突</span> : null}</div></details>
        </> : <EmptyState label="尚无机房与机柜；可直接新建空机房或机柜" />}
      </section>
      <aside aria-label="设备属性与照片" className="flex min-h-0 min-w-0 flex-col max-[900px]:min-h-[620px] max-[900px]:shrink-0">{asset ? <RackDeviceEditor key={`${current.key}-${asset.id}-${editorRevision}`} asset={asset} cabinets={cabinets} rooms={rooms} meta={query.data.meta} deviceTypes={query.data.deviceTypes} placementRequest={placementRequest} onDirtyChange={changeDirty} onBusyChange={setSaving} onSaved={afterSaved} onOpenAsset={(id) => { if (mayLeave()) onOpenAsset?.(id) }} /> : <EmptyState label={current?.deviceCount ? '选择设备查看与编辑属性' : '当前机房 / 机柜暂无设备'} />}</aside>
    </main>
    <Dialog open={directoryOpen} onOpenChange={setDirectoryOpen}><DialogContent className="flex max-h-[84vh] flex-col sm:max-w-2xl" data-section="rack-directory-dialog"><DialogHeader><DialogTitle>全部机房与机柜</DialogTitle></DialogHeader><div className="min-h-0 space-y-3 overflow-y-auto">{directoryRooms.map((room) => <section key={room.key}><h3 className="mb-1 text-xs font-semibold">{room.name}</h3><div className="grid grid-cols-2 gap-2">{room.cabinets.map((item) => <button type="button" key={item.key} data-rack-cabinet={item.locationName || item.key} className="min-w-0 rounded-md border border-border p-2 text-left hover:bg-secondary" onClick={() => selectCabinet(item)}><strong className="block truncate text-xs" title={item.name || UNASSIGNED_CABINET}>{item.name || UNASSIGNED_CABINET}</strong><span className="text-[11px] text-muted-foreground">{item.deviceCount} 台{item.unassigned ? ' · 批量指定机柜' : ` · ${item.usedUnits}/${item.totalUnits}U`}{item.conflictCount ? ` · 冲突 ${item.conflictCount}` : ''}</span></button>)}</div></section>)}{!directoryRooms.length ? <EmptyState label="没有匹配的机房、机柜或设备" /> : null}</div><DialogFooter><Button data-rack-migration-preview variant="outline" onClick={openMigration}>迁移预览 / 回滚</Button><Button variant="outline" onClick={() => setDirectoryOpen(false)}>关闭</Button></DialogFooter></DialogContent></Dialog>
    <RackLocationEditor mode={locationMode} cabinet={['edit', 'capacity'].includes(locationMode) ? current : null} room={current?.room || ''} rooms={rooms} cabinets={cabinets} onDirtyChange={setLocationDirty} onBusyChange={setSaving} onClose={() => setLocationMode('')} onSaved={({ room, name }) => { pendingSelection.current = { key: rackKey({ data_center: room, cabinet_name: name }), deviceID: ['edit', 'capacity'].includes(locationMode) ? selection.deviceID : 0 }; query.reload() }} />
    <MigrationDialog open={migrationOpen} onOpenChange={setMigrationOpen} preview={migrationPreview} loading={migrationLoading} error={migrationError} result={migrationResult} busy={migrationBusy} onApply={() => mutateMigration('apply')} onRollback={() => mutateMigration('rollback')} />
  </div>
}
