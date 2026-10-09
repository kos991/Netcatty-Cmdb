import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { requestJson } from './transport.js'

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
