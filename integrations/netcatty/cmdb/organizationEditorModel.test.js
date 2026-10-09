import test from 'node:test'
import assert from 'node:assert/strict'

import * as model from './organizationEditorModel.js'
const rows = [
  { id: 1, parent_id: 0, node_type: 'organization', name: '机关' },
  { id: 2, parent_id: 1, node_type: 'department', name: '办公室' },
  { id: 3, parent_id: 2, node_type: 'group', name: '一组' },
  { id: 4, parent_id: 0, node_type: 'organization', name: '办事处' },
  { id: 5, parent_id: 4, node_type: 'department', name: '办公室' },
]

test('上级选择只允许对应层级，重名部门带上组织路径', () => {
  assert.equal(typeof model.organizationParentOptions, 'function')
  assert.deepEqual(model.organizationParentOptions(rows, 'organization'), [{ value: 0, label: '顶级组织' }])
  assert.deepEqual(model.organizationParentOptions(rows, 'group'), [
    { value: 0, label: '请选择上级部门' },
    { value: 2, label: '机关 / 办公室' },
    { value: 5, label: '办事处 / 办公室' },
  ])
})

test('组织保存沿用原有字段，根组织不携带上级，名称去空格', () => {
  assert.equal(typeof model.organizationEditorPayload, 'function')
  assert.deepEqual(model.organizationEditorPayload({ name: '  新组织 ', node_type: 'organization', parent_id: 2, sort_order: '4' }, rows), {
    name: '新组织', node_type: 'organization', parent_id: 0, sort_order: 4,
  })
})

test('保存时拒绝空名称、错误上级和无效排序，不向接口发送错误数据', () => {
  assert.equal(typeof model.organizationEditorPayload, 'function')
  assert.throws(() => model.organizationEditorPayload({ name: ' ', node_type: 'organization' }, rows), /名称/)
  assert.throws(() => model.organizationEditorPayload({ name: '部门', node_type: 'department', parent_id: 2 }, rows), /上级/)
  assert.throws(() => model.organizationEditorPayload({ name: '分组', node_type: 'group', parent_id: 0 }, rows), /上级/)
  assert.throws(() => model.organizationEditorPayload({ name: '节点', node_type: 'organization', sort_order: -1 }, rows), /排序/)
})

test('引用人员按节点 ID 计数，不将同名部门的人员混在一起', () => {
  assert.equal(typeof model.organizationPersonCount, 'function')
  const people = [
    { org_id: 1, department_id: 2, group_id: 3 },
    { org_id: 1, department_id: 2, group_id: 0 },
    { org_id: 4, department_id: 5, group_id: 0 },
  ]
  assert.equal(model.organizationPersonCount(rows[0], people), 2)
  assert.equal(model.organizationPersonCount(rows[1], people), 2)
  assert.equal(model.organizationPersonCount(rows[2], people), 1)
  assert.equal(model.organizationPersonCount(rows[4], people), 1)
  assert.equal(model.organizationPersonCount({ id: 0, node_type: 'organization' }, people), 0)
})

test('组织改名或移动后，已选人员筛选跟随节点 ID 更新完整归属', () => {
  assert.equal(typeof model.organizationSelectionForNode, 'function')
  const tree = [{ id: 4, name: '办事处', children: [{ id: 2, name: '综合办公室', children: [{ id: 3, name: '一组' }] }] }]
  assert.deepEqual(model.organizationSelectionForNode(tree, 3), { org_name: '办事处', department: '综合办公室', group_name: '一组' })
  assert.deepEqual(model.organizationSelectionForNode(tree, 2), { org_name: '办事处', department: '综合办公室' })
  assert.deepEqual(model.organizationSelectionForNode(tree, 999), {})
})

test('编辑人员时混合字符串与数值组织 ID 仍能回填完整有效级联', () => {
  assert.equal(typeof model.organizationPersonEditorPath, 'function')
  const tree = [{ id: '1', children: [{ id: 2, children: [{ id: '3' }] }] }]
  assert.deepEqual(model.organizationPersonEditorPath({ org_id: 1, department_id: '2', group_id: 3 }, tree), {
    org_id: 1,
    department_id: 2,
    group_id: 3,
  })
})
