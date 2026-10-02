import assert from 'node:assert/strict'
import test from 'node:test'
import { readAssetFilterSelection, saveAssetFilterSelection, removeAssetFilter } from './assetFilterModel.js'

const options = ['device_type', 'group_id', 'dept', 'status', 'include_archived']
const defaults = ['device_type', 'group_id', 'dept', 'status', 'include_archived']

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('首次进入保留现有筛选，保存后可选择零到全部字段且各页面独立', () => {
  const storage = memoryStorage()
  assert.deepEqual(readAssetFilterSelection(storage, 'terminals', options, defaults), defaults)
  saveAssetFilterSelection(storage, 'terminals', [])
  saveAssetFilterSelection(storage, 'systems', ['status'])
  assert.deepEqual(readAssetFilterSelection(storage, 'terminals', options, defaults), [])
  assert.deepEqual(readAssetFilterSelection(storage, 'systems', options, defaults), ['status'])
  saveAssetFilterSelection(storage, 'terminals', options)
  assert.deepEqual(readAssetFilterSelection(storage, 'terminals', options, defaults), options)
})

test('损坏或过期的本地筛选配置回退并忽略不可用字段', () => {
  const storage = memoryStorage()
  storage.setItem('cmdb.asset-filters.terminals', '{bad')
  assert.deepEqual(readAssetFilterSelection(storage, 'terminals', options, defaults), defaults)
  storage.setItem('cmdb.asset-filters.terminals', JSON.stringify(['status', 'old_field', 'status']))
  assert.deepEqual(readAssetFilterSelection(storage, 'terminals', options, defaults), ['status'])
})

test('移除筛选项同时清空其查询值，其他筛选及关键词保持不变', () => {
  assert.deepEqual(removeAssetFilter(['device_type', 'status'], 'status', { status: '在用', device_type: '台式机', keyword: '核心' }), {
    visible: ['device_type'], filters: { status: '', device_type: '台式机', keyword: '核心' },
  })
})
