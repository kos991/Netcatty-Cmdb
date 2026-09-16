import assert from 'node:assert/strict'
import test from 'node:test'

import {
  exportFile,
  hasNativeCmdbImportBridge,
  importFile,
  requestJson,
} from './cmdbTransport.js'

test('native request uses Netcatty bridge', async () => {
  const calls = []
  const bridge = {
    cmdbRequest: async (payload) => {
      calls.push(payload)
      return { ok: true }
    },
  }

  const result = await requestJson('/api/health', {}, { bridge, fetchImpl: null })

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, [{ path: '/api/health', method: 'GET', body: undefined }])
})

test('browser request surfaces response error text', async () => {
  const fetchImpl = async () => new globalThis.Response('数据库忙', { status: 500 })

  await assert.rejects(
    requestJson('/api/assets', {}, { bridge: null, fetchImpl }),
    /数据库忙/,
  )
})

test('native import reuses the preview token on commit', async () => {
  const calls = []
  const bridge = {
    cmdbImportFile: async (payload) => {
      calls.push(payload)
      return { imported: 1, token: payload.token }
    },
  }

  const result = await importFile(
    '/api/cmdb/assets/import',
    { commit: true, token: 'preview-token' },
    { bridge, fetchImpl: null },
  )

  assert.deepEqual(result, { imported: 1, token: 'preview-token' })
  assert.deepEqual(calls, [{
    path: '/api/cmdb/assets/import',
    commit: true,
    token: 'preview-token',
  }])
})

test('native import bridge selects the direct file dialog flow', () => {
  assert.equal(hasNativeCmdbImportBridge({ cmdbImportFile: async () => {} }), true)
  assert.equal(hasNativeCmdbImportBridge({ cmdbRequest: async () => {} }), false)
  assert.equal(hasNativeCmdbImportBridge(null), false)
})

test('import reports an unavailable request channel', async () => {
  await assert.rejects(
    importFile(
      '/api/import/sangfor',
      { file: 'spreadsheet' },
      { bridge: null, fetchImpl: null },
    ),
    /CMDB 请求通道不可用/,
  )
})

test('native export keeps the filtered path', async () => {
  const calls = []
  const bridge = {
    cmdbExportFile: async (payload) => {
      calls.push(payload)
      return { cancelled: false }
    },
  }

  const result = await exportFile(
    '/api/export/assets?dept=信息中心',
    'czfy_assets.xlsx',
    { bridge, fetchImpl: null },
  )

  assert.deepEqual(result, { cancelled: false })
  assert.deepEqual(calls, [{
    path: '/api/export/assets?dept=信息中心',
    suggestedName: 'czfy_assets.xlsx',
  }])
})

test('export reports an unavailable request channel', async () => {
  await assert.rejects(
    exportFile(
      '/api/export/assets',
      'czfy_assets.xlsx',
      { bridge: null, fetchImpl: null },
    ),
    /CMDB 请求通道不可用/,
  )
})
