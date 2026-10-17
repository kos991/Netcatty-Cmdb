import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useNetcattyDirectory } from './NetcattyDirectory'
import { SelectControl } from './ui'
import { infrastructureFieldProfile } from './state'

const labels = { cpu_info: 'CPU', vcpu: 'vCPU（核）', memory_mb: '内存（MB）', disk_info: '磁盘', os_type: '操作系统', os_version: '系统版本' }
const detectFamily = value => /ESXi/i.test(value || '') ? 'ESXi' : /Windows/i.test(value || '') ? 'Windows' : /Linux|Ubuntu|Euler|Rocky|Debian|CentOS|麒麟|UOS/i.test(value || '') ? 'Linux' : ''

export default function HardwareCollection({ value, onChange, connection }) {
  const directory = useNetcattyDirectory()
  const [family, setFamily] = useState(() => detectFamily(value.os_type))
  const [result, setResult] = useState(null)
  const [checked, setChecked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const invalidate = useCallback(() => { sequence.current++ }, [])
  const identity = `${connection?.host_id || ''}:${connection?.credential_id || ''}:${value.device_type || value.type || ''}:${value.os_type || ''}:${value.mgmt_ip || value.manage_ip || value.ip || ''}`
  const virtual = value.asset_class === 'virtual' || infrastructureFieldProfile(value.category_name || value.device_type || value.type || '').virtualCompute
  useEffect(() => {
    sequence.current++; setResult(null); setChecked([]); setBusy(false); setError(''); setFamily(detectFamily(value.os_type))
    return invalidate
  }, [identity, value.os_type, invalidate])
  const host = directory.hosts.find(item => item.id === connection?.host_id)
  const address = value.mgmt_ip || value.manage_ip || value.ip || ''
  const mismatch = host && address && host.hostname !== address
  const read = async () => {
    const token = ++sequence.current
    setBusy(true); setError(''); setResult(null); setChecked([])
    try {
      const data = await directory.readHardware(connection.host_id, family, connection.credential_id || '')
      if (sequence.current === token) setResult(data)
    } catch (failure) { if (sequence.current === token) setError(failure.message || '硬件读取失败') }
    finally { if (sequence.current === token) setBusy(false) }
  }
  return <details className="mt-3 rounded-md border border-border p-3" data-section="hardware-collection">
    <summary className="cursor-pointer text-xs font-medium">SSH 读取硬件</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">使用凭证中心关联的 SSH 主机，读取后勾选确认，仅回填未保存表单。</p>
      <SelectControl aria-label="硬件读取操作系统" value={family} disabled={busy} onChange={next => { sequence.current++; setFamily(next); setResult(null); setError('') }} options={[{ value: '', label: '选择操作系统' }, { value: 'Linux', label: 'Linux' }, { value: 'Windows', label: 'Windows' }, { value: 'ESXi', label: 'ESXi（请手动填写）' }]} />
      {!host ? <p className="text-xs text-muted-foreground">请先在凭证中心关联主机。</p> : <p className="break-all text-xs text-muted-foreground">目标：{host.hostname}</p>}
      {mismatch ? <p className="text-xs text-muted-foreground">关联主机目标与台账IP不同，请确认上方目标；读取使用该Netcatty主机配置。</p> : null}
      <div className="flex gap-2"><Button type="button" size="sm" disabled={busy || !host || !['Linux', 'Windows'].includes(family)} onClick={read}>{busy ? '读取中…' : error ? '重试读取' : '读取硬件'}</Button>{busy || result ? <Button type="button" size="sm" variant="outline" onClick={() => { sequence.current++; setBusy(false); setResult(null); setChecked([]) }}>{busy ? '停止等待' : '取消回填'}</Button> : null}</div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {result ? <div className="space-y-2">{Object.entries(labels).filter(([key]) => (key !== (virtual ? 'cpu_info' : 'vcpu')) && result[key] !== undefined && result[key] !== '').map(([key, label]) => <label key={key} className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={checked.includes(key)} onChange={event => setChecked(old => event.target.checked ? [...old, key] : old.filter(item => item !== key))} /><span className="min-w-0 break-words">{label}：{result[key]}<span className="block text-muted-foreground">当前：{value[key] || '未填写'}</span></span></label>)}<Button type="button" size="sm" disabled={!checked.length} onClick={() => { onChange({ ...value, ...Object.fromEntries(checked.map(key => [key, result[key]])) }); setResult(null); setChecked([]) }}>确认回填勾选项</Button></div> : null}
    </div>
  </details>
}
