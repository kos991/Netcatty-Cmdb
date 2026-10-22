import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INFRASTRUCTURE_COLUMN_KEYS,
  SYSTEM_COLUMN_KEYS,
  TERMINAL_COLUMN_KEYS,
  applicationNetworkPresentation,
  normalizeGroupFilterValue,
  numericOrganizationPath,
  terminalBusinessNetworkType,
  terminalBrandFields,
  terminalHardwareFields,
  terminalNetworkRows,
  validIPv4,
  visibleAssetColumnKeys,
} from './assetTableModel.js'

test('三类资产将 IP 与网络分列并保留原型必要字段', () => {
  assert.deepEqual(TERMINAL_COLUMN_KEYS, [
    'asset_code', 'device_type', 'vendor_model', 'owner_department', 'room', 'ip',
    'network_type', 'operating_system', 'status', 'actions',
  ])
  assert.deepEqual(INFRASTRUCTURE_COLUMN_KEYS, [
    'asset_code', 'device_type', 'vendor_model', 'management_ip', 'network_type',
    'location', 'owner_department', 'status', 'actions',
  ])
  assert.deepEqual(SYSTEM_COLUMN_KEYS, [
    'name_code', 'app_type', 'version', 'host', 'access_url', 'service_ip', 'network_type',
    'owner', 'status', 'actions',
  ])
})

test('窄窗口保留完整资产列，通过表格滚动查看而不丢失原型字段', () => {
  for (const density of ['wide', 'medium', 'compact']) {
    assert.deepEqual(visibleAssetColumnKeys('terminal', density), TERMINAL_COLUMN_KEYS)
    assert.deepEqual(visibleAssetColumnKeys('infrastructure', density), INFRASTRUCTURE_COLUMN_KEYS)
    assert.deepEqual(visibleAssetColumnKeys('system', density), SYSTEM_COLUMN_KEYS)
  }
})

test('普通终端只展示设备 IP 且空网络不推断为专网', () => {
  assert.deepEqual(terminalNetworkRows({ device_type: '台式电脑', ip: '10.20.30.8' }, []), [
    { key: 'device', label: '设备 IP', ip: '10.20.30.8' },
  ])
})

test('云桌面保留业务和终端地址但网络类型只认业务 IP 的 IPAM 归属', () => {
  assert.deepEqual(terminalNetworkRows({
    device_type: '云桌面终端',
    ip: '10.20.30.10',
    terminal_ip: '172.16.8.10',
    net_type: '业务网',
  }), [
    { key: 'business', label: '业务/虚拟机 IP', ip: '10.20.30.10' },
    { key: 'terminal', label: '终端物理 IP', ip: '172.16.8.10' },
  ])
  assert.equal(terminalBusinessNetworkType({ ip_network_type: '政法专网', net_type: '外网' }), '专网')
  assert.equal(terminalBusinessNetworkType({ ip_network_type: '外网', net_type: '专网' }), '外网')
  assert.equal(terminalBusinessNetworkType({ net_type: '外网' }), '未配置')
})

test('非法业务和物理 IP 不作为地址展示', () => {
  assert.deepEqual(terminalNetworkRows({ device_type: '云桌面终端', ip: '外网', terminal_ip: '10.0.0.256' }), [])
})

test('只有台式机和笔记本提供可保存的计算硬件字段', () => {
  for (const type of ['台式机', '台式电脑', '笔记本', '笔记本电脑']) {
    assert.deepEqual(terminalHardwareFields(type).map(({ key }) => key), ['vendor', 'model', 'cpu_info', 'memory_mb', 'disk_info'])
    assert.equal(terminalHardwareFields(type).find(({ key }) => key === 'memory_mb').type, 'number')
  }
  for (const type of ['打印机', '网络打印机', '云桌面', '云盒', '']) assert.deepEqual(terminalHardwareFields(type), [])
})

test('打印机只提供品牌与型号，不提供计算硬件', () => {
  for (const type of ['打印机', '网络打印机']) {
    assert.deepEqual(terminalBrandFields(type).map(({ key }) => key), ['vendor', 'model'])
  }
  assert.deepEqual(terminalBrandFields('云桌面'), [])
  assert.deepEqual(terminalBrandFields(''), [])
})

