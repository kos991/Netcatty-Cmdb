import React from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Field, FormGrid, SelectControl } from './ui'

export const textFields = (entries) => entries.map(([key, label, type]) => ({ key, label, type }))
export const choices = (values, blank = '请选择') => [{ value: '', label: blank }, ...values.map((item) => typeof item === 'object' ? item : { value: item, label: item })]

export function Fields({ fields, value, onChange, className, textareaFullWidth = true }) {
  return <FormGrid className={className}>{fields.filter((field) => !field.hidden).map((field) => {
    const raw = field.custom ? value.custom_fields?.[field.key] : value[field.key]
    const current = field.numeric && Number(raw) === 0 && !field.preserveZero ? '' : (raw ?? '')
    const change = (next) => onChange(field.custom
      ? { ...value, custom_fields: { ...(value.custom_fields || {}), [field.key]: next }, ...field.derive?.(next, value) }
      : { ...value, [field.key]: next, ...field.derive?.(next, value) })
    const props = { id: `cmdb-${field.key}`, 'aria-label': field.label, disabled: field.disabled, required: field.required }
    const control = field.render ? field.render({ current, raw, value, onChange: change, props })
      : field.options ? <SelectControl {...props} searchable={field.searchable || ['person_id', 'to_person_id', 'owner_id', 'server_id'].includes(field.key)} value={current} onChange={(next) => change(field.numeric ? Number(next) : next)} options={field.options} />
        : field.type === 'boolean' ? <Switch {...props} checked={!!current} onCheckedChange={(next) => change(field.numeric ? Number(next) : next)} />
          : field.type === 'textarea' ? <Textarea {...props} value={current} onChange={(event) => change(event.target.value)} rows={3} />
            : <Input {...props} className="h-9" type={field.type || 'text'} min={field.min} step={field.step} pattern={field.pattern} placeholder={field.placeholder} value={current} onChange={(event) => change(field.type === 'number' ? Number(event.target.value) : event.target.value)} />
    return <Field key={field.key} label={field.label} required={field.required} className={field.wide || (textareaFullWidth && field.type === 'textarea') ? 'sm:col-span-2' : ''}>{control}</Field>
  })}</FormGrid>
}

export function validateFields(fields, value) {
  for (const field of fields) {
    if (field.hidden) continue
    const fieldValue = field.custom ? value.custom_fields?.[field.key] : value[field.key]
    if (field.required && (fieldValue === undefined || fieldValue === null || String(fieldValue).trim() === '' || (field.numeric && !fieldValue))) throw new Error(`请填写${field.label}`)
  }
}
