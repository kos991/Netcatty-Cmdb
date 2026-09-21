import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { api } from './api'
import { nativeStatus } from './transport'
import { resolveSearchTarget } from './state'
import { useQuery } from './hooks'
import { ErrorBanner } from './ui'

const modules = {
  assets: lazy(() => import('./DeviceAssets')),
  people: lazy(() => import('./People')),
  ip: lazy(() => import('./IPAM')),
  operations: lazy(() => import('./Operations')),
  config: lazy(() => import('./ConfigCenter')),
}

export default function CmdbWorkspace({ activeModule = 'assets', onModuleChange }) {
  const root = useRef(null)
  const [targets, setTargets] = useState({})
  const initialize = useCallback(async () => {
    await nativeStatus()
    const [meta, projects] = await Promise.all([api.meta(), api.projects()])
    void projects
    return meta
  }, [])
  const query = useQuery(initialize)
  const navigate = useCallback((result) => {
    const target = resolveSearchTarget(result)
    if (!target) return
    setTargets((old) => ({ ...old, [target.module]: { ...result } }))
    onModuleChange(target.module)
  }, [onModuleChange])
  useEffect(() => {
    const handle = (event) => {
      if (!root.current?.getClientRects().length || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      event.preventDefault(); event.stopImmediatePropagation(); onModuleChange('assets')
      requestAnimationFrame(() => root.current?.querySelector('[data-device-asset-search-input]')?.focus())
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [onModuleChange])
  const Module = modules[activeModule] || modules.assets
  return <div ref={root} data-cmdb-native className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
    {query.error ? <ErrorBanner title="Cmdb 服务不可用" message={query.error} onRetry={query.reload} /> : !query.data ? <div className="grid flex-1 place-items-center"><Spinner /></div> : <Suspense fallback={<div className="p-5"><Spinner /></div>}><Module meta={query.data} focusTarget={targets[activeModule]} onNavigate={navigate} /></Suspense>}
  </div>
}
