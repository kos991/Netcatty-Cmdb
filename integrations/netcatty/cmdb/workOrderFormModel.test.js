import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chooseWorkOrderDefault,
  includeCurrentWorkOrderValue,
  resolveWorkOrderEditValues,
} from './workOrderFormModel.js'

test('编辑工单时保留已配置目录中不存在的历史类别和运维类型', () => {
  assert.deepEqual(includeCurrentWorkOrderValue(['故障处理', '日常维护'], '验收'), ['故障处理', '日常维护', '验收'])
  assert.deepEqual(includeCurrentWorkOrderValue(['排障'], '排障'), ['排障'])
})

test('新建工单默认值采用当前配置中的首项，仍优先保留有效首选项', () => {
  assert.equal(chooseWorkOrderDefault(['验收', '维护'], '故障处理'), '验收')
  assert.equal(chooseWorkOrderDefault(['验收', '维护'], '维护'), '维护')
  assert.equal(chooseWorkOrderDefault([], '故障处理'), '')
})

test('空目录或仅含空白的目录不生成第二套默认值', () => {
  assert.equal(chooseWorkOrderDefault(undefined, 'P3（普通）'), '')
  assert.equal(chooseWorkOrderDefault([' ', ''], '排障'), '')
})

test('编辑工单用项目 ID 补回项目名称并保留现有字段', () => {
  assert.deepEqual(resolveWorkOrderEditValues({
    id: 2,
    project_id: 1,
    biz_type: '验收',
    operation_type: '联动验收',
    plan_time: '2026-10-10 16:00:00',
  }, [{ id: 1, name: 'CZZY' }]), {
    id: 2,
    project_id: 1,
    project_name: 'CZZY',
    biz_type: '验收',
    operation_type: '联动验收',
    plan_time: '2026-10-10T16:00:00',
    actual_time: '',
    priority: '',
    status: '新建',
  })
})

test('项目目录暂时没有匹配项时显示明确的项目 ID，不伪装为空项目', () => {
  assert.equal(resolveWorkOrderEditValues({ project_id: 7 }, []).project_name, '项目 #7')
})
