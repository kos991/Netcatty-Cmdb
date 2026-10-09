import test from 'node:test'
import assert from 'node:assert/strict'
import { peopleCreateMenuItems } from './peopleToolbarModel.js'

test('新增人员下拉同时提供人员创建和组织架构维护入口', () => {
  assert.deepEqual(peopleCreateMenuItems(), [
    { key: 'create-person', label: '新增人员' },
    { key: 'organization-maintenance', label: '维护组织架构' },
  ])
})
