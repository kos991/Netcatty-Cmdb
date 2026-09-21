import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAsset, resolveSearchTarget } from './state.js'
import { requestJson, importFile, exportFile, nativeStatus } from './transport.js'

test('普通设备清除物理终端 IP，云桌面保留双 IP 和网络类型', () => {
  const values = { device_type: '台式电脑', ip: '192.0.2.1', terminal_ip: '192.0.2.2', net_type: '内网', remark: '保持原资料' }
  assert.deepEqual(normalizeAsset(values), { ...values, terminal_ip: '' })
  assert.equal(values.terminal_ip, '192.0.2.2')
  assert.deepEqual(normalizeAsset({ ...values, device_type: '云桌面盒子' }), { ...values, device_type: '云桌面盒子' })
})

test('未知设备类型保持未分类并保留历史数据，不自动臆造云桌面分类', () => {
  assert.deepEqual(normalizeAsset({ device_type: '', terminal_ip: '192.0.2.2' }), { device_type: '', terminal_ip: '192.0.2.2' })
})

test('关联导航落到准确的资产子页，保留原始记录 ID', () => {
  const result = { tableKey: 'server_apps', id: 42 }
  assert.deepEqual(resolveSearchTarget(result), { module: 'assets', assetTab: 'systems', focusTarget: result })
  assert.equal(resolveSearchTarget({ tableKey: 'unknown' }), null)
})

test('原生通道失败明确报错，导入提交保留预览令牌，导出保留取消状态', async () => {
  const previous = globalThis.window
  try {
    globalThis.window = {}
    await assert.rejects(requestJson('/api/assets'), /原生请求通道不可用/)
    await assert.rejects(nativeStatus(), /原生状态通道不可用/)
    let imported
    globalThis.window = { netcatty: {
      cmdbStatus: async () => ({ available: false, error: '数据库打开失败' }),
      cmdbRequest: async () => { throw new Error('服务断开') },
      cmdbImportFile: async (payload) => { imported = payload; return { created: 2 } },
      cmdbExportFile: async () => ({ cancelled: true }),
    } }
    await assert.rejects(nativeStatus(), /数据库打开失败/)
    await assert.rejects(requestJson('/api/assets'), /服务断开/)
    assert.deepEqual(await importFile('/api/cmdb/assets/import', { commit: true, token: 'preview-token' }), { created: 2 })
    assert.deepEqual(imported, { path: '/api/cmdb/assets/import', commit: true, token: 'preview-token' })
    assert.deepEqual(await exportFile('/api/export/assets', 'assets.xlsx'), { cancelled: true })
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous }
})
