import test from 'node:test'
import assert from 'node:assert/strict'
import { MODULES, SUBMODULES, resolveSearchTarget, panelKeyFor, resolveIPFocus, buildPersonTree } from './cmdbWorkspaceState.js'

test('固定六入口及基础管理、运维分析子页签', () => {
  assert.deepEqual(MODULES.map((item) => item.key), ['search', 'assets', 'infrastructure', 'systems', 'base', 'operations'])
  assert.deepEqual(SUBMODULES.base.map((item) => item.key), ['people', 'ip'])
  assert.deepEqual(SUBMODULES.operations.map((item) => item.key), ['dashboard', 'audit'])
})

for (const [tableKey, module, submodule] of [
  ['assets', 'assets'], ['cmdb_assets', 'infrastructure'], ['server_apps', 'systems'],
  ['persons', 'base', 'people'], ['asset_logs', 'operations', 'audit'], ['ip_pool', 'base', 'ip'],
]) {
  test(`全局查询 ${tableKey} 保留精确详情目标`, () => {
    const focusTarget = { tableKey, id: 7 }
    assert.deepEqual(resolveSearchTarget(focusTarget), { module, ...(submodule ? { submodule } : {}), focusTarget })
  })
}

test('子页签使用独立面板键，未知搜索类型不误跳转', () => {
  assert.equal(panelKeyFor('search', 'people', 'dashboard'), 'search')
  assert.equal(panelKeyFor('base', 'ip', 'dashboard'), 'base:ip')
  assert.equal(panelKeyFor('operations', 'people', 'audit'), 'operations:audit')
  assert.equal(resolveSearchTarget({ tableKey: 'unknown', id: 1 }), null)
})

test('IP 导航成功消费后，汇总和地址刷新不再次打开旧目标', () => {
  const target = { tableKey: 'ip_pool', id: 7, subtitle: '一段' }
  const subnets = [{ subnet: '一段' }, { subnet: '二段' }]
  const entry = { id: 7, subnet: '一段', ip: '10.0.1.7' }
  assert.deepEqual(resolveIPFocus(target, null, subnets, []), { subnet: '一段', entry: null })
  assert.deepEqual(resolveIPFocus(target, null, subnets, [entry]), { subnet: '一段', entry })
  assert.equal(resolveIPFocus(target, target, [...subnets], [{ ...entry }]), null)
  assert.deepEqual(resolveIPFocus({ ...target }, target, subnets, [entry]), { subnet: '一段', entry })
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
