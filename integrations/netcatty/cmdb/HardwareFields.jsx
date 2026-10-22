import React, { useEffect, useId, useMemo, useReducer, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SelectControl } from './ui'
import { HARDWARE_UNITS, createHardwareDraft, editHardwareDraft, memoryAmountToMB, reconcileHardwareDraft, validateHardwareDraft } from './hardwareFieldModel'
import { HARDWARE_PRESET_KEYS, addHardwarePreset, hardwarePresetLabel, hardwarePresetParts, isUsableHardwarePreset, readHardwarePresets, removeHardwarePreset, saveHardwarePresets } from './hardwarePresetModel'

const CPU_MODELS = ['Intel Core i5-12500', 'Intel Core i5-1345U', 'Intel Core i7-13700', 'Intel Xeon Gold 6330', 'Intel Xeon Silver 4310', 'AMD Ryzen 7 7700', 'AMD EPYC 7313']
const DISK_MEDIA = ['SATA', 'SSD', 'U.2', 'SAS', 'NVMe', 'HDD', 'SATA SSD', 'SAS SSD']
const PRESET_EVENT = 'cmdb:hardware-presets-changed'

// 常用预设按字段保存在本机；多个表单实例通过事件同步，删除或新增后立即可见。
function useHardwarePresets(fieldKey) {
  const enabled = HARDWARE_PRESET_KEYS.includes(fieldKey)
  const [presets, setPresets] = useState(() => enabled ? readHardwarePresets(globalThis.localStorage, fieldKey) : [])
  useEffect(() => {
    if (!enabled) return undefined
    const sync = () => setPresets(readHardwarePresets(globalThis.localStorage, fieldKey))
    window.addEventListener(PRESET_EVENT, sync)
    return () => window.removeEventListener(PRESET_EVENT, sync)
  }, [enabled, fieldKey])
  const persist = (next) => {
    try {
      setPresets(saveHardwarePresets(globalThis.localStorage, fieldKey, next))
      window.dispatchEvent(new Event(PRESET_EVENT))
      return ''
    } catch (error) { return `常用预设保存失败：${error.message}` }
  }
  return { enabled, presets, persist }
}

export function useHardwareDrafts(session) {
  return useMemo(() => ({ session, fields: new Map() }), [session]).fields
}

export function hardwareField(key, label, drafts, hidden = false) {
  return { key, label, hidden, wide: true, validate: source => validateHardwareDraft(key, drafts.get(key), source), render: ({ raw, onChange, props }) => <HardwareField fieldKey={key} label={label} value={raw} onChange={onChange} drafts={drafts} inputProps={props} /> }
}

