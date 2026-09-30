import assert from 'node:assert/strict'
import test from 'node:test'
import {
  connectionForAddress,
  connectionTargetMismatch,
  buildNetcattyLinkPayload,
  connectionFromLinks,
  persistNetcattyConnection,
  selectNetcattyHost,
  setDefaultNetcattyLink,
  netcattyLinkStatus,
  assertNetcattyLinkReady,
} from './NetcattyConnection.js'

test('快捷连接识别所点地址与 Netcatty 实际目标的差异', () => {
  assert.deepEqual(connectionTargetMismatch('10.0.0.12', hosts[0]), { selected: '10.0.0.12', actual: '10.0.0.10' })
  assert.equal(connectionTargetMismatch('10.0.0.10', hosts[0]), null)
})

test('地址快捷连接只选择目标相同的主机引用', () => {
  const links = [{ id: 1, host_id: 'host-1', is_primary: true }, { id: 2, host_id: 'host-2' }]
  assert.equal(connectionForAddress('10.0.0.11', links, hosts)?.id, 2)
  assert.equal(connectionForAddress('10.0.0.12', links, hosts), null)
})

test('默认快连优先选择管理目标相同且认证有效的最新关联', () => {
  const available = [
    { id: 3, host_id: 'host-1', credential_id: 'identity-1', is_primary: true },
    { id: 9, host_id: 'host-3', credential_id: 'identity-1' },
    { id: 8, host_id: 'host-4', credential_id: 'key-1' },
  ]
  const directory = [...hosts, { ...hosts[0], id: 'host-3', hostname: '10.0.0.11', credentialId: 'key-1' }, { ...hosts[0], id: 'host-4', hostname: '10.0.0.11', credentialId: 'key-1' }]
  assert.equal(connectionForAddress('10.0.0.11', available, directory, credentials)?.id, 8)
  assert.equal(connectionForAddress('10.0.0.12', available, directory, credentials), null)
})

test('多个有效目标匹配时默认优先，否则选择最新关联', () => {
  const available = [
    { id: 4, host_id: 'host-1', credential_id: 'identity-1' },
    { id: 10, host_id: 'host-3', credential_id: 'identity-1' },
    { id: 2, host_id: 'host-4', credential_id: 'identity-1', is_primary: true },
  ]
  const directory = [...hosts, { ...hosts[0], id: 'host-3' }, { ...hosts[0], id: 'host-4' }]
  assert.equal(connectionForAddress('10.0.0.10', available, directory, credentials)?.id, 2)
  assert.equal(connectionForAddress('10.0.0.10', available.slice(0, 2), directory, credentials)?.id, 10)
})

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
    credential_id: '',
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

test('同一设备的第二个连接可保持非默认状态', () => {
  const payload = buildNetcattyLinkPayload('infrastructure', 42, { host_id: 'host-2', credential_id: 'identity-1', is_primary: false }, hosts, credentials)
  assert.equal(payload.is_primary, false)
})

test('资产表单保存时创建、更新或解除现有 Netcatty 关联', async () => {
  const calls = []
  const api = {
    netcattyLinks: async () => ({ list: [] }),
    netcattyHostUsage: async () => ({ other_references: 0 }),
    createNetcattyLink: async (payload) => { calls.push(['create', payload]); return { id: 8 } },
    updateNetcattyLink: async (id, payload) => { calls.push(['update', id, payload]) },
    deleteNetcattyLink: async (id) => { calls.push(['delete', id]) },
  }
  const bindHostCredential = async () => {}
  const existing = { id: 7, host_id: 'host-1', credential_id: 'identity-1' }

  assert.deepEqual(connectionFromLinks([existing]), { host_id: 'host-1', credential_id: 'identity-1', link_id: 7 })
  await persistNetcattyConnection(api, { assetType: 'infrastructure', assetId: 9, connection: { host_id: 'host-2', credential_id: 'key-1', link_id: 7 }, hosts, credentials, bindHostCredential })
  await persistNetcattyConnection(api, { assetType: 'infrastructure', assetId: 9, connection: { host_id: '', credential_id: '', link_id: 7 }, hosts, credentials })
  await persistNetcattyConnection(api, { assetType: 'application', assetId: 11, connection: { host_id: 'host-1', credential_id: 'identity-1' }, hosts, credentials, bindHostCredential })

  assert.equal(calls[0][0], 'update')
  assert.equal(calls[0][1], 7)
  assert.equal(calls[0][2].host_id, 'host-2')
  assert.deepEqual(calls[1], ['delete', 7])
  assert.equal(calls[2][0], 'create')
  assert.equal(calls[2][1].asset_type, 'application')
})

test('保存主机连接先让所选身份生效，备用凭证只保存引用', async () => {
  const calls = []
  const api = { netcattyLinks: async () => ({ list: [] }), netcattyHostUsage: async () => ({ other_references: 0 }), createNetcattyLink: async payload => { calls.push(['link', payload.host_id, payload.credential_id]); return { id: 5 } } }
  const bindHostCredential = async (hostID, credentialID) => { calls.push(['bind', hostID, credentialID]) }
  await persistNetcattyConnection(api, { assetType: 'terminal', assetId: 9, connection: { host_id: 'host-1', credential_id: 'key-1' }, hosts, credentials, bindHostCredential })
  await persistNetcattyConnection(api, { assetType: 'terminal', assetId: 9, connection: { host_id: '', credential_id: 'key-1' }, hosts, credentials, bindHostCredential })
  assert.deepEqual(calls, [
    ['bind', 'host-1', 'key-1'],
    ['link', 'host-1', 'key-1'],
    ['link', '', 'key-1'],
  ])
})

