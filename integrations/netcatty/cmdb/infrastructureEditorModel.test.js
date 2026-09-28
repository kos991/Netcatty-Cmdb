import assert from 'node:assert/strict'
import test from 'node:test'
import {
  managementIPFromInterfaces,
  infrastructureSavePayload,
  prepareInfrastructureEditorValues,
  saveInfrastructureDraftPhotos,
} from './infrastructureEditorModel.js'

test('新增资产取得 ID 后只上传选中的正反面照片', async () => {
  const saved = []
  await saveInfrastructureDraftPhotos(42, { front_image: 'front-data' }, async (...args) => { saved.push(args) })
  assert.deepEqual(saved, [['infrastructure', 42, 'front', 'front-data']])
})

test('照片上传失败明确提示资产已创建而照片未完成', async () => {
  await assert.rejects(
    saveInfrastructureDraftPhotos(42, { back_image: 'back-data' }, async () => { throw new Error('磁盘写入失败') }),
    /资产已保存，但背面照片上传失败：磁盘写入失败/,
  )
})

test('已有品牌型号唯一命中型号库时自动建立模型关联', () => {
  const values = prepareInfrastructureEditorValues(
    { model_id: 0, vendor: 'H3C', model: 'S6520X', interfaces: [] },
    [
      { id: 7, vendor: 'h3c', model: 's6520x' },
      { id: 8, vendor: 'H3C', model: 'S5560X' },
    ],
  )

  assert.equal(values.model_id, 7)
})

test('旧业务主接口不得覆盖管理地址，保存和清空同步两个管理地址字段', () => {
  const record = { source_type: 'legacy_server', mgmt_ip: '10.20.30.8', manage_ip: '10.20.30.8', interfaces: [{ id: 19, ip: '10.20.30.21', is_primary: 1 }] }
  const values = prepareInfrastructureEditorValues(record)
  assert.equal(values.device_type, 'server')
  assert.equal(managementIPFromInterfaces(values.interfaces), '10.20.30.8')
  assert.equal(values.interfaces.find(i => i.id === 19).is_primary, 0)
  assert.equal(record.interfaces[0].is_primary, 1)
  assert.equal(infrastructureSavePayload(values).mgmt_ip, '10.20.30.8')
  assert.deepEqual([infrastructureSavePayload({ ...values, interfaces: [] }).mgmt_ip, infrastructureSavePayload({ ...values, interfaces: [] }).manage_ip], ['', ''])
})

test('型号库无匹配或存在重复项时不伪造模型关联', () => {
  const record = { model_id: 0, vendor: 'H3C', model: 'S6520X', interfaces: [] }

  assert.equal(prepareInfrastructureEditorValues(record, []).model_id, 0)
  assert.equal(prepareInfrastructureEditorValues(record, [
    { id: 7, vendor: 'H3C', model: 'S6520X' },
    { id: 9, vendor: 'H3C', model: 'S6520X' },
  ]).model_id, 0)
})

test('只有管理 IP 的旧资产归一化为一个可编辑的主接口', () => {
  const values = prepareInfrastructureEditorValues({ mgmt_ip: '10.20.30.2', interfaces: [] }, [])

  assert.deepEqual(values.interfaces, [{
    name: '管理口',
    if_name: '管理口',
    ip: '10.20.30.2',
    mask: '',
    gateway: '',
    mac: '',
    network_zone: '未分类',
    net_zone: '未分类',
    is_primary: 1,
    vlan_id: 0,
    remark: '',
  }])
  assert.equal(managementIPFromInterfaces(values.interfaces), '10.20.30.2')
})

test('管理 IP 始终由主接口派生且没有主接口时清空', () => {
  const interfaces = [
    { name: '业务口', ip: '10.20.30.8', is_primary: 0 },
    { name: '管理口', ip: '10.20.30.2', is_primary: 1 },
  ]

  assert.equal(managementIPFromInterfaces(interfaces), '10.20.30.2')
  assert.equal(managementIPFromInterfaces([{ name: '业务口', ip: '10.20.30.8', is_primary: 0 }]), '')
})
