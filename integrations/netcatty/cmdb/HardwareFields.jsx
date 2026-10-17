import React, { useId, useMemo, useReducer } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SelectControl } from './ui'
import { HARDWARE_UNITS, createHardwareDraft, editHardwareDraft, memoryAmountToMB, reconcileHardwareDraft, validateHardwareDraft } from './hardwareFieldModel'

const CPU_MODELS = ['Intel Core i5-12500', 'Intel Core i5-1345U', 'Intel Core i7-13700', 'Intel Xeon Gold 6330', 'Intel Xeon Silver 4310', 'AMD Ryzen 7 7700', 'AMD EPYC 7313']
const DISK_MEDIA = ['SATA', 'SSD', 'U.2', 'SAS', 'NVMe', 'HDD', 'SATA SSD', 'SAS SSD']

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
  const partInput = (part, caption, { suggestions, numeric = false, placeholder } = {}) => <label className="grid min-w-0 gap-1 text-[11px] text-muted-foreground" htmlFor={`${id}-${part}`}>
    {caption}<Input id={`${id}-${part}`} disabled={inputProps.disabled} aria-label={`${label} · ${caption}`} aria-describedby={`${id}-status`} data-hardware-part={part} className="h-8 min-w-0 w-full text-xs" inputMode={numeric ? 'decimal' : undefined} autoComplete="off" value={draft.parts[part]} placeholder={placeholder || (suggestions ? '可选或输入自定义' : '')} list={suggestions ? `${id}-${part}-options` : undefined} onChange={event => commit(part, event.target.value)} />
    {suggestions && <datalist id={`${id}-${part}-options`}>{suggestions.map(item => <option key={item} value={item} />)}</datalist>}
  </label>
  const unitInput = <div className="grid min-w-0 gap-1 text-[11px] text-muted-foreground"><label htmlFor={`${id}-unit`}>单位</label><SelectControl id={`${id}-unit`} aria-label={`${label} · 单位`} disabled={inputProps.disabled} className="min-w-0 w-full" value={draft.parts.unit} onChange={unit => commit('unit', unit)} options={HARDWARE_UNITS} /></div>
  const error = draft.rawError || draft.error
  const message = error || (!draft.recognized ? '原文无法可靠拆分，已原样保留。分项仅作草稿，明确替换后才覆盖。' : fieldKey === 'memory_mb' ? `按 1024 换算：${value ?? 0} MB；只保存整数 MB。` : '分项同步原字段；可在展开区编辑任意完整原文。')
  if (fieldKey === 'vcpu') return <div data-hardware-field={fieldKey} className="min-w-0 space-y-1"><Input {...inputProps} id={id} className="h-8" inputMode="numeric" value={draft.rawText ?? draft.parts.count} onChange={event => rawChange(event.target.value)} placeholder="自由填写整数核数，不限预设" aria-invalid={!!error} aria-describedby={`${id}-status`} data-hardware-part="count" /><p id={`${id}-status`} role="status" className={`text-[11px] ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || '自由填写整数 vCPU，不限预设核数。'}</p>{draft.previous && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">外部回填前内容（已保留）</summary><div className="mt-2 space-y-2"><Input readOnly aria-label={`${label} · 外部回填前草稿`} value={draft.previous.rawText ?? draft.previous.source ?? ''} /><Button type="button" variant="outline" size="sm" disabled={inputProps.disabled} data-hardware-action="restore-source" onClick={() => rawChange(draft.previous.rawText ?? String(draft.previous.source ?? ''))}>用此前内容替换</Button></div></details>}</div>
  return <div data-hardware-field={fieldKey} className="min-w-0 space-y-2"><div className={`grid min-w-0 gap-2 ${fieldKey === 'cpu_info' ? 'grid-cols-[72px_minmax(0,1fr)]' : fieldKey === 'memory_mb' ? 'grid-cols-[minmax(0,1fr)_80px]' : 'grid-cols-[64px_minmax(0,1fr)_76px]'}`}>{fieldKey === 'memory_mb' ? <>{partInput('amount', '容量', { numeric: true })}{unitInput}</> : <>{partInput('count', '数量', { numeric: true })}{fieldKey === 'cpu_info' ? partInput('model', '型号', { suggestions: CPU_MODELS }) : <>{partInput('capacity', '单盘容量', { numeric: true })}{unitInput}</>}</>}</div>{fieldKey === 'disk_info' && partInput('medium', '介质 / 接口', { suggestions: DISK_MEDIA })}<details open={draft.expanded ?? !draft.recognized} onToggle={event => { const expanded = event.currentTarget.open; if (expanded !== (draft.expanded ?? !draft.recognized)) store({ ...draft, expanded }) }} className="min-w-0 text-xs"><summary className="cursor-pointer text-[11px] text-muted-foreground">{!draft.recognized ? '原文配置（未拆分）' : fieldKey === 'memory_mb' ? '原始 MB 值' : `说明与完整配置${draft.parts.note ? ' · 已填写' : ''}`}</summary><div className="mt-2 min-w-0 space-y-2">{fieldKey !== 'memory_mb' && partInput('note', fieldKey === 'cpu_info' ? '补充说明' : '阵列 / RAID / 其他说明')}<label htmlFor={id} className="block text-[11px] text-muted-foreground">{fieldKey === 'memory_mb' ? '原始 MB 值' : '完整配置原文'}</label>{fieldKey === 'memory_mb' ? <Input {...inputProps} id={id} className="h-8" value={draft.rawText ?? value ?? ''} onChange={event => rawChange(event.target.value)} aria-describedby={`${id}-status`} aria-invalid={!!error} data-hardware-part="raw" /> : <Textarea {...inputProps} id={id} className="min-w-0 text-xs" rows={2} value={value ?? ''} onChange={event => rawChange(event.target.value)} aria-describedby={`${id}-status`} data-hardware-part="raw" />}{!draft.recognized && <Button type="button" variant="outline" size="sm" disabled={inputProps.disabled} data-hardware-action="replace" onClick={() => commit(null, null, true)}>用分项替换完整文本</Button>}{!error && <p id={`${id}-status`} role="status" className="break-words text-[11px] text-muted-foreground">{message}</p>}</div></details>{draft.previous && <details className="min-w-0 text-xs"><summary className="cursor-pointer text-[11px] text-muted-foreground">外部回填前内容（已保留）</summary><div className="mt-2 space-y-2"><Textarea readOnly rows={2} aria-label={`${label} · 外部回填前原文`} className="text-xs" value={draft.previous.source ?? ''} />{draft.previous.rawText !== undefined && <Input readOnly aria-label={`${label} · 外部回填前原文草稿`} value={draft.previous.rawText} />}<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={inputProps.disabled} data-hardware-action="restore-draft" onClick={() => store({ ...draft, parts: draft.previous.parts, recognized: false, edited: true, error: '', rawError: '', rawText: undefined, expanded: true })}>恢复此前分项草稿（不覆盖原文）</Button><Button type="button" variant="outline" size="sm" disabled={inputProps.disabled} data-hardware-action="restore-source" onClick={() => rawChange(String(draft.previous.source ?? ''))}>用此前完整原文替换</Button></div></div></details>}{error && <p id={`${id}-status`} role="alert" className="break-words text-[11px] text-destructive">{error}</p>}</div>
}