export function HardwareField({ fieldKey, label, value, onChange, drafts, inputProps = {} }) {
  const uid = useId().replace(/:/g, '')
  const id = `${inputProps.id || 'cmdb-hardware'}-${uid}`
  const [, redraw] = useReducer(count => count + 1, 0)
  const [editing, setEditing] = useState(false)
  const draft = reconcileHardwareDraft(fieldKey, drafts.get(fieldKey), value)
  drafts.set(fieldKey, draft)
  const store = next => { drafts.set(fieldKey, next); redraw() }
  const commit = (part, nextValue, explicit = false) => {
    const next = editHardwareDraft(fieldKey, draft, part, nextValue, explicit)
    store(next)
    if (!Object.is(next.source, value)) onChange(next.source)
  }
  const rawChange = raw => {
    if (fieldKey === 'memory_mb' || fieldKey === 'vcpu') {
      try {
        if (raw && !/^\d+$/.test(raw)) throw new Error(fieldKey === 'vcpu' ? 'vCPU 必须为非负整数' : '原始内存必须为整数 MB')
        const source = raw === '' ? 0 : memoryAmountToMB(raw)
        store({ ...createHardwareDraft(fieldKey, source), previous: draft.previous, edited: true }); onChange(source)
      } catch (error) { store({ ...draft, rawText: raw, rawError: error.message }) }
    } else { store({ ...createHardwareDraft(fieldKey, raw), previous: draft.previous, edited: true }); onChange(raw) }
  }
  const partInput = (part, caption, { suggestions, numeric = false, placeholder } = {}) => <label className="grid min-w-0 gap-1 text-[11px] text-muted-foreground" data-hardware-slot={part} htmlFor={`${id}-${part}`}>
    {caption}<Input id={`${id}-${part}`} disabled={inputProps.disabled} aria-label={`${label} · ${caption}`} aria-describedby={`${id}-status`} data-hardware-part={part} className="h-8 min-w-0 w-full text-xs" inputMode={numeric ? 'decimal' : undefined} autoComplete="off" value={draft.parts[part]} placeholder={placeholder || (suggestions ? '可选或输入自定义' : '')} list={suggestions ? `${id}-${part}-options` : undefined} onChange={event => commit(part, event.target.value)} />
    {suggestions && <datalist id={`${id}-${part}-options`}>{suggestions.map(item => <option key={item} value={item} />)}</datalist>}
  </label>
  const unitInput = <div className="grid min-w-0 gap-1 text-[11px] text-muted-foreground" data-hardware-slot="unit"><label htmlFor={`${id}-unit`}>单位</label><SelectControl id={`${id}-unit`} aria-label={`${label} · 单位`} disabled={inputProps.disabled} className="h-8 min-w-0 w-full" value={draft.parts.unit} onChange={unit => commit('unit', unit)} options={HARDWARE_UNITS} /></div>
  const presetState = useHardwarePresets(fieldKey)
  const [presetError, setPresetError] = useState('')
  const currentPresetLabel = draft.recognized && isUsableHardwarePreset(fieldKey, draft.parts) ? hardwarePresetLabel(fieldKey, draft.parts) : ''
  const applyPreset = preset => {
    // 预设只填分项、保留补充说明；旧原文无法拆分时仍需“用分项替换完整文本”才覆盖。
    const next = editHardwareDraft(fieldKey, { ...draft, parts: { ...draft.parts, ...hardwarePresetParts(fieldKey, preset) } }, null, null)
    store(next)
    if (!Object.is(next.source, value)) onChange(next.source)
  }
  const savePreset = () => {
    try { setPresetError(presetState.persist(addHardwarePreset(fieldKey, presetState.presets, draft.parts))) }
    catch (error) { setPresetError(error.message) }
  }
  const presetBar = presetState.enabled ? <div className="cmdb-hardware-presets" role="group" aria-label={`${label} · 常用预设`}>
    <span className="cmdb-hardware-presets-title">常用</span>
    {presetState.presets.map(preset => { const text = hardwarePresetLabel(fieldKey, preset); return <span key={text} className="cmdb-hardware-preset" data-active={text === currentPresetLabel || undefined}>
      <button type="button" disabled={inputProps.disabled} title={`应用常用预设：${text}`} data-hardware-preset={text} onClick={() => applyPreset(preset)}>{text}</button>
      <button type="button" disabled={inputProps.disabled} aria-label={`删除常用预设：${text}`} title="删除此常用预设" onClick={() => setPresetError(presetState.persist(removeHardwarePreset(fieldKey, presetState.presets, text)))}><X size={11} /></button>
    </span> })}
    {!presetState.presets.length ? <span className="cmdb-hardware-presets-empty">暂无常用预设</span> : null}
    <button type="button" className="cmdb-hardware-preset-save" disabled={inputProps.disabled || !currentPresetLabel || presetState.presets.some(preset => hardwarePresetLabel(fieldKey, preset) === currentPresetLabel)} title={currentPresetLabel ? `把“${currentPresetLabel}”存为常用预设` : '填写完整分项后可存为常用预设'} data-hardware-action="save-preset" onClick={savePreset}><Plus size={11} />存为常用</button>
    {presetError ? <span role="alert" className="cmdb-hardware-presets-error">{presetError}</span> : null}
  </div> : null
  const error = draft.rawError || draft.error
  const message = error || (!draft.recognized ? '原文无法可靠拆分，已原样保留。分项仅作草稿，明确替换后才覆盖。' : fieldKey === 'memory_mb' ? `按 1024 换算：${value ?? 0} MB；只保存整数 MB。` : '分项同步原字段；可在展开区编辑任意完整原文。')
  if (fieldKey === 'vcpu') return <div data-hardware-field={fieldKey} className="min-w-0 space-y-1"><Input {...inputProps} id={id} className="h-8" inputMode="numeric" value={draft.rawText ?? draft.parts.count} onChange={event => rawChange(event.target.value)} placeholder="自由填写整数核数，不限预设" aria-invalid={!!error} aria-describedby={`${id}-status`} data-hardware-part="count" /><p id={`${id}-status`} role="status" className={`text-[11px] ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || '自由填写整数 vCPU，不限预设核数。'}</p>{draft.previous && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">外部回填前内容（已保留）</summary><div className="mt-2 space-y-2"><Input readOnly aria-label={`${label} · 外部回填前草稿`} value={draft.previous.rawText ?? draft.previous.source ?? ''} /><Button type="button" variant="outline" size="sm" disabled={inputProps.disabled} data-hardware-action="restore-source" onClick={() => rawChange(draft.previous.rawText ?? String(draft.previous.source ?? ''))}>用此前内容替换</Button></div></details>}</div>
  // 未能拆分的旧原文始终显示原文，避免草稿分项被误认为已保存的配置。
  const partSummary = [draft.parts.count && (fieldKey === 'memory_mb' ? '' : draft.parts.count), draft.parts.model, draft.parts.amount && `${draft.parts.amount} ${draft.parts.unit || ''}`.trim(), draft.parts.capacity && `${draft.parts.capacity} ${draft.parts.unit || ''}`.trim(), draft.parts.medium].filter(Boolean).join(' · ')
  const summary = (draft.recognized ? partSummary : '') || (value === 0 ? '' : value) || '未配置'
  return <div data-hardware-field={fieldKey} className="min-w-0 space-y-2">
    <button type="button" aria-expanded={editing} onClick={() => setEditing(v => !v)} title={typeof summary === 'string' ? summary : undefined} className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-[13px] hover:bg-muted/40"><span className="min-w-0 truncate">{!draft.recognized && value ? <span className="mr-1 text-[11px] text-muted-foreground">原文</span> : null}{summary}</span><span className="shrink-0 text-[11px] text-muted-foreground">{editing ? '收起' : '编辑'}</span></button>
    {editing && <div className="min-w-0 space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
      {presetBar}
      <div className="cmdb-hardware-parts" data-hardware-layout={fieldKey}>{fieldKey === 'memory_mb' ? <>{partInput('amount', '容量', { numeric: true })}{unitInput}</> : <>{partInput('count', '数量', { numeric: true })}{fieldKey === 'cpu_info' ? partInput('model', '型号', { suggestions: CPU_MODELS }) : <>{partInput('capacity', '单盘容量', { numeric: true })}{unitInput}{partInput('medium', '介质 / 接口', { suggestions: DISK_MEDIA })}</>}</>}</div>
      <details open={draft.expanded ?? !draft.recognized} onToggle={event => { const expanded = event.currentTarget.open; if (expanded !== (draft.expanded ?? !draft.recognized)) store({ ...draft, expanded }) }} className="min-w-0 text-xs"><summary className="cursor-pointer text-[11px] text-muted-foreground">{!draft.recognized ? '原文配置（未拆分）' : fieldKey === 'memory_mb' ? '原始 MB 值' : `完整配置与说明${draft.parts.note ? ' · 已填写' : ''}`}</summary><div className="mt-2 min-w-0 space-y-2">{fieldKey !== 'memory_mb' && partInput('note', fieldKey === 'cpu_info' ? '补充说明' : '阵列 / RAID / 其他说明')}<label htmlFor={id} className="block text-[11px] text-muted-foreground">{fieldKey === 'memory_mb' ? '原始 MB 值' : '完整配置原文'}</label>{fieldKey === 'memory_mb' ? <Input {...inputProps} id={id} className="h-8" value={draft.rawText ?? value ?? ''} onChange={event => rawChange(event.target.value)} aria-describedby={`${id}-status`} aria-invalid={!!error} data-hardware-part="raw" /> : <Textarea {...inputProps} id={id} className="min-w-0 text-xs" rows={2} value={value ?? ''} onChange={event => rawChange(event.target.value)} aria-describedby={`${id}-status`} data-hardware-part="raw" />}{!draft.recognized && <Button type="button" variant="outline" size="sm" disabled={inputProps.disabled} data-hardware-action="replace" onClick={() => commit(null, null, true)}>用分项替换完整文本</Button>}{!error && <p id={`${id}-status`} role="status" className="break-words text-[11px] text-muted-foreground">{message}</p>}</div></details>
      {error && <p id={`${id}-status`} role="alert" className="break-words text-[11px] text-destructive">{error}</p>}
    </div>}
  </div>
}
