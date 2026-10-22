import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, Tag } from 'lucide-react'
import { api } from './api'
import { cmdbVersionPresentation } from './cmdbVersionModel'

// 设置中心 Cmdb 页的版本与升级入口：版本取自内置服务的真实发布 tag，升级复用宿主更新桥。
export default function CmdbVersionBadge() {
  const bridge = globalThis.window?.netcatty
  const [version, setVersion] = useState('')
  const [versionError, setVersionError] = useState('')
  const [status, setStatus] = useState('idle')
  const [latest, setLatest] = useState('')
  const [error, setError] = useState('')
  const busy = useRef(false)

  useEffect(() => {
    let cancelled = false
    api.version().then(result => { if (!cancelled) setVersion(result?.version || '') })
      .catch(readError => { if (!cancelled) setVersionError(readError instanceof Error ? readError.message : String(readError)) })
    return () => { cancelled = true }
  }, [])
  const presentation = cmdbVersionPresentation(version)
  const openRelease = (event) => {
    event.preventDefault()
    if (typeof bridge?.openExternal === 'function') void bridge.openExternal(presentation.url)
    else window.open(presentation.url, '_blank', 'noopener,noreferrer')
  }

  const check = useCallback(async () => {
    if (busy.current) return
    if (typeof bridge?.checkForUpdate !== 'function') { setStatus('error'); setError('当前环境不支持在线更新'); return }
    busy.current = true
    setStatus('checking'); setError('')
    try {
      const result = await bridge.checkForUpdate()
      if (result?.error) { setStatus('error'); setError(result.error); return }
      if (!result?.available) { setStatus('current'); return }
      setLatest(result.version || '')
      setStatus('available')
    } catch (checkError) {
      setStatus('error')
      setError(checkError instanceof Error ? checkError.message : String(checkError))
    } finally { busy.current = false }
  }, [bridge])

  const install = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setStatus('downloading'); setError('')
    try {
      const download = await bridge?.downloadUpdate?.()
      if (!download?.success) throw new Error(download?.error || '更新下载失败')
      setStatus('ready')
      bridge?.installUpdate?.()
    } catch (downloadError) {
      setStatus('error')
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError))
    } finally { busy.current = false }
  }, [bridge])

  const label = status === 'checking' ? '检查中…'
    : status === 'downloading' ? '下载中…'
      : status === 'available' ? `升级到 v${latest}`
        : status === 'ready' ? '正在安装…'
          : '检查更新'
  return <div className="cmdb-version-badge" data-section="cmdb-version" data-version-kind={presentation.kind}>
    <a href={presentation.url} className="cmdb-version-tag" title={versionError ? `读取版本失败：${versionError}` : presentation.title} aria-label={`Cmdb 版本：${presentation.label}`} onClick={openRelease}><Tag size={12} aria-hidden="true" /><span>{presentation.label}</span></a>
    {status === 'current' ? <span className="cmdb-version-ok">已是最新</span> : null}
    {status === 'error' ? <span className="cmdb-version-error" title={error}>{error}</span> : null}
    <Button type="button" variant={status === 'available' ? 'default' : 'outline'} size="sm" className={`h-7 gap-1 px-2 text-[11px] ${status === 'available' ? 'cmdb-primary-action' : ''}`} disabled={status === 'checking' || status === 'downloading' || status === 'ready'} onClick={status === 'available' ? install : check}>
      {status === 'checking' || status === 'downloading' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
      {label}
    </Button>
  </div>
}
