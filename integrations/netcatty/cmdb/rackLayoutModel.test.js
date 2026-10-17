import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRackLayout, defaultRack, rackCabinets, rackDeviceChanges, rackDeviceValues, rackKey, rackLocationIdentity, rackLocationName, rackPlacementError, rackRooms, rackUnitsError } from './rackLayoutModel.js'
import { supportsInfrastructurePhotos } from './state.js'

test('机柜按 U 位自上而下排布，多 U 设备合并为一行', () => {
  const layout = buildRackLayout([
    { id: 1, name: '交换机', start_u: 4, height_u: 1 },
    { id: 2, name: '服务器', start_u: 1, height_u: 2 },
  ], 4)
  assert.deepEqual(layout.rows.map((row) => [row.type, row.unit, row.height, row.asset?.id]), [
    ['device', 4, 1, 1],
    ['empty', 3, 1, undefined],
    ['device', 2, 2, 2],
  ])
  assert.equal(layout.usedUnits, 3)
})

test('未填 U 位、越界和重叠设备不进入机柜图', () => {
  const layout = buildRackLayout([
    { id: 1, start_u: 2, height_u: 2 },
    { id: 2, start_u: 3, height_u: 1 },
    { id: 3, start_u: 4, height_u: 2 },
    { id: 4 },
  ], 4)
  assert.deepEqual(layout.unplaced.map((item) => item.id), [4])
  assert.deepEqual(layout.conflicts.map((item) => item.id).sort(), [2, 3])
  assert.equal(layout.usedUnits, 2)
})

test('机柜内调整设备 U 位时拦截越界与重叠，忽略设备自身原位置', () => {
  const assets = [{ id: 1, name: '核心交换机', start_u: 10, height_u: 2 }, { id: 2, name: '服务器', start_u: 20, height_u: 1 }]
  assert.equal(rackPlacementError(assets, 1, 11, 2, 42), '')
  assert.equal(rackPlacementError(assets, 2, 11, 1, 42), '与 核心交换机 的 U 位重叠')
  assert.equal(rackPlacementError(assets, 2, 42, 2, 42), '设备占用到 43U，超出机柜 42U')
  assert.equal(rackPlacementError(assets, 2, 0, 1, 42), '')
  assert.equal(rackUnitsError(assets, 20), '')
  assert.equal(rackUnitsError(assets, 19), '已有设备占用到 20U，机柜不能小于 20U')
})

