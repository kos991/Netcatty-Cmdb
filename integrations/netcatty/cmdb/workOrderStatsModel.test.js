import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeWorkOrders } from './workOrderStatsModel.js'

test('工单统计按当前查询结果汇总总量、待处理、处理中和本月已完成', () => {
  assert.deepEqual(summarizeWorkOrders([
    { status: '新建' },
    { status: '已分配' },
    { status: '处理中' },
    { status: '已关闭', actual_time: '2026-10-08 09:30:00' },
    { status: '已解决', actual_time: '2026-10-01T08:00:00' },
    { status: '已关闭', actual_time: '2026-09-30 23:59:59' },
    { status: '已取消' },
    { status: '已取消', actual_time: '2026-10-08 10:00:00' },
  ], new Date(2026, 9, 8)), { total: 8, pending: 2, processing: 1, completedThisMonth: 2 })
})

test('工单统计容忍空列表和缺失状态', () => {
  assert.deepEqual(summarizeWorkOrders([{}, null], new Date(2026, 9, 8)), { total: 2, pending: 0, processing: 0, completedThisMonth: 0 })
})

test('完成时间为空或格式无效时不计入本月完成', () => {
  assert.deepEqual(summarizeWorkOrders([
    { status: '已关闭' },
    { status: '已解决', actual_time: 'not-a-date' },
    { status: '已关闭', actual_time: '2026-99-33 10:00:00' },
  ], new Date(2026, 9, 8)), { total: 3, pending: 0, processing: 0, completedThisMonth: 0 })
})
