import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { requestJson, uploadFile } from './transport.js'

test('设置窗口写入后同时通知本窗口和主窗口执行云同步', async () => {
  const previousWindow = globalThis.window
  const previousStorage = globalThis.localStorage
  const events = []
  const messages = []
  globalThis.localStorage = { getItem: () => JSON.stringify({ enabled: true }) }
  globalThis.window = {
    dispatchEvent(event) { events.push(event.type) },
    netcatty: {
      cmdbRequest: async () => ({ ok: true }),
      notifySettingsChanged(payload) { messages.push(payload) },
    },
  }
  try {
    await requestJson('/api/cmdb/config/network-types', { method: 'POST', body: '{}' })
    await delay(850)
    assert.deepEqual(events, ['netcatty:cmdb-cloud-sync-request'])
    assert.equal(messages[0]?.key, 'netcatty.cmdb.cloudSync.request')
  } finally {
    globalThis.window = previousWindow
    globalThis.localStorage = previousStorage
  }
})

test('附件上传成功后安排一次云同步以补传刚上传的附件', async () => {
  const previousWindow = globalThis.window
  const previousStorage = globalThis.localStorage
  const events = []
  const messages = []
  globalThis.localStorage = { getItem: () => JSON.stringify({ enabled: true }) }
  globalThis.window = {
    dispatchEvent(event) { events.push(event.type) },
    netcatty: {
      async cmdbUploadFile(payload) {
        assert.equal(payload.path, '/api/cmdb/work-orders/2/attachments')
        assert.equal(payload.fileName, '验收.txt')
        return { id: 3, cancelled: false }
      },
      notifySettingsChanged(payload) { messages.push(payload) },
    },
  }
  try {
    const result = await uploadFile('/api/cmdb/work-orders/2/attachments', {
      name: '验收.txt',
      size: 1,
      arrayBuffer: async () => Uint8Array.of(65).buffer,
    })
    assert.deepEqual(result, { id: 3, cancelled: false })
    await delay(850)
    assert.deepEqual(events, ['netcatty:cmdb-cloud-sync-request'])
    assert.equal(messages[0]?.key, 'netcatty.cmdb.cloudSync.request')
  } finally {
    globalThis.window = previousWindow
    globalThis.localStorage = previousStorage
  }
})
