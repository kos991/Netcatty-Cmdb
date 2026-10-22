import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_HARDWARE_PRESETS, HARDWARE_PRESET_STORAGE_KEY, addHardwarePreset, hardwarePresetLabel, readHardwarePresets, removeHardwarePreset, saveHardwarePresets } from './hardwarePresetModel.js'
import { composeHardwareField, createHardwareDraft, editHardwareDraft } from './hardwareFieldModel.js'

const memoryStorage = () => {
  const data = new Map()
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value)) }
}

test('未保存过时使用内置常用预设，保存后按字段独立读写', () => {
  const storage = memoryStorage()
  assert.equal(readHardwarePresets(storage, 'cpu_info').length, DEFAULT_HARDWARE_PRESETS.cpu_info.length)
  const custom = addHardwarePreset('disk_info', readHardwarePresets(storage, 'disk_info'), { count: '6', capacity: '2.5', unit: 'PB', medium: 'U.2', note: 'RAID 6' })
  saveHardwarePresets(storage, 'disk_info', custom)
  assert.equal(hardwarePresetLabel('disk_info', readHardwarePresets(storage, 'disk_info')[0]), '6 × 2.5 PB U.2')
  assert.equal(readHardwarePresets(storage, 'cpu_info').length, DEFAULT_HARDWARE_PRESETS.cpu_info.length)
  assert.equal(JSON.parse(storage.getItem(HARDWARE_PRESET_STORAGE_KEY)).disk_info[0].note, undefined)
})

test('删空的预设不会被默认值恢复，重复与不完整分项被拒绝', () => {
  const storage = memoryStorage()
  saveHardwarePresets(storage, 'memory_mb', [])
  assert.deepEqual(readHardwarePresets(storage, 'memory_mb'), [])
  assert.throws(() => addHardwarePreset('cpu_info', [], { count: '2', model: '' }), /不完整/)
  const list = addHardwarePreset('memory_mb', addHardwarePreset('memory_mb', [], { amount: '16', unit: 'GB' }), { amount: '16', unit: 'GB' })
  assert.equal(list.length, 1)
  assert.deepEqual(removeHardwarePreset('memory_mb', list, '16 GB'), [])
})

test('应用预设保留补充说明；无法拆分的旧原文不被预设静默覆盖', () => {
  const recognized = createHardwareDraft('disk_info', '2 × 960 GB SSD / RAID 1')
  const applied = editHardwareDraft('disk_info', { ...recognized, parts: { ...recognized.parts, count: '4', capacity: '4', unit: 'TB', medium: 'SAS' } }, null, null)
  assert.equal(applied.source, '4 × 4 TB SAS / RAID 1')
  const original = '启动盘：双盘镜像；数据盘见原工单'
  const legacy = createHardwareDraft('disk_info', original)
  const draft = editHardwareDraft('disk_info', { ...legacy, parts: { ...legacy.parts, capacity: '1', unit: 'TB', medium: 'SSD' } }, null, null)
  assert.equal(draft.source, original)
  assert.equal(composeHardwareField('disk_info', draft.parts), '1 TB SSD')
})
