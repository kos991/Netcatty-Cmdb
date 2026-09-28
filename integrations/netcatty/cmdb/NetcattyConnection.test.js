import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildNetcattyLinkPayload,
  connectionFromLinks,
  persistNetcattyConnection,
  selectNetcattyHost,
} from './NetcattyConnection.js'

const hosts = [
  { id: 'host-1', label: '核心服务器', hostname: '10.0.0.10', port: 22, protocol: 'ssh', credentialId: 'identity-1' },
  { id: 'host-2', label: '备用服务器', hostname: '10.0.0.11', port: 22, protocol: 'ssh', credentialId: '' },
]
const credentials = [
  { id: 'identity-1', label: '服务器账号', type: 'password', kind: 'identity', username: 'admin' },
  { id: 'key-1', label: '运维密钥', type: 'ED25519', kind: 'key', username: '' },
]

test('资产表单选择 Netcatty 主机时自动带出该主机的密钥引用', () => {
  assert.deepEqual(selectNetcattyHost({ host_id: '', credential_id: 'key-1' }, 'host-1', hosts), {
    host_id: 'host-1',
    credential_id: 'identity-1',
  })
  assert.deepEqual(selectNetcattyHost({ host_id: 'host-1', credential_id: 'identity-1' }, 'host-2', hosts), {
    host_id: 'host-2',
    credential_id: 'identity-1',
  })
  assert.deepEqual(selectNetcattyHost({ host_id: 'host-1', credential_id: 'key-1' }, '', hosts), {
    host_id: '',
    credential_id: 'key-1',
  })
})

test('Netcatty 主机和钥匙串可以单独建立引用', () => {
  assert.deepEqual(buildNetcattyLinkPayload('application', 11, { host_id: '', credential_id: 'key-1' }, hosts, credentials), {
    asset_type: 'application',
    asset_id: 11,
    host_id: '',
    host_name: '',
    credential_id: 'key-1',
    credential_name: '运维密钥',
    protocol: '',
    address: '',
    port: 0,
    is_primary: false,
    state: 'linked',
  })
})

test('Netcatty 连接载荷只保存引用和显示摘要', () => {
  assert.deepEqual(buildNetcattyLinkPayload('terminal', 42, { host_id: 'host-1', credential_id: 'key-1' }, hosts, credentials), {
    asset_type: 'terminal',
    asset_id: 42,
    host_id: 'host-1',
    host_name: '核心服务器',
    credential_id: 'key-1',
    credential_name: '运维密钥',
    protocol: 'ssh',
    address: '10.0.0.10',
    port: 22,
    is_primary: true,
    state: 'linked',
  })
})

test('资产表单保存时创建、更新或解除现有 Netcatty 关联', async () => {
  const calls = []
  const api = {
    createNetcattyLink: async (payload) => { calls.push(['create', payload]); return { id: 8 } },
    updateNetcattyLink: async (id, payload) => { calls.push(['update', id, payload]) },
    deleteNetcattyLink: async (id) => { calls.push(['delete', id]) },
  }
  const existing = { id: 7, host_id: 'host-1', credential_id: 'identity-1' }

  assert.deepEqual(connectionFromLinks([existing]), { host_id: 'host-1', credential_id: 'identity-1', link_id: 7 })
  await persistNetcattyConnection(api, { assetType: 'infrastructure', assetId: 9, connection: { host_id: 'host-2', credential_id: 'key-1', link_id: 7 }, hosts, credentials })
  await persistNetcattyConnection(api, { assetType: 'infrastructure', assetId: 9, connection: { host_id: '', credential_id: '', link_id: 7 }, hosts, credentials })
  await persistNetcattyConnection(api, { assetType: 'application', assetId: 11, connection: { host_id: 'host-1', credential_id: 'identity-1' }, hosts, credentials })

  assert.equal(calls[0][0], 'update')
  assert.equal(calls[0][1], 7)
  assert.equal(calls[0][2].host_id, 'host-2')
  assert.deepEqual(calls[1], ['delete', 7])
  assert.equal(calls[2][0], 'create')
  assert.equal(calls[2][1].asset_type, 'application')
})
