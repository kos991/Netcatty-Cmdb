let scheduledSync

function scheduleCmdbCloudSync() {
  try {
    const settings = JSON.parse(globalThis.localStorage?.getItem('netcatty.cmdb.cloudSync.v1') || '{}')
    if (settings.enabled !== true || typeof globalThis.window?.dispatchEvent !== 'function') return
    if (scheduledSync) clearTimeout(scheduledSync)
    scheduledSync = setTimeout(() => {
      scheduledSync = undefined
      globalThis.window?.dispatchEvent(new CustomEvent('netcatty:cmdb-cloud-sync-request'))
    }, 800)
  } catch {
    // 本机同步设置损坏时，不影响已经成功的 Cmdb 写入。
  }
}

function resolveBridge() {
  return globalThis.window?.netcatty
}

export async function requestJson(path, options = {}) {
  const bridge = resolveBridge()
  const method = options.method || 'GET'
  if (typeof bridge?.cmdbRequest === 'function') {
    const result = await bridge.cmdbRequest({ path, method, body: options.body })
    if (method !== 'GET' && !path.startsWith('/api/cmdb/sync/')) scheduleCmdbCloudSync()
    return result
  }
  throw new Error('Cmdb 原生请求通道不可用')
}

export async function importFile(path, options = {}) {
  const bridge = resolveBridge()
  if (typeof bridge?.cmdbImportFile !== 'function') {
    throw new Error('Cmdb 原生导入通道不可用')
  }
  const result = await bridge.cmdbImportFile({ path, commit: !!options.commit, token: options.token })
  if (options.commit) scheduleCmdbCloudSync()
  return result
}

export async function exportFile(path, suggestedName) {
  const bridge = resolveBridge()
  if (typeof bridge?.cmdbExportFile !== 'function') {
    throw new Error('Cmdb 原生导出通道不可用')
  }
  return bridge.cmdbExportFile({ path, suggestedName })
}

export async function uploadFile(path, file) {
  const bridge = resolveBridge()
  if (typeof bridge?.cmdbUploadFile !== 'function') {
    throw new Error('Cmdb 原生附件通道不可用')
  }
  if (file) {
    if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} 不能超过 50 MiB`)
    return bridge.cmdbUploadFile({ path, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
  }
  return bridge.cmdbUploadFile({ path })
}

export async function nativeStatus() {
  const bridge = resolveBridge()
  if (typeof bridge?.cmdbStatus !== 'function') throw new Error('Cmdb 原生状态通道不可用')
  const status = await bridge.cmdbStatus()
  if (!status?.available) {
    throw new Error([status?.error || 'Cmdb 服务未启动', status?.logPath].filter(Boolean).join('；'))
  }
  return status
}
