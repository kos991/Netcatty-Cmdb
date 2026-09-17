import test from 'node:test'
import assert from 'node:assert/strict'
import { MODULES, resolveSearchTarget, panelKeyFor, resolveIPFocus, buildPersonTree } from './cmdbWorkspaceState.js'

test('固定八个 Cmdb 业务入口', () => {
  assert.deepEqual(MODULES.map((item) => item.key), [
    'search', 'assets', 'infrastructure', 'systems', 'people', 'ip', 'operations', 'config',
  ])
})

for (const [tableKey, module] of [
  ['assets', 'assets'], ['cmdb_assets', 'infrastructure'], ['server_apps', 'systems'],
  ['persons', 'people'], ['asset_logs', 'operations'], ['ip_pool', 'ip'],
]) {
  test(`全局查询 ${tableKey} 保留精确详情目标`, () => {
    const focusTarget = { tableKey, id: 7 }
    assert.deepEqual(resolveSearchTarget(focusTarget), { module, focusTarget })
  })
}

test('每个入口使用独立面板键，未知搜索类型不误跳转', () => {
  assert.equal(panelKeyFor('search'), 'search')
  assert.equal(panelKeyFor('people'), 'people')
  assert.equal(panelKeyFor('operations'), 'operations')
  assert.equal(resolveSearchTarget({ tableKey: 'unknown', id: 1 }), null)
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
