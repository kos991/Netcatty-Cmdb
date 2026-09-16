import test from 'node:test'
import assert from 'node:assert/strict'
import { MODULES, SUBMODULES, resolveSearchTarget, panelKeyFor } from './cmdbWorkspaceState.js'

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
