import test from 'node:test'
import assert from 'node:assert/strict'
import * as workspaceState from './cmdbWorkspaceState.js'

const { MODULES, resolveSearchTarget, panelKeyFor, resolveIPFocus, buildPersonTree } = workspaceState

test('固定五个 Cmdb 一级入口并默认以设备资产开始', () => {
  assert.deepEqual(MODULES.map(({ key, label, icon }) => ({ key, label, icon })), [
    { key: 'assets', label: '设备资产', icon: 'Monitor' },
    { key: 'people', label: '组织架构', icon: 'Users' },
    { key: 'ip', label: 'IPAM/IP', icon: 'Network' },
    { key: 'operations', label: '统计与履历', icon: 'ChartNoAxesCombined' },
    { key: 'config', label: '配置中心', icon: 'Settings2' },
  ])
})

for (const [tableKey, module, assetTab] of [
  ['assets', 'assets', 'terminals'],
  ['cmdb_assets', 'assets', 'infrastructure'],
  ['server_apps', 'assets', 'systems'],
  ['servers', 'assets', 'systems'],
  ['persons', 'people'],
  ['asset_logs', 'operations'],
  ['ip_pool', 'ip'],
]) {
  test(`关联导航 ${tableKey} 保留精确详情目标`, () => {
    const focusTarget = { tableKey, id: 7 }
    assert.deepEqual(resolveSearchTarget(focusTarget), { module, ...(assetTab ? { assetTab } : {}), focusTarget })
  })
}

test('每个一级入口使用独立面板键，未知搜索类型不误跳转', () => {
  assert.equal(panelKeyFor('assets'), 'assets')
  assert.equal(panelKeyFor('people'), 'people')
  assert.equal(panelKeyFor('operations'), 'operations')
  assert.equal(resolveSearchTarget({ tableKey: 'unknown', id: 1 }), null)
})

test('设备资产搜索只保留终端、基础设施和业务系统结果', () => {
  const results = [
    { tableKey: 'assets', id: 1 },
    { tableKey: 'cmdb_assets', id: 2 },
    { tableKey: 'server_apps', id: 3 },
    { tableKey: 'persons', id: 4 },
    { tableKey: 'asset_logs', id: 5 },
    { tableKey: 'ip_pool', id: 6 },
  ]
  assert.deepEqual(workspaceState.filterDeviceAssetResults?.(results), results.slice(0, 3))
})

test('IP 导航成功消费后，汇总和地址刷新不再次打开旧目标', () => {
  const target = { tableKey: 'ip_pool', id: 7, subtitle: '一段' }
  const subnets = [{ subnet: '一段' }, { subnet: '二段' }]
  const entry = { id: 7, subnet: '一段', ip: '10.0.1.7' }
  assert.deepEqual(resolveIPFocus(target, null, subnets, [], { subnet: '一段', status: 'loading' }), { subnet: '一段', entry: null, consumed: false })
  assert.deepEqual(resolveIPFocus(target, null, subnets, [entry], { subnet: '一段', status: 'ready' }), { subnet: '一段', entry, consumed: true })
  assert.equal(resolveIPFocus(target, target, [...subnets], [{ ...entry }]), null)
  assert.deepEqual(resolveIPFocus({ ...target }, target, subnets, [entry], { subnet: '一段', status: 'ready' }), { subnet: '一段', entry, consumed: true })
})

test('IP 未命中也消费导航，切网段刷新不回退，同内容新事件可再尝试', () => {
  const target = { id: 7, subtitle: '一段' }
  const subnets = [{ subnet: '一段' }, { subnet: '二段' }]
  const result = resolveIPFocus(target, null, subnets, [], { subnet: '一段', status: 'ready' })
  assert.deepEqual(result, { subnet: '一段', entry: null, consumed: true })
  const consumed = result.consumed ? target : null
  assert.equal(resolveIPFocus(target, consumed, subnets, [], { subnet: '二段', status: 'ready' }), null)
  assert.deepEqual(resolveIPFocus({ ...target }, consumed, subnets, [], { subnet: '二段', status: 'ready' }), { subnet: '一段', entry: null, consumed: false })
})

test('IP 请求失败消费导航且不使用旧数据，等待目标网段加载时不提前查找', () => {
  const target = { id: 7, subtitle: '一段' }
  const subnets = [{ subnet: '一段' }]
  const oldEntries = [{ id: 7, subnet: '一段' }]
  assert.deepEqual(resolveIPFocus(target, null, subnets, oldEntries, { subnet: '一段', status: 'error' }), { subnet: '一段', entry: null, consumed: true })
  assert.deepEqual(resolveIPFocus(target, null, subnets, oldEntries, { subnet: '二段', status: 'ready' }), { subnet: '一段', entry: null, consumed: false })
})

test('组织根节点包含空组织人员，精确节点只使用非空原始组织和部门', () => {
  const nodes = buildPersonTree([
    { org_name: '', department: '技术处' }, { org_name: null, department: '' },
    { org_name: '真实组织', department: '' }, { org_name: '真实组织', department: '技术处' },
    { org_name: '总机构', department: '未分配部门' },
  ])
  assert.deepEqual(nodes[0], { key: 'all', title: '全部人员 (5)' })
  assert.equal(nodes.length, 3)
  assert.deepEqual(JSON.parse(nodes[1].key), { org_name: '真实组织' })
  assert.equal(nodes[1].title, '真实组织 (2)')
  assert.equal(nodes[1].children.length, 1)
  assert.deepEqual(JSON.parse(nodes[1].children[0].key), { org_name: '真实组织', department: '技术处' })
  assert.deepEqual(JSON.parse(nodes[2].children[0].key), { org_name: '总机构', department: '未分配部门' })
})
