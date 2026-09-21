function resolveBridge() {
  return globalThis.window?.netcatty
}

export async function requestJson(path, options = {}) {
  const bridge = resolveBridge()
  const method = options.method || 'GET'
  if (typeof bridge?.cmdbRequest === 'function') {
    return bridge.cmdbRequest({ path, method, body: options.body })
  }
  throw new Error('Cmdb 原生请求通道不可用')
}

export async function importFile(path, options = {}) {
  const bridge = resolveBridge()
  if (typeof bridge?.cmdbImportFile !== 'function') {
    throw new Error('Cmdb 原生导入通道不可用')
  }
  return bridge.cmdbImportFile({ path, commit: !!options.commit, token: options.token })
}

export async function exportFile(path, suggestedName) {
  const bridge = resolveBridge()
  if (typeof bridge?.cmdbExportFile !== 'function') {
    throw new Error('Cmdb 原生导出通道不可用')
  }
  return bridge.cmdbExportFile({ path, suggestedName })
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