test('机柜身份包含机房，qualified 位置目录提供高度并保留空机柜', () => {
  const cabinets = rackCabinets([
    { id: 1, name: '核心交换机', data_center: '一楼机房', cabinet_name: 'A1', start_u: 1, height_u: 2 },
    { id: 2, name: '服务器', data_center: '二楼机房', cabinet_name: 'A1', start_u: 45, height_u: 2 },
    { id: 3, name: '存储', data_center: '二楼机房', cabinet_name: 'A1' },
  ], [
    { name: '一楼机房 (A1)', rack_units: 24 },
    { name: '二楼机房 (A1)', rack_units: 47 },
    { name: '二楼机房 (B1)', rack_units: 42 },
    { name: '三楼机房', rack_units: 0 },
  ])
  assert.deepEqual(cabinets.map(({ room, name, totalUnits, deviceCount, usedUnits, unplacedCount }) => [room, name, totalUnits, deviceCount, usedUnits, unplacedCount]), [
    ['二楼机房', 'A1', 47, 2, 2, 1],
    ['二楼机房', 'B1', 42, 0, 0, 0],
    ['一楼机房', 'A1', 24, 1, 2, 0],
  ].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN', { numeric: true }) || left[1].localeCompare(right[1], 'zh-CN', { numeric: true })))
  assert.notEqual(rackKey({ data_center: '一楼机房', cabinet_name: 'A1' }), rackKey({ data_center: '二楼机房', cabinet_name: 'A1' }))
  assert.equal(rackLocationName('二楼机房', 'A1'), '二楼机房 (A1)')
  assert.equal(rackLocationName('', 'A1'), 'A1')
})

test('仅登记机房的设备归入未分配机柜，未知机房独立，旧组合字段不在前端重解析', () => {
  const cabinets = rackCabinets([
    { id: 1, data_center: '2楼数据中心机房' },
    { id: 2, data_center: '科技法庭核心机房' },
    { id: 3, cabinet_pos: '2楼数据中心机房 (1-1机柜)' },
    { id: 4, data_center: '数据中心机房', cabinet_row: 1, cabinet_col: 2 },
    { id: 5, cabinet_name: 'A1', start_u: 1 },
  ])
  assert.equal(cabinets.length, 5)
  assert.equal(cabinets.find((item) => item.room === '2楼数据中心机房').unassigned, true)
  assert.deepEqual(cabinets.find((item) => item.room === '' && item.unassigned).devices.map((item) => item.id), [3])
  assert.equal(cabinets.find((item) => item.room === '数据中心机房').name, '')
  assert.equal(cabinets.find((item) => item.name === 'A1').roomLabel, '未登记机房')
  assert.equal(cabinets.some((item) => item.name.includes('2楼数据中心')), false)
})

test('机柜总览按实体照片判定排除虚拟资源，保留实体设备及空机房空机柜', () => {
  const assets = [
    { id: 1, device_type: 'server', data_center: '机房', cabinet_name: 'A1', start_u: 1 },
    { id: 2, device_type: 'storage', data_center: '机房' },
    { id: 3, device_type: 'switch', data_center: '机房', cabinet_name: 'A1', start_u: 2 },
    { id: 4, device_type: 'virtual_machine', data_center: '机房' },
    { id: 5, category_name: '云资源', data_center: '机房', cabinet_name: 'A1', start_u: 3 },
    { id: 6, asset_class: 'virtual', device_type: '自定义类型' },
    { id: 7, device_type: 'ecs' },
  ]
  const cabinets = rackCabinets(assets.filter(supportsInfrastructurePhotos), [
    { name: '空机房', location_type: 'room', data_center: '空机房' },
    { name: '机房 (A2)', location_type: 'cabinet', data_center: '机房', cabinet_name: 'A2', rack_units: 24 },
  ])
  assert.deepEqual(cabinets.flatMap((cabinet) => cabinet.devices.map((asset) => asset.id)).sort(), [1, 2, 3])
  assert.deepEqual(cabinets.find((cabinet) => cabinet.room === '机房' && cabinet.unassigned).devices.map((asset) => asset.id), [2])
  assert.equal(cabinets.find((cabinet) => cabinet.name === 'A1').usedUnits, 2)
  assert.equal(cabinets.find((cabinet) => cabinet.name === 'A2').deviceCount, 0)
  assert.equal(cabinets.find((cabinet) => cabinet.name === 'A2').totalUnits, 24)
  assert.equal(rackRooms(cabinets).some((room) => room.key === '空机房'), true)
})

test('树搜索保留机房层级：机房命中显示该机房全部机柜，设备与 IP 命中只显示所属机柜', () => {
  const cabinets = rackCabinets([
    { id: 1, data_center: '一楼机房', cabinet_name: 'A1', name: '核心交换机', asset_code: 'CORE-001', mgmt_ip: '10.0.0.1' },
    { id: 2, data_center: '一楼机房', cabinet_name: 'A2', name: '服务器' },
    { id: 3, data_center: '一楼机房', name: '待分配存储' },
    { id: 4, data_center: '二楼机房', cabinet_name: 'A1', name: '接入交换机' },
  ])
  assert.equal(rackRooms(cabinets, '一楼机房')[0].cabinets.length, 3)
  for (const keyword of ['核心', 'CORE-001', '10.0.0.1']) {
    const rooms = rackRooms(cabinets, keyword)
    assert.equal(rooms.length, 1)
    assert.equal(rooms[0].name, '一楼机房')
    assert.deepEqual(rooms[0].cabinets.map((item) => item.name), ['A1'])
  }
  assert.equal(rackRooms(cabinets, '不存在').length, 0)
})

test('默认选择实际上架设备最多的机柜，不选大量机房未分配设备或 U 使用量最大项', () => {
  const cabinets = rackCabinets([
    ...Array.from({ length: 12 }, (_, index) => ({ id: index + 1, data_center: '机房' })),
    { id: 20, data_center: '机房', cabinet_name: 'A1', start_u: 1, height_u: 8 },
    { id: 21, data_center: '机房', cabinet_name: 'A2', start_u: 1, height_u: 1 },
    { id: 22, data_center: '机房', cabinet_name: 'A2', start_u: 2, height_u: 1 },
    { id: 23, data_center: '机房', cabinet_name: 'A2', start_u: 2, height_u: 1 },
  ])
  assert.equal(defaultRack(cabinets).name, 'A2')
  assert.equal(defaultRack(cabinets).placedCount, 2)
  assert.equal(defaultRack([]), null)
})

test('点击顶层空 U 不静默钳制，多 U 设备越界必须返回错误，0 可下架', () => {
  assert.equal(rackPlacementError([], 1, 47, 2, 47), '设备占用到 48U，超出机柜 47U')
  assert.equal(rackPlacementError([], 1, 0, 2, 47), '')
  assert.equal(rackPlacementError([], 1, 1.5, 1, 47), '起始 U 位无效')
  assert.equal(rackPlacementError([], 1, 1, 1.5, 47), '占用 U 数需在 1-60 之间')
  const layout = buildRackLayout([{ id: 1, start_u: -1 }, { id: 2, start_u: 1.5 }, { id: 3, start_u: 1, height_u: 1.5 }], 47)
  assert.equal(layout.conflicts.length, 3)
  assert.equal(layout.usedUnits, 0)
})

test('自由输入的机房与机柜按完整 qualified 名称匹配高度，不重解析资产值', () => {
  const cabinets = rackCabinets([{ id: 1, data_center: '机房（东区）', cabinet_name: 'A (测试柜)', start_u: 45 }], [{ name: '机房（东区） (A (测试柜))', rack_units: 47 }])
  assert.equal(cabinets.length, 1)
  assert.equal(cabinets[0].name, 'A (测试柜)')
  assert.equal(cabinets[0].totalUnits, 47)
  assert.equal(cabinets[0].placedCount, 1)
})

test('显式空机房持久目录可选但不冒充机柜，显式身份不解析名称', () => {
  const cabinets = rackCabinets([], [
    { id: 1, name: '东区 (测试)', location_type: 'room', data_center: '东区 (测试)', cabinet_name: '', rack_units: 0 },
    { id: 2, name: '其他显示名称', location_type: 'cabinet', data_center: '南区', cabinet_name: 'A (1)', rack_units: 24 },
  ])
  const room = cabinets.find((item) => item.room === '东区 (测试)')
  assert.equal(room.unassigned, true)
  assert.equal(room.name, '')
  assert.equal(room.deviceCount, 0)
  assert.equal(room.roomLocation.id, 1)
  assert.deepEqual(rackLocationIdentity({ location_type: 'cabinet', data_center: '南区', cabinet_name: 'A (1)', name: '其他显示名称' }), { data_center: '南区', cabinet_name: 'A (1)' })
  assert.equal(cabinets.find((item) => item.room === '南区').totalUnits, 24)
  assert.equal(rackRooms(cabinets).length, 2)
})

test('设备编辑只产生实际变更字段，不覆盖隐藏资料或接口', () => {
  const asset = { id: 5, name: '服务器', asset_code: 'SRV-01', vendor: '品牌', model: '旧型号', mgmt_ip: '10.0.0.1', data_center: '东区', cabinet_name: 'A1', start_u: 3, height_u: 2, sn: '保留', interfaces: [{ id: 9 }], group_id: 7 }
  const values = rackDeviceValues(asset)
  assert.deepEqual(rackDeviceChanges(asset, values), {})
  assert.deepEqual(rackDeviceChanges(asset, { ...values, model: '新型号', mgmt_ip: '10.0.0.2', start_u: '4' }), { model: '新型号', mgmt_ip: '10.0.0.2', start_u: 4 })
  assert.deepEqual(rackDeviceChanges(asset, { ...values, start_u: 0 }), { start_u: 0 })
  assert.equal('interfaces' in values, false)
  assert.equal('group_id' in values, false)
})

test('设备跨机柜上架按目标机柜数据校验，同名柜按机房隔离', () => {
  const cabinets = rackCabinets([
    { id: 1, name: '当前设备', data_center: '东区', cabinet_name: 'A1', start_u: 20, height_u: 2 },
    { id: 2, name: '目标设备', data_center: '西区', cabinet_name: 'A1', start_u: 10, height_u: 2 },
  ], [{ location_type: 'cabinet', name: '西区 (A1)', data_center: '西区', cabinet_name: 'A1', rack_units: 12 }])
  const target = cabinets.find((item) => item.room === '西区')
  assert.equal(rackPlacementError(target.devices, 1, 10, 2, target.totalUnits), '与 目标设备 的 U 位重叠')
  assert.equal(rackPlacementError(target.devices, 1, 12, 2, target.totalUnits), '设备占用到 13U，超出机柜 12U')
  assert.equal(rackPlacementError(target.devices, 1, 1, 2, target.totalUnits), '')
})

test('高度编辑在 1–60U 内保留原设备 U 位，拒绝挤出设备且不计算未上架高度', () => {
  const devices = [
    { id: 1, name: '顶部服务器', start_u: 39, height_u: 4 },
    { id: 2, name: '交换机', start_u: 28, height_u: 2 },
    { id: 3, name: '待上架', start_u: 0, height_u: 60 },
  ]
  const original = structuredClone(devices)
  assert.equal(rackUnitsError(devices, 42), '')
  assert.equal(rackUnitsError(devices, 60), '')
  assert.equal(rackUnitsError(devices, 41), '已有设备占用到 42U，机柜不能小于 42U')
  for (const units of [0, 61, 42.5, NaN]) assert.equal(rackUnitsError(devices, units), '机柜 U 数需在 1-60 之间')
  const expanded = buildRackLayout(devices, 60)
  assert.deepEqual(expanded.placed.map(({ asset, start, top }) => [asset.id, start, top]), [[2, 28, 29], [1, 39, 42]])
  assert.equal(expanded.usedUnits, 6)
  assert.equal(expanded.totalUnits - expanded.usedUnits, 54)
  assert.deepEqual(devices, original)
  assert.equal(rackUnitsError([{ id: 4, start_u: 0, height_u: 60 }], 1), '')
})

test('高度缩小校验也保护当前重叠冲突设备的最高占用位置', () => {
  const devices = [{ id: 1, start_u: 20, height_u: 2 }, { id: 2, start_u: 21, height_u: 4 }]
  assert.equal(buildRackLayout(devices, 42).conflicts.length, 1)
  assert.equal(rackUnitsError(devices, 23), '已有设备占用到 24U，机柜不能小于 24U')
  assert.equal(rackUnitsError(devices, 24), '')
})
