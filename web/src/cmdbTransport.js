function resolveDeps(deps) {
  const bridge = Object.prototype.hasOwnProperty.call(deps, 'bridge')
    ? deps.bridge
    : globalThis.window?.netcatty
  const fetchImpl = Object.prototype.hasOwnProperty.call(deps, 'fetchImpl')
    ? deps.fetchImpl
    : globalThis.fetch
  return { bridge, fetchImpl }
}

async function readBrowserError(response) {
  const text = await response.text()
  try {
    return JSON.parse(text).error || text || `HTTP ${response.status}`
  } catch {
    return text || `HTTP ${response.status}`
  }
}

export function hasNativeCmdbBridge(bridge = globalThis.window?.netcatty) {
  return typeof bridge?.cmdbRequest === 'function'
}

export function hasNativeCmdbImportBridge(bridge = globalThis.window?.netcatty) {
  return typeof bridge?.cmdbImportFile === 'function'
}

export async function requestJson(path, options = {}, deps = {}) {
  const { bridge, fetchImpl } = resolveDeps(deps)
  const method = options.method || 'GET'
  if (hasNativeCmdbBridge(bridge)) {
    return bridge.cmdbRequest({ path, method, body: options.body })
  }
  if (typeof fetchImpl !== 'function') throw new Error('CMDB 请求通道不可用')
  const response = await fetchImpl(path, {
    ...options,
    method,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) throw new Error(await readBrowserError(response))
  return response.status === 204 ? null : response.json()
}

export async function importFile(path, options = {}, deps = {}) {
  const { bridge, fetchImpl } = resolveDeps(deps)
  if (hasNativeCmdbImportBridge(bridge)) {
    return bridge.cmdbImportFile({ path, commit: !!options.commit, token: options.token })
  }
  if (!options.file) throw new Error('请选择导入文件')
  if (typeof fetchImpl !== 'function') throw new Error('CMDB 请求通道不可用')
  const form = new FormData()
  form.append('file', options.file)
  const response = await fetchImpl(`${path}${options.commit ? '?commit=1' : ''}`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) throw new Error(await readBrowserError(response))
  return response.json()
}

export async function exportFile(path, suggestedName, deps = {}) {
  const { bridge, fetchImpl } = resolveDeps(deps)
  if (typeof bridge?.cmdbExportFile === 'function') {
    return bridge.cmdbExportFile({ path, suggestedName })
  }
  if (typeof fetchImpl !== 'function') throw new Error('CMDB 请求通道不可用')
  const response = await fetchImpl(path)
  if (!response.ok) throw new Error(await readBrowserError(response))
  const href = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = suggestedName
  anchor.click()
  URL.revokeObjectURL(href)
  return { cancelled: false }
}
