import assert from 'node:assert/strict'
import test from 'node:test'
import { composeHardwareField, createHardwareDraft, editHardwareDraft, memoryAmountToMB, parseHardwareField, reconcileHardwareDraft, validateHardwareDraft, validateHardwareScalar } from './hardwareFieldModel.js'

test('任意 CPU 型号与整数数量组合，磁盘 PB 和原 RAID 说明无损保留', () => {
  assert.equal(composeHardwareField('cpu_info', { count: '3', model: '自定义 CPU 9876', note: '' }), '3 × 自定义 CPU 9876')
  assert.deepEqual(parseHardwareField('cpu_info', '3 × 自定义 CPU 9876').parts, { count: '3', model: '自定义 CPU 9876', note: '' })
  const original = '6 × 2.5 PB U.2 / RAID 6；保留热备 / 控制器说明'
  const draft = createHardwareDraft('disk_info', original)
  assert.equal(draft.recognized, true)
  assert.equal(composeHardwareField('disk_info', draft.parts), original)
  const changed = editHardwareDraft('disk_info', draft, 'capacity', '3.25')
  assert.equal(changed.source, '6 × 3.25 PB U.2 / RAID 6；保留热备 / 控制器说明')
})

test('内存按 1024 精确换算，不取整、不溢出、不丢失 JSON 整数精度', () => {
  assert.equal(memoryAmountToMB('1.5', 'TB'), 1572864)
  assert.equal(memoryAmountToMB('0.0009765625', 'GB'), 1)
  assert.equal(memoryAmountToMB('2.5', 'PB'), 2684354560)
  assert.throws(() => memoryAmountToMB('0.1', 'GB'), /整数 MB/)
  assert.throws(() => memoryAmountToMB('9223372036854775808'), /int64/)
  assert.throws(() => memoryAmountToMB('9007199254740993'), /无损/)
  assert.throws(() => memoryAmountToMB('-1'), /非负/)
  assert.throws(() => memoryAmountToMB('Infinity'), /非负/)
  assert.throws(() => validateHardwareScalar('memory_mb', '16384'), /整数 MB/)
  assert.equal(typeof composeHardwareField('memory_mb', { amount: '1.5', unit: 'TB' }), 'number')
})

test('无法拆分的旧配置在填写分项和重渲染时保留，只有明确替换才覆盖', () => {
  const original = '启动盘：双盘镜像；数据盘混合 SAS 与 U.2，见原工单'
  let draft = createHardwareDraft('disk_info', original)
  assert.equal(draft.recognized, false)
  for (const [part, value] of Object.entries({ count: '6', capacity: '2.5', unit: 'PB', medium: '自定义 U.2', note: 'RAID 6' })) draft = editHardwareDraft('disk_info', draft, part, value)
  assert.equal(draft.source, original)
  assert.equal(reconcileHardwareDraft('disk_info', draft, original), draft)
  draft = editHardwareDraft('disk_info', draft, null, null, true)
  assert.equal(draft.source, '6 × 2.5 PB 自定义 U.2 / RAID 6')
  assert.equal(draft.recognized, true)
})

test('外部采集优先呈现新原值，保留此前分项草稿且之后可以继续组合编辑', () => {
  let draft = createHardwareDraft('disk_info', '2 × 1 TB SATA / RAID 1')
  draft = editHardwareDraft('disk_info', draft, 'capacity', '')
  assert.equal(draft.source, '2 × 1 TB SATA / RAID 1')
  assert.throws(() => validateHardwareDraft('disk_info', draft, draft.source), /有效的单盘容量/)
  const collected = '6 × 2.5 PB U.2 / SSH 原 RAID 6'
  draft = reconcileHardwareDraft('disk_info', draft, collected)
  assert.equal(draft.source, collected)
  assert.equal(draft.parts.note, 'SSH 原 RAID 6')
  assert.equal(draft.previous.parts.capacity, '')
  assert.equal(draft.previous.parts.note, 'RAID 1')
  draft = editHardwareDraft('disk_info', draft, 'count', '7')
  assert.equal(draft.source, '7 × 2.5 PB U.2 / SSH 原 RAID 6')
})

test('未修改原字段的值与类型保持，隐藏再显示使用相同草稿', () => {
  for (const [key, value] of [['memory_mb', 0], ['memory_mb', 1572864], ['vcpu', 13], ['cpu_info', '未知 CPU 原文'], ['disk_info', '原始混合磁盘配置']]) {
    const draft = createHardwareDraft(key, value)
    assert.equal(draft.source, value)
    assert.equal(reconcileHardwareDraft(key, draft, value), draft)
  }
  assert.equal(composeHardwareField('vcpu', { count: '13' }), 13)
  assert.throws(() => composeHardwareField('vcpu', { count: '1.5' }), /整数/)
  assert.throws(() => composeHardwareField('cpu_info', { count: '1.5', model: '任意型号' }), /正整数/)
})

test('数值原文编辑错误保持可见且阻止提交，修正分项后清除原文错误', () => {
  const original = { ...createHardwareDraft('memory_mb', 16384), rawText: '1.5', rawError: '原始内存必须为整数 MB' }
  assert.throws(() => validateHardwareDraft('memory_mb', original, 16384), /整数 MB/)
  const fixed = editHardwareDraft('memory_mb', original, 'amount', '32')
  assert.equal(fixed.source, 32768)
  assert.equal(fixed.rawError, '')
  assert.equal(fixed.rawText, undefined)
})

test('未知原文经外部回填仍可取回完整旧文本，数值原文草稿不被丢弃', () => {
  const original = '控制器记录：混合盘组，容量待核验'
  const collected = reconcileHardwareDraft('disk_info', createHardwareDraft('disk_info', original), '6 × 2.5 PB U.2 / RAID 6')
  assert.equal(collected.previous.source, original)
  const invalid = { ...createHardwareDraft('memory_mb', 16384), rawText: '1.5', rawError: '必须为整数 MB' }
  const updated = reconcileHardwareDraft('memory_mb', invalid, 32768)
  assert.equal(updated.previous.source, 16384)
  assert.equal(updated.previous.rawText, '1.5')
  assert.equal(updated.parts.amount, '32')
})
