import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCmdbAssetEditPayload } from './cmdbAssetFormState.js'

test('编辑 payload 包含表单全部可编辑字段并保留清空值', () => {
  const payload = buildCmdbAssetEditPayload(
    {
      name: '新设备名称',
      device_type: 'network',
      status: '在线',
      department: '',
      owner: '',
      owner_id: 0,
      org_id: 0,
      group_id: 12,
      category_id: 13,
      data_center: '',
      floor: '2F',
      cabinet_name: 'B02',
      remark: '',
      custom_fields: {},
    },
    { device_type: 'server' },
  )

  assert.deepEqual(payload, {
    name: '新设备名称',
    device_type: 'network',
    status: '在线',
    department: '',
    owner: '',
    owner_id: 0,
    org_id: 0,
    group_id: 12,
    category_id: 13,
    data_center: '',
    floor: '2F',
    cabinet_name: 'B02',
    remark: '',
    custom_fields: {},
  })
})

test('编辑 payload 在类型未填写时沿用当前资源类型', () => {
  const payload = buildCmdbAssetEditPayload(
    { name: '设备', status: '在库' },
    { device_type: 'storage' },
  )

  assert.equal(payload.device_type, 'storage')
  assert.equal(payload.name, '设备')
})
