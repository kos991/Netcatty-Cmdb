import test from 'node:test'
import assert from 'node:assert/strict'
import * as workOrderModel from './workOrderStatsModel.js'
import { summarizeWorkOrders } from './workOrderStatsModel.js'

test('工单统计按当前查询结果汇总总量、流程阶段和本月已完成', () => {
  assert.deepEqual(summarizeWorkOrders([
    { status: '新建' },
    { status: '已分配' },
    { status: '处理中' },
    { status: '已关闭', actual_time: '2026-10-08 09:30:00' },
    { status: '已解决', actual_time: '2026-10-01T08:00:00' },
    { status: '已关闭', actual_time: '2026-09-30 23:59:59' },
    { status: '已取消' },
    { status: '已取消', actual_time: '2026-10-08 10:00:00' },
  ], new Date(2026, 9, 8)), { total: 8, new: 2, processing: 1, resolved: 1, closed: 2, cancelled: 2, completedThisMonth: 2 })
})

test('工单统计容忍空列表和缺失状态', () => {
  assert.deepEqual(summarizeWorkOrders([{}, null], new Date(2026, 9, 8)), { total: 2, new: 0, processing: 0, resolved: 0, closed: 0, cancelled: 0, completedThisMonth: 0 })
})

test('完成时间为空或格式无效时不计入本月完成', () => {
  assert.deepEqual(summarizeWorkOrders([
    { status: '已关闭' },
    { status: '已解决', actual_time: 'not-a-date' },
    { status: '已关闭', actual_time: '2026-99-33 10:00:00' },
  ], new Date(2026, 9, 8)), { total: 3, new: 0, processing: 0, resolved: 1, closed: 2, cancelled: 0, completedThisMonth: 0 })
})

test('工单流程统计按新建、处理中、已解决、已关闭阶段汇总，并兼容已分配旧状态', () => {
  assert.deepEqual(summarizeWorkOrders([
    { status: '新建' },
    { status: '已分配' },
    { status: '处理中' },
    { status: '已解决', actual_time: '2026-10-08 09:30:00' },
    { status: '已关闭', actual_time: '2026-10-01T08:00:00' },
    { status: '已取消' },
    { status: '未知旧状态' },
  ], new Date(2026, 9, 8)), {
    total: 7,
    new: 2,
    processing: 1,
    resolved: 1,
    closed: 1,
    cancelled: 1,
    completedThisMonth: 2,
  })
})

test('工单状态只允许沿新建、处理中、已解决、已关闭顺序前进', () => {
  assert.equal(typeof workOrderModel.getNextWorkOrderStatus, 'function')
  assert.equal(workOrderModel.getNextWorkOrderStatus('新建'), '处理中')
  assert.equal(workOrderModel.getNextWorkOrderStatus('已分配'), '处理中')
  assert.equal(workOrderModel.getNextWorkOrderStatus('处理中'), '已解决')
  assert.equal(workOrderModel.getNextWorkOrderStatus('已解决'), '已关闭')
  assert.equal(workOrderModel.getNextWorkOrderStatus('已关闭'), '')
  assert.equal(workOrderModel.getNextWorkOrderStatus('已取消'), '')
})

test('编辑工单只能保留当前状态、进入下一阶段或取消，不能跨阶段', () => {
  assert.equal(typeof workOrderModel.getEditableWorkOrderStatuses, 'function')
  assert.deepEqual(workOrderModel.getEditableWorkOrderStatuses('新建'), ['新建', '处理中', '已取消'])
  assert.deepEqual(workOrderModel.getEditableWorkOrderStatuses('处理中'), ['处理中', '已解决', '已取消'])
  assert.deepEqual(workOrderModel.getEditableWorkOrderStatuses('已解决'), ['已解决', '已关闭', '已取消'])
  assert.deepEqual(workOrderModel.getEditableWorkOrderStatuses('已关闭'), ['已关闭'])
  assert.deepEqual(workOrderModel.getEditableWorkOrderStatuses('已取消'), ['已取消'])
})

test('批量关闭只接受全部处于已解决阶段的工单', () => {
  assert.equal(typeof workOrderModel.canBulkCloseWorkOrders, 'function')
  const rows = [
    { id: 1, status: '已解决' },
    { id: 2, status: '处理中' },
    { id: 3, status: '已关闭' },
  ]
  assert.equal(workOrderModel.canBulkCloseWorkOrders(rows, [1]), true)
  assert.equal(workOrderModel.canBulkCloseWorkOrders(rows, [1, 2]), false)
  assert.equal(workOrderModel.canBulkCloseWorkOrders(rows, [1, 99]), false)
  assert.equal(workOrderModel.canBulkCloseWorkOrders(rows, []), false)
})
