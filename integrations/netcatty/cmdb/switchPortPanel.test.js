import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSwitchPortPanel } from './switchPortPanel.js'

test('端口面板按自然顺序合并启停状态和已登记作用', () => {
  const result = buildSwitchPortPanel([
    { name: 'GE1/0/10', enabled: false, description: '' },
    { name: 'GE1/0/2', enabled: true, description: '虚拟化节点01', mode: 'access', vlan: '230' },
    { name: 'GE1/0/1', enabled: true, description: '', mode: 'trunk', allowedVlans: ['10', '20'] },
  ], [
    { local_port: 'Gi1/0/1', direction: 'uplink', peer_asset_name: '核心路由器', peer_port: 'GE0/1', status: '在线' },
  ])

  assert.deepEqual(result.ports.map((port) => [port.number, port.name, port.state, port.registered]), [
    ['1', 'GE1/0/1', 'enabled', true],
    ['2', 'GE1/0/2', 'enabled', false],
    ['10', 'GE1/0/10', 'disabled', false],
  ])
  assert.equal(result.ports[0].role, '上联 核心路由器 GE0/1')
  assert.equal(result.ports[1].role, '虚拟化节点01')
  assert.deepEqual(result.counts, { enabled: 2, disabled: 1, abnormal: 0, unknown: 0, down: 0, registered: 1, total: 3 })
})

test('端口异常优先于启停状态并计入异常统计', () => {
  const result = buildSwitchPortPanel([
    { name: 'GigabitEthernet1/0/24', enabled: true, status: 'error-disabled', description: '边界防火墙' },
  ], [])

  assert.equal(result.ports[0].number, '24')
  assert.equal(result.ports[0].state, 'abnormal')
  assert.deepEqual(result.counts, { enabled: 0, disabled: 0, abnormal: 1, unknown: 0, down: 0, registered: 0, total: 1 })
})

test('异常快照字段会归一化而不会传入组件', () => {
  const result = buildSwitchPortPanel([
    { name: 'GE1/0/1', allowedVlans: {}, status: 'mystery' },
    { name: 'GE1/0/2', allowedVlans: '10,20 30' },
  ], [])

  assert.deepEqual(result.ports[0].allowedVlans, [])
  assert.deepEqual(result.ports[1].allowedVlans, ['10', '20', '30'])
  assert.equal(result.ports[0].state, 'unknown')
})

test('无状态不冒充启用，未连接不等于故障，多槽同号端口可区分', () => {
  const result = buildSwitchPortPanel([{ name: 'GE1/0/1' }, { name: 'GE2/0/1', status: 'down' }])
  assert.equal(result.ports[0].state, 'unknown')
  assert.equal(result.ports[1].state, 'down')
  assert.notEqual(result.ports[0].number, result.ports[1].number)
})
