import test from 'node:test'
import assert from 'node:assert/strict'
import {
  infrastructureLocationPresentation,
  infrastructureNetworkSummary,
  infrastructureNamePresentation,
  infrastructureNetworkZoneOptions,
} from './infrastructureTableModel.js'

test('基础设施身份展示以名称为主并在摘要中显示资产编码和 SN', () => {
  assert.deepEqual(infrastructureNamePresentation({ name: '核心服务器', asset_code: 'INFRA-001', sn: 'SN-001' }), {
    name: '核心服务器',
    secondary: 'INFRA-001 · SN：SN-001',
  })
  assert.deepEqual(infrastructureNamePresentation({ name: '备用服务器', asset_code: 'INFRA-002' }), {
    name: '备用服务器',
    secondary: 'INFRA-002 · 未配置 SN',
  })
  assert.deepEqual(infrastructureNamePresentation({ name: '核心交换机', asset_code: '' }), {
    name: '核心交换机',
    secondary: '未配置编码 / SN',
  })
})

test('基础设施网络摘要区分管理、业务和外网地址', () => {
  assert.deepEqual(infrastructureNetworkSummary({
    mgmt_ip: '10.20.10.10',
    net_type: '内网',
    biz_ip: '172.16.10.10',
    public_ip: '203.0.113.10',
  }), {
    management: { ip: '10.20.10.10', zone: '内网' },
    secondary: [
      { ip: '172.16.10.10', purpose: '业务', zone: '未配置' },
      { ip: '203.0.113.10', purpose: '公网', zone: '外网' },
    ],
    hasMultipleNetworks: true,
  })
})

test('管理 IP 的网络标识优先读取匹配管理接口的真实网络区域', () => {
  assert.deepEqual(infrastructureNetworkSummary({
    mgmt_ip: '10.20.10.10',
    interfaces: [{ ip: '10.20.10.10', network_zone: '设备管理网' }],
  }), {
    management: { ip: '10.20.10.10', zone: '设备管理网' },
    secondary: [],
    hasMultipleNetworks: false,
  })
})

test('网络区域选项同时覆盖内网、外网、专网和现有历史值', () => {
  assert.deepEqual(infrastructureNetworkZoneOptions(['管理网', '自定义区域']), [
    '管理网', '自定义区域', '内网', '外网', '专网', '隔离网', '业务网', '带外 (OOB)', '未分类',
  ])
})

test('基础设施位置优先展示房间并组合机房、楼层、机柜和 U 位', () => {
  assert.deepEqual(infrastructureLocationPresentation({
    device_type: 'server',
    room: '东区机房 301',
    data_center: '常州中院数据中心',
    floor: '3 楼',
    cabinet_name: 'A01',
    cabinet_row: '2 排',
    cabinet_col: 3,
    start_u: 10,
    height_u: 2,
  }), {
    primary: '东区机房 301',
    secondary: '常州中院数据中心 · 3 楼 · A01 · 2 排 / 3 列 · 10U–11U',
  })
})

test('位置摘要兼容旧字段并避免重复展示相同地点', () => {
  assert.deepEqual(infrastructureLocationPresentation({
    room: '一楼机房',
    data_center: '一楼机房',
    area: '一楼机房',
    cabinet_pos: 'B08',
    u_start: 20,
    u_height: 1,
  }), {
    primary: '一楼机房',
    secondary: 'B08 · 20U',
  })
})

test('未配置实体位置与虚拟资源使用明确的空值语义', () => {
  assert.deepEqual(infrastructureLocationPresentation({ device_type: 'server' }), {
    primary: '未配置位置',
    secondary: '',
  })
  assert.deepEqual(infrastructureLocationPresentation({ device_type: 'virtual_machine' }), {
    primary: '无实体位置',
    secondary: '',
  })
})
