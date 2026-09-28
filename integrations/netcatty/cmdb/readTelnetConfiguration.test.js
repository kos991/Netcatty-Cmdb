import test from 'node:test'
import assert from 'node:assert/strict'
import { readTelnetConfiguration } from './readTelnetConfiguration.js'

test('Telnet 等待提示符、处理分页并按序读取，完整结束后关闭会话', async () => {
  let data
  let closed = false
  const writes = []
  const bridge = {
    onSessionData: (_id, callback) => { data = callback; return () => {} },
    onSessionExit: () => () => {},
    startTelnetSession: async () => { queueMicrotask(() => data('<SW>')) },
    writeToSession: (_id, command) => {
      writes.push(command)
      queueMicrotask(() => data(command === 'display version\r' ? 'Version 7\r\n<SW>' : command === ' ' ? ' shutdown\r\n#\r\n<SW>' : 'sysname SW\r\ninterface GE1/0/1\r\n---- More ----'))
    },
    closeSession: async () => { closed = true },
  }
  const output = await readTelnetConfiguration(bridge, { hostname: '192.0.2.1' }, 'admin', '', ['display version', 'display current-configuration'])
  assert.deepEqual(writes, ['display version\r', 'display current-configuration\r', ' '])
  assert.match(output, /shutdown/)
  assert.equal(closed, true)
})

test('Telnet 提前断线明确失败，不把半截输出当成成功', async () => {
  let data
  let exit
  const bridge = {
    onSessionData: (_id, callback) => { data = callback; return () => {} },
    onSessionExit: (_id, callback) => { exit = callback; return () => {} },
    startTelnetSession: async () => { queueMicrotask(() => { data('<SW>'); exit() }) },
    writeToSession: () => {},
    closeSession: async () => {},
  }
  await assert.rejects(readTelnetConfiguration(bridge, {}, '', '', ['display current-configuration']), /提前结束/)
})
