import test from 'node:test'
import assert from 'node:assert/strict'
import { subnetSelectorItems } from './ipamLayoutModel.js'

test('网段选择器保留名称、CIDR、VLAN/VXLAN 和使用率摘要', () => {
  assert.deepEqual(subnetSelectorItems([
    { subnet: '核心网', name: '核心网', cidr: '10.20.30.0/24', vlan: '120', vni: '10120', usage_rate: 25 },
  ]), [{
    value: '核心网',
    label: '核心网',
    description: '10.20.30.0/24 · VLAN 120 · VNI 10120 · 使用率 25%',
  }])
})

test('缺失字段不拼出多余分隔符', () => {
  assert.deepEqual(subnetSelectorItems([{ subnet: '办公网', cidr: '192.0.2.0/24' }]), [{
    value: '办公网',
    label: '办公网',
    description: '192.0.2.0/24 · 使用率 0%',
  }])
})