test('终端连接入口只接受完整有效的已填写 IPv4 地址', () => {
  for (const ip of ['10.0.0.1', ' 192.168.1.2 ', '255.255.255.255']) assert.equal(validIPv4(ip), true)
  for (const ip of ['', '外网', '10.0.0', '10.0.0.256', 'https://10.0.0.1', '10.0.0.-1']) assert.equal(validIPv4(ip), false)
  assert.deepEqual(terminalNetworkRows({ device_type: '云桌面', ip: '10.0.0.256', terminal_ip: '' }), [])
})

test('业务系统只展示自身业务 IP 的真实网络', () => {
  assert.deepEqual(applicationNetworkPresentation({
    service_ip: '192.168.20.5',
    network_type: '专网',
    port: '8443',
  }), { ip: '192.168.20.5', networkType: '专网', port: '8443' })
  assert.deepEqual(applicationNetworkPresentation({ service_ip: '192.168.20.6' }), {
    ip: '192.168.20.6', networkType: '未配置', port: '',
  })
  assert.deepEqual(applicationNetworkPresentation({ server_biz_ip: '192.168.20.7' }), {
    ip: '', networkType: '未配置', port: '',
  })
})

test('人员组织路径统一为数值 ID', () => {
  assert.deepEqual(numericOrganizationPath({ org_id: '3', department_id: '8', group_id: '' }), {
    org_id: 3,
    department_id: 8,
    group_id: 0,
  })
})

test('未分组筛选保留负一语义', () => {
  assert.equal(normalizeGroupFilterValue('-1'), -1)
  assert.equal(normalizeGroupFilterValue('12'), 12)
  assert.equal(normalizeGroupFilterValue(''), '')
})

test('凭据文本在展示层脱敏但保留账号', async () => {
  const { maskCredentialText, maskCredentialFields } = await import('./assetTableModel.js')
  assert.equal(maskCredentialText('admin/Czcourt@6288'), 'admin/******')
  assert.equal(maskCredentialText('root@192.168.0.1'), 'root@192.168.0.1')
  assert.equal(maskCredentialText('密码：Abc123'), '密码：******')
  assert.equal(maskCredentialText(''), '')
  assert.deepEqual(maskCredentialFields({ owner: 'admin/Admin@1234', name: '系统' }, ['owner']), { owner: 'admin/******', name: '系统' })
})

test('系统网络展示不从承载或管理字段回填，缺自身地址时无网络类型', () => {
  assert.equal(applicationNetworkPresentation({
    service_ip: '192.0.2.8', network_type: '专网', server_network_type: '外网', net_type: '内网',
  }).networkType, '专网')
  assert.equal(applicationNetworkPresentation({
    server_biz_ip: '192.0.2.9', server_network_type: '外网', network_type: '专网',
  }).networkType, '未配置')
  assert.equal(applicationNetworkPresentation({
    service_ip: '192.0.2.8', server_network_type: '外网', net_type: '内网',
  }).networkType, '未配置')
})

test('已配置的自定义网络分类保留原名，只有缺失来源才标记未配置', () => {
  assert.equal(applicationNetworkPresentation({ service_ip: '192.0.2.10', network_type: '测试专线' }).networkType, '测试专线')
  assert.equal(applicationNetworkPresentation({ service_ip: '192.0.2.10' }).networkType, '未配置')
})

test('网络类型圆点使用配置颜色，缺色或未命中时回退中性灰', async () => {
  const { networkTypeColor, networkTypeDefinition } = await import('./assetTableModel.js')
  const definitions = [
    { name: '专网', color: '#2563EB' },
    { name: '外网', color: '' },
  ]
  assert.equal(networkTypeColor('专网', definitions), '#2563EB')
  assert.equal(networkTypeColor('外网', definitions), 'rgb(148 163 184)')
  assert.equal(networkTypeColor('未配置', definitions), 'rgb(148 163 184)')
  assert.equal(networkTypeColor('专网', ['专网']), 'rgb(148 163 184)')
  assert.deepEqual(networkTypeDefinition('专网', definitions), { name: '专网', color: '#2563EB' })
  assert.equal(networkTypeDefinition('', definitions), null)
})
