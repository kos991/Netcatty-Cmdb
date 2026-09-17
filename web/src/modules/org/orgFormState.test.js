import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOrgNavigationTree,
  fromOrgPath,
  orgTreeToCascader,
  toOrgPath,
} from './orgFormState.js'

test('人员记录与组织级联路径按三级 ID 往返转换', () => {
  assert.deepEqual(toOrgPath({ org_id: 1, department_id: 2, group_id: 3 }), [1, 2, 3])
  assert.deepEqual(toOrgPath({ org_id: 1, department_id: 2, group_id: 0 }), [1, 2])
  assert.deepEqual(fromOrgPath([1, 2, 3]), { org_id: 1, department_id: 2, group_id: 3 })
  assert.deepEqual(fromOrgPath([1, 2]), { org_id: 1, department_id: 2, group_id: 0 })
})

test('组织树转换为 Cascader 选项并保留无人员节点', () => {
  const tree = [{
    id: 1,
    name: '总公司',
    node_type: 'organization',
    children: [
      { id: 2, name: '技术部', node_type: 'department', children: [{ id: 3, name: '运维组', node_type: 'group', children: [] }] },
      { id: 4, name: '空部门', node_type: 'department', children: [] },
    ],
  }]

  assert.deepEqual(orgTreeToCascader(tree), [{
    value: 1,
    label: '总公司',
    children: [
      { value: 2, label: '技术部', children: [{ value: 3, label: '运维组' }] },
      { value: 4, label: '空部门' },
    ],
  }])

  const navigation = buildOrgNavigationTree(tree, [
    { org_id: 1, department_id: 2, group_id: 3 },
    { org_id: 1, department_id: 2, group_id: 0 },
  ])
  assert.equal(navigation[0].title, '全部人员 (2)')
  assert.equal(navigation[1].title, '总公司 (2)')
  assert.equal(navigation[1].children[0].title, '技术部 (2)')
  assert.equal(navigation[1].children[0].children[0].title, '运维组 (1)')
  assert.equal(navigation[1].children[1].title, '空部门 (0)')
})
