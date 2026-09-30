import assert from 'node:assert/strict'
import test from 'node:test'
import {
  managementIPFromInterfaces,
  infrastructureSavePayload,
  prepareInfrastructureEditorValues,
  saveInfrastructureDraftPhotos,
} from './infrastructureEditorModel.js'
import * as addressModel from './infrastructureEditorModel.js'

test('业务接口重排和无地址接口不推导管理 IP', () => {
  const values = prepareInfrastructureEditorValues({ interfaces: [{ name: '业务口', ip: '10.0.0.8' }, { name: '空口', ip: '' }] })
  assert.equal(values.mgmt_ip || '', '')
  assert.equal(infrastructureSavePayload(values).mgmt_ip, '')
  assert.equal(values.interfaces.some(item => item.is_primary), false)
})

test('旧数据仅明确标记主接口时保留管理地址', () => {
  const values = prepareInfrastructureEditorValues({ interfaces: [{ name: '业务口', ip: '10.0.0.8' }, { name: '管理口', ip: '10.0.0.1', is_primary: 1 }] })
  assert.equal(values.mgmt_ip, '10.0.0.1')
  assert.equal(infrastructureSavePayload(values).mgmt_ip, '10.0.0.1')
  assert.deepEqual(addressModel.networkAddressRows({ interfaces: values.interfaces.map(item => ({ ...item, purpose: 'business' })) }).find(row => row.ip === '10.0.0.1').purposes, ['管理'])
})

test('同接口附加地址保留用途且相同 IP 只展示一次', () => {
  const values = { mgmt_ip: '10.0.0.1', biz_ip: '10.0.0.1', interfaces: [{ name: 'eth0', ip: '10.0.0.1', purpose: 'business', additional_ips_json: '[{"ip":"10.0.0.2","purpose":"out_of_band"},{"ip":"10.0.0.3","purpose":"business"},{"ip":"10.0.0.2","purpose":"out_of_band"}]' }] }
  const payload = infrastructureSavePayload(values)
  assert.equal(payload.interfaces[0].additional_ips_json, '[{"ip":"10.0.0.2","purpose":"out_of_band"},{"ip":"10.0.0.3","purpose":"business"}]')
})

test('地址清单合并管理与业务用途并保留接口上下文', () => {
  const rows = addressModel.networkAddressRows({ mgmt_ip: '10.0.0.1', biz_ip: '10.0.0.1', interfaces: [{ id: 7, name: 'eth0', ip: '10.0.0.1', purpose: 'business', network_zone: '内网', mask: '24', vlan_id: 100, additional_ips_json: '[{"ip":"10.0.0.2","purpose":"out_of_band"}]' }] })
  assert.deepEqual(rows.map(row => [row.ip, row.purposes, row.interfaceName, row.networkZone]), [
    ['10.0.0.1', ['管理', '业务'], 'eth0', '内网'],
    ['10.0.0.2', ['带外'], 'eth0', '内网'],
  ])
})

test('主地址与附加地址同 IP 时保留不同用途且只展示一行', () => {
  const asset = { mgmt_ip: '10.0.0.1', interfaces: [{ id: 7, name: 'eth0', ip: '10.0.0.1', is_primary: 1, additional_ips_json: '[{"ip":"10.0.0.1","purpose":"out_of_band"}]' }] }
  const saved = infrastructureSavePayload(asset)
  assert.equal(saved.interfaces[0].additional_ips_json, '[{"ip":"10.0.0.1","purpose":"out_of_band"}]')
  assert.deepEqual(addressModel.networkAddressRows(saved).map(row => [row.ip, row.purposes]), [['10.0.0.1', ['管理', '带外']]])
})

test('两条附加地址同 IP 不同用途归并并可编辑', () => {
  const value = '[{"ip":"10.0.0.2","purpose":"business"},{"ip":"10.0.0.2","purpose":"out_of_band"}]'
  const saved = infrastructureSavePayload({ interfaces: [{ name: 'eth0', additional_ips_json: value }] })
  assert.equal(saved.interfaces[0].additional_ips_json, '[{"ip":"10.0.0.2","purpose":["business","out_of_band"]}]')
  assert.deepEqual(addressModel.additionalEditorRows(saved.interfaces[0].additional_ips_json), [
    { ip: '10.0.0.2', purpose: 'business' }, { ip: '10.0.0.2', purpose: 'out_of_band' },
  ])
  assert.deepEqual(addressModel.networkAddressRows(saved).map(row => [row.ip, row.purposes]), [['10.0.0.2', ['业务', '带外']]])
})

test('附加地址旧数据无效时解析给出可见的接口错误', () => {
  assert.throws(() => addressModel.additionalEditorRows('{bad', 'eth0'), /接口 eth0.*附加地址格式无效/)
  assert.throws(() => addressModel.networkAddressRows({ interfaces: [{ name: 'eth0', additional_ips_json: '{bad' }] }), /接口 eth0.*附加地址格式无效/)
})

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

test('旧业务主接口不得覆盖明确管理地址，清空管理字段不会依赖接口顺序', () => {
  const record = { source_type: 'legacy_server', mgmt_ip: '10.20.30.8', manage_ip: '10.20.30.8', interfaces: [{ id: 19, ip: '10.20.30.21', is_primary: 1 }] }
  const values = prepareInfrastructureEditorValues(record)
  assert.equal(values.device_type, 'server')
  assert.equal(values.mgmt_ip, '10.20.30.8')
  assert.equal(values.interfaces.find(i => i.id === 19).is_primary, 0)
  assert.equal(record.interfaces[0].is_primary, 1)
  assert.equal(infrastructureSavePayload(values).mgmt_ip, '10.20.30.8')
  assert.deepEqual([infrastructureSavePayload({ ...values, mgmt_ip: '', interfaces: [] }).mgmt_ip, infrastructureSavePayload({ ...values, mgmt_ip: '', interfaces: [] }).manage_ip], ['', ''])
})

test('型号库无匹配或存在重复项时不伪造模型关联', () => {
  const record = { model_id: 0, vendor: 'H3C', model: 'S6520X', interfaces: [] }

  assert.equal(prepareInfrastructureEditorValues(record, []).model_id, 0)
  assert.equal(prepareInfrastructureEditorValues(record, [
    { id: 7, vendor: 'H3C', model: 'S6520X' },
    { id: 9, vendor: 'H3C', model: 'S6520X' },
  ]).model_id, 0)
})

test('只有管理 IP 的旧资产保持独立管理字段且不造接口', () => {
  const values = prepareInfrastructureEditorValues({ mgmt_ip: '10.20.30.2', interfaces: [] }, [])

  assert.deepEqual(values.interfaces, [])
  assert.equal(values.mgmt_ip, '10.20.30.2')
})

test('管理 IP 始终由主接口派生且没有主接口时清空', () => {
  const interfaces = [
    { name: '业务口', ip: '10.20.30.8', is_primary: 0 },
    { name: '管理口', ip: '10.20.30.2', is_primary: 1 },
  ]

  assert.equal(managementIPFromInterfaces(interfaces), '10.20.30.2')
  assert.equal(managementIPFromInterfaces([{ name: '业务口', ip: '10.20.30.8', is_primary: 0 }]), '')
})