test('一个资产多个账号主机时可切换唯一默认连接', async () => {
  const calls = []
  const api = { setDefaultNetcattyLink: async (id) => { calls.push(id) } }
  const links = [{ id: 3, host_id: 'admin-host', is_primary: true }, { id: 4, host_id: 'read-host', is_primary: false }]
  await setDefaultNetcattyLink(api, links[1], links)
  assert.deepEqual(calls, [4])
})

test('原生主机已绑定但 Cmdb 引用失败时给出实际状态和可重试 ID', async () => {
  const api = { netcattyLinks: async () => ({ list: [] }), netcattyHostUsage: async () => ({ other_references: 0 }), createNetcattyLink: async () => { throw new Error('数据库不可写') } }
  await assert.rejects(
    persistNetcattyConnection(api, { assetType: 'terminal', assetId: 9, connection: { host_id: 'host-1', credential_id: 'key-1' }, hosts, credentials, bindHostCredential: async () => {} }),
    /主机认证已保存.*Cmdb 引用保存失败.*host-1.*key-1.*重试关联/,
  )
})

test('共享主机被其他资产引用时拒绝改绑身份，避免影响另一台设备', async () => {
  let updated = false
  const api = { netcattyLinks: async () => ({ list: [] }), netcattyHostUsage: async () => ({ other_references: 1 }) }
  await assert.rejects(
    persistNetcattyConnection(api, { assetType: 'terminal', assetId: 9, connection: { host_id: 'host-1', credential_id: 'key-1' }, hosts, credentials, bindHostCredential: async () => { updated = true } }),
    /其他资产.*新建.*主机/,
  )
  assert.equal(updated, false)
})

test('同一资产重复新增已有主机的另一身份时原主机认证和关联均不变', async () => {
  const existing = { id: 7, asset_type: 'terminal', asset_id: 9, host_id: 'host-1', credential_id: 'identity-1', is_primary: true }
  let actualCredential = 'identity-1'
  let created = false
  const api = {
    netcattyLinks: async () => ({ list: [existing] }),
    netcattyHostUsage: async () => ({ other_references: 0 }),
    createNetcattyLink: async () => { created = true; throw new Error('UNIQUE constraint failed: cmdb_netcatty_links.project_id, cmdb_netcatty_links.asset_type, cmdb_netcatty_links.asset_id, cmdb_netcatty_links.host_id') },
  }
  let error
  try {
    await persistNetcattyConnection(api, { assetType: 'terminal', assetId: 9, connection: { host_id: 'host-1', credential_id: 'key-1' }, hosts, credentials, bindHostCredential: async (_hostID, credentialID) => { actualCredential = credentialID } })
  } catch (caught) { error = caught }
  assert.equal(actualCredential, 'identity-1')
  assert.equal(created, false)
  assert.match(error?.message || '', /已关联当前资产.*新建.*主机/)
  assert.equal(existing.credential_id, 'identity-1')
})

test('明确编辑当前主机关联时仍可安全更新身份', async () => {
  const existing = { id: 7, asset_type: 'terminal', asset_id: 9, host_id: 'host-1', credential_id: 'identity-1' }
  let actualCredential = 'identity-1'
  const api = {
    netcattyLinks: async () => ({ list: [existing] }),
    netcattyHostUsage: async () => ({ other_references: 0 }),
    updateNetcattyLink: async (_id, payload) => { existing.credential_id = payload.credential_id },
  }
  await persistNetcattyConnection(api, { assetType: 'terminal', assetId: 9, connection: { host_id: 'host-1', credential_id: 'key-1', link_id: 7 }, hosts, credentials, bindHostCredential: async (_hostID, credentialID) => { actualCredential = credentialID } })
  assert.equal(actualCredential, 'key-1')
  assert.equal(existing.credential_id, 'key-1')
})

test('主机当前认证与关联身份不一致时不可作为已联动连接', () => {
  const link = { host_id: 'host-1', credential_id: 'identity-1' }
  assert.equal(netcattyLinkStatus(link, { ...hosts[0], credentialId: 'key-1' }, credentials), 'auth-mismatch')
  assert.throws(() => assertNetcattyLinkReady(link, { ...hosts[0], credentialId: 'key-1' }, credentials), /认证未应用|已失效/)
  assert.equal(netcattyLinkStatus(link, hosts[0], credentials), 'linked')
  assert.equal(netcattyLinkStatus({ host_id: '', credential_id: 'key-1' }, null, credentials), 'linked')
})

test('跨项目仍引用同一主机时仅在认证改变时阻止改绑', async () => {
  let bound = 0
  const api = {
    netcattyLinks: async () => ({ list: [] }),
    netcattyHostUsage: async () => ({ other_references: 1 }),
    createNetcattyLink: async () => ({ id: 5 }),
  }
  await assert.rejects(persistNetcattyConnection(api, { assetType: 'terminal', assetId: 9, connection: { host_id: 'host-1', credential_id: 'key-1' }, hosts, credentials, bindHostCredential: async () => { bound++ } }), /其他资产.*新建.*主机/)
  assert.equal(bound, 0)
  await persistNetcattyConnection(api, { assetType: 'terminal', assetId: 9, connection: { host_id: 'host-1', credential_id: 'identity-1' }, hosts, credentials, bindHostCredential: async () => { bound++ } })
  assert.equal(bound, 0)
})

test('默认连接切换失败时不留下两个默认连接', async () => {
  const links = [{ id: 3, host_id: 'admin-host', is_primary: true }, { id: 4, host_id: 'read-host', is_primary: false }]
  const state = new Map([[3, true], [4, false]])
  const api = { setDefaultNetcattyLink: async () => { throw new Error('写入失败') } }
  await assert.rejects(setDefaultNetcattyLink(api, links[1], links), /写入失败/)
  assert.deepEqual([...state.values()], [true, false])
})
