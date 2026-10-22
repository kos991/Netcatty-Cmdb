import test from 'node:test'
import assert from 'node:assert/strict'
import { initialSubnetDraft, subnetSelectorGroups, subnetSelectorItems } from './ipamLayoutModel.js'

test('网段选择器保留名称、CIDR、VLAN/VXLAN 和使用率摘要', () => {
  assert.deepEqual(subnetSelectorItems([
    { id: 7, subnet: '核心网', name: '核心网', category: '管理专网', cidr: '10.20.30.0/24', vlan: '120', vni: '10120', usage_rate: 25 },
  ]), [{
    id: 7,
    value: '核心网',
    label: '核心网',
    category: '管理专网',
    description: '10.20.30.0/24 · VLAN 120 · VNI 10120 · 使用率 25%',
  }])
})

test('缺失字段不拼出多余分隔符', () => {
  assert.deepEqual(subnetSelectorItems([{ subnet: '办公网', cidr: '192.0.2.0/24' }]), [{
    id: undefined,
    value: '办公网',
    label: '办公网',
    category: '未分类',
    description: '192.0.2.0/24 · 使用率 0%',
  }])
})

test('分类和网络字段来自子网定义，使用率来自同名汇总，不猜测名称类别', () => {
  const groups = subnetSelectorGroups([
    { id: 8, name: '互联网出口', category: '专用管理网', cidr: '192.0.2.0/24', vlan: '80' },
    { id: 9, name: '第二地址池', category: '办公网', vni: '10090' },
    { id: 10, name: '未知地址池' },
  ], [{ subnet: '互联网出口', usage_rate: 42, category: '错误汇总分类', vlan: '99' }])
  assert.deepEqual(groups.map((group) => group.category), ['专用管理网', '办公网', '未分类'])
  assert.equal(groups[0].items[0].id, 8)
  assert.equal(groups[0].items[0].description, '192.0.2.0/24 · VLAN 80 · 使用率 42%')
})

test('地址池分组搜索匹配名称、CIDR、VLAN、VNI，空结果不保留分组标题', () => {
  const subnets = [{ name: '核心网', category: '专网', cidr: '10.20.30.0/24', vlan: '120', vni: '10120' }]
  for (const keyword of ['核心', '10.20.30', 'VLAN 120', 'vni 10120']) assert.equal(subnetSelectorGroups(subnets, [], keyword)[0].items[0].value, '核心网')
  assert.deepEqual(subnetSelectorGroups(subnets, [], 'missing'), [])
})

test('新增地址池始终为空表单，编辑只使用指定权威 ID 并保留全部字段', () => {
  const subnets = [
    { id: 1, name: '第一网段', category: '内网' },
    { id: 2, name: '当前网段', category: '专网', prefix: '10.20.30', sort_order: 7, remark: '保留备注' },
  ]
  const created = initialSubnetDraft(subnets, { initialCreate: true, initialSubnetID: 2 })
  assert.equal(created.name, '')
  assert.equal(created.category, '')
  assert.equal(created.id, undefined)
  const edited = initialSubnetDraft(subnets, { initialSubnetID: 2 })
  assert.deepEqual(edited, subnets[1])
  assert.notEqual(edited, subnets[1])
  assert.equal(initialSubnetDraft(subnets, { initialSubnetID: 99 }), null)
  assert.deepEqual(initialSubnetDraft(subnets), subnets[0])
})

test('地址池目录搜索保留类别和所有同类命中，不修改权威配置', () => {
  const subnets = [
    { id: 1, name: '办公一网', category: '内网', cidr: '10.0.1.0/24' },
    { id: 2, name: '办公二网', category: '内网', cidr: '10.0.2.0/24' },
    { id: 3, name: '出口', category: '外网', cidr: '192.0.2.0/28' },
  ]
  assert.deepEqual(subnetSelectorGroups(subnets, [], '内网').map(({ category, items }) => [category, items.map(({ id }) => id)]), [['内网', [1, 2]]])
  assert.deepEqual(subnetSelectorGroups(subnets, [], '192.0.2.0/28')[0].items.map(({ id }) => id), [3])
  const draft = initialSubnetDraft(subnets, { initialSubnetID: 2 })
  draft.name = '未保存名称'
  assert.equal(subnets[1].name, '办公二网')
  assert.equal(initialSubnetDraft(subnets, { initialSubnetID: 2 }).name, '办公二网')
})
