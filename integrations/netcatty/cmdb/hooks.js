import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'

// 过期请求不能覆盖新的筛选结果或已关闭的详情。
export function useQuery(loader, initial = null) {
  const [data, setData] = useState(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const current = ++sequence.current
    setLoading(true)
    setError('')
    try {
      const result = await loader()
      if (current === sequence.current) setData(result)
    } catch (e) {
      if (current === sequence.current) setError(e.message)
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [loader])
  const invalidate = useCallback(() => { sequence.current++ }, [])
  useEffect(() => { reload(); return invalidate }, [reload, invalidate])
  return { data, loading, error, reload }
}

export function useAction() {
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const run = async (action, success) => {
    if (running.current) return false
    running.current = true
    setBusy(true)
    try {
      await action()
      if (success) toast.success(success)
      return true
    } catch (error) { toast.error(error.message); return false }
    finally { running.current = false; setBusy(false) }
  }
  return { busy, run }
}

export async function allPages(loader, params = {}) {
  const rows = []
  for (let page = 1; ; page++) {
    const result = await loader({ ...params, page, page_size: 500 })
    rows.push(...(result.list || []))
    if (rows.length >= (result.total || 0)) return rows
    if (!result.list?.length) throw new Error('分页结果不完整，请刷新后重试')
  }
}

export function directoryChanged() {
  window.dispatchEvent(new CustomEvent('cmdb:directory-changed'))
}

export function useDirectory(loader) {
  const query = useQuery(loader)
  useEffect(() => {
    window.addEventListener('cmdb:directory-changed', query.reload)
    return () => window.removeEventListener('cmdb:directory-changed', query.reload)
  }, [query.reload])
  return query
}
