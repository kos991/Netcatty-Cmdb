import assert from 'node:assert/strict'
import test from 'node:test'

import { DIRECTORY_CHANGE_KEY, broadcastDirectoryChange, listenDirectoryChanges } from './directorySync.js'

test('设置窗口保存目录后主窗口收到通知且无关设置不触发刷新', () => {
  let sent
  let listener
  let reloads = 0
  const bridge = {
    notifySettingsChanged(payload) { sent = payload },
    onSettingsChanged(callback) { listener = callback; return () => { listener = null } },
  }
  const unsubscribe = listenDirectoryChanges(bridge, () => { reloads++ })
  broadcastDirectoryChange(bridge)
  assert.equal(sent.key, DIRECTORY_CHANGE_KEY)
  listener({ key: 'ui.theme', value: 'dark' })
  assert.equal(reloads, 0)
  listener(sent)
  assert.equal(reloads, 1)
  unsubscribe()
  assert.equal(listener, null)
})
