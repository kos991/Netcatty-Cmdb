import test from 'node:test'
import assert from 'node:assert/strict'
import { assetIPFields, isCloudDesktopDeviceType, normalizeAssetPayload } from './assetFormState.js'

test('只有云桌面盒子类型显示双 IP 字段', () => {
  for (const type of ['云桌面终端', '云桌面盒子', '云盒']) {
    assert.equal(isCloudDesktopDeviceType(type), true)
    assert.deepEqual(assetIPFields(type), [
      { name: 'ip', label: '业务/虚拟机 IP' },
      { name: 'terminal_ip', label: '终端物理 IP' },
    ])
  }
})

test('普通终端只显示设备 IP', () => {
  for (const type of ['', '台式电脑', '笔记本', '打印机']) {
    assert.equal(isCloudDesktopDeviceType(type), false)
    assert.deepEqual(assetIPFields(type), [{ name: 'ip', label: '设备 IP' }])
  }
})

test('保存普通终端时清空隐藏的终端物理 IP', () => {
  assert.deepEqual(normalizeAssetPayload({
    device_type: '台式电脑',
    ip: '10.0.0.10',
    terminal_ip: '192.168.0.10',
  }), {
    device_type: '台式电脑',
    ip: '10.0.0.10',
    terminal_ip: '',
  })
})

test('保存云桌面盒子时保留双 IP', () => {
  const payload = { device_type: '云桌面终端', ip: '10.0.0.10', terminal_ip: '192.168.0.10' }
  assert.deepEqual(normalizeAssetPayload(payload), payload)
})
