import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaxonomyTree, filterTaxonomyTree, taxonomyParentOptions } from './taxonomyModel.js'

test('分类树按排序构建层级且保留孤立节点', () => {
  const tree = buildTaxonomyTree([
    { id: 3, parent_id: 1, name: '笔记本', sort_order: 2 },
    { id: 4, parent_id: 99, name: '历史分类', sort_order: 3 },
    { id: 1, parent_id: 0, name: '办公终端', sort_order: 2 },
    { id: 2, parent_id: 1, name: '台式电脑', sort_order: 1 },
  ])

  assert.deepEqual(tree.map((node) => node.id), [1, 4])
  assert.deepEqual(tree[0].children.map((node) => node.id), [2, 3])
})

test('搜索命中子分类时保留完整父链', () => {
  const tree = buildTaxonomyTree([
    { id: 1, parent_id: 0, name: '基础设施', sort_order: 1 },
    { id: 2, parent_id: 1, name: '网络设备', sort_order: 1 },
    { id: 3, parent_id: 2, name: '核心交换机', sort_order: 1 },
    { id: 4, parent_id: 1, name: '服务器', sort_order: 2 },
  ])

  const filtered = filterTaxonomyTree(tree, '交换机')
  assert.deepEqual(filtered.map((node) => node.id), [1])
  assert.deepEqual(filtered[0].children.map((node) => node.id), [2])
  assert.deepEqual(filtered[0].children[0].children.map((node) => node.id), [3])
})

test('编辑上级选项排除当前节点及全部后代', () => {
  const rows = [
    { id: 1, parent_id: 0, name: '办公终端', sort_order: 1 },
    { id: 2, parent_id: 1, name: '电脑', sort_order: 1 },
    { id: 3, parent_id: 2, name: '台式电脑', sort_order: 1 },
    { id: 4, parent_id: 0, name: '打印设备', sort_order: 2 },
  ]

  assert.deepEqual(taxonomyParentOptions(rows, 1).map((option) => option.value), [0, 4])
  assert.deepEqual(taxonomyParentOptions(rows, 2).map((option) => option.value), [0, 1, 4])
})
