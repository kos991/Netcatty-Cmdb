import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INFRASTRUCTURE_COLUMN_KEYS,
  SYSTEM_COLUMN_KEYS,
  TERMINAL_COLUMN_KEYS,
  applicationNetworkPresentation,
  normalizeGroupFilterValue,
  numericOrganizationPath,
  terminalNetworkRows,
  visibleAssetColumnKeys,
} from './assetTableModel.js'

test('三类资产将 IP 与网络分列且终端编码不再单占宽列', () => {
  assert.deepEqual(TERMINAL_COLUMN_KEYS, [
    'asset_name', 'device_type', 'owner_department', 'room', 'ip',
    'network_type', 'operating_system', 'status', 'actions',
  ])
  assert.deepEqual(INFRASTRUCTURE_COLUMN_KEYS, [
    'name', 'device_type', 'vendor_model', 'operating_system',
    'owner_department', 'location', 'management_ip', 'network_type', 'status', 'actions',
  ])
  assert.deepEqual(SYSTEM_COLUMN_KEYS, [
    'name_version', 'app_type', 'provider', 'owner', 'service_ip', 'network_type',
    'host', 'status', 'actions',
  ])
})

test('窄窗口优先保留 IP、网络、状态和操作，不让地址被横向滚动遮住', () => {
  assert.deepEqual(visibleAssetColumnKeys('terminal', 'medium'), [
    'asset_name', 'device_type', 'ip', 'network_type', 'status', 'actions',
  ])
  assert.deepEqual(visibleAssetColumnKeys('infrastructure', 'medium'), [
    'name', 'device_type', 'location', 'management_ip', 'network_type', 'status', 'actions',
  ])
  assert.deepEqual(visibleAssetColumnKeys('system', 'medium'), [
    'name_version', 'app_type', 'provider', 'service_ip', 'network_type', 'status', 'actions',
  ])
  assert.deepEqual(visibleAssetColumnKeys('terminal', 'wide'), TERMINAL_COLUMN_KEYS)
})

test('普通终端只展示设备 IP 且空网络不推断为专网', () => {
  assert.deepEqual(terminalNetworkRows({ device_type: '台式电脑', ip: '10.20.30.8' }, []), [
    { key: 'device', label: '设备 IP', ip: '10.20.30.8', networkType: '未配置' },
  ])
})

test('云桌面两个地址分别匹配 IPAM 网络且不复用主地址网络', () => {
  assert.deepEqual(terminalNetworkRows({
    device_type: '云桌面终端',
    ip: '10.20.30.10',
    terminal_ip: '172.16.8.10',
    net_type: '业务网',
  }, [
    { ip: '172.16.8.10', network_type: '终端接入网' },
  ]), [
    { key: 'business', label: '业务/虚拟机 IP', ip: '10.20.30.10', networkType: '业务网' },
    { key: 'terminal', label: '终端物理 IP', ip: '172.16.8.10', networkType: '终端接入网' },
  ])
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
