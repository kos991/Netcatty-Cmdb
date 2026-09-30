import assert from 'node:assert/strict'
import test from 'node:test'
import { createNetcattyVaultActions } from './netcattyVaultActions.js'

function fixture() {
  const original = { id: 'existing', label: '原主机', hostname: '192.0.2.1', username: 'ops', identityId: 'account', group: '核心设备', tags: ['保留'], os: 'windows', notes: '保留说明' }
  const state = { hosts: [original], keys: [{ id: 'key', label: '密钥', privateKey: '私钥内容' }], identities: [{ id: 'account', label: '管理员', username: 'admin', authMethod: 'password', password: '密码' }] }
  const actions = {
    updateHosts: async (update) => { assert.equal(typeof update, 'function'); state.hosts = update(state.hosts) },
    updateKeys: async (items) => { state.keys = items },
    updateIdentities: async (items) => { state.identities = items },
  }
  return { state, original, ...createNetcattyVaultActions(actions, () => state) }
}

test('跟随地址只更新指定原生主机且保留完整认证与其他配置', async () => {
  const f = fixture()
  const other = { id: 'nat', hostname: 'nat.example.test' }
  f.state.hosts.push(other)
  await f.updateHostAddress('existing', '192.0.2.20')
  assert.deepEqual(f.state.hosts[0], { ...f.original, hostname: '192.0.2.20' })
  assert.strictEqual(f.state.hosts[1], other)
})

test('资产内创建主机保留现有主机全部配置，使用最新主机集合追加', async () => {
  const f = fixture()
  const created = await f.createHost({ label: '交换机', hostname: '192.0.2.2', credentialId: 'account', protocol: 'telnet', port: 23 })
  assert.strictEqual(f.state.hosts[0], f.original)
  assert.equal(created.username, 'admin')
  assert.equal(created.telnetIdentityId, 'account')
  assert.equal(created.telnetUsername, undefined)
  assert.equal(created.telnetPort, 23)
  assert.equal(created.os, undefined)
})

test('密钥身份保留 keyId；可导入私钥；Telnet 拒绝密钥认证', async () => {
  const f = fixture()
  const identity = await f.createCredential({ label: '运维', username: 'ops', authMethod: 'key', keyId: 'key' })
  assert.equal(identity.keyId, 'key')
  assert.equal(f.state.identities[0].password, '密码')
  const key = await f.createCredential({ kind: 'key', label: '导入密钥', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n内容\n-----END OPENSSH PRIVATE KEY-----' })
  assert.equal(f.state.keys.length, 2)
  assert.equal(key.credentialKind, 'key')
  await assert.rejects(f.createHost({ label: '设备', hostname: '192.0.2.3', protocol: 'telnet', credentialId: identity.id }), /Telnet/)
  await assert.rejects(f.createCredential({ label: '运维', username: 'ops', authMethod: 'key' }), /密钥/)
  const empty = await f.createCredential({ label: '待填写', username: 'ops' })
  await assert.rejects(f.createHost({ label: '交换机', hostname: '192.0.2.4', protocol: 'telnet', credentialId: empty.id }), /尚未填写密码/)
})

test('改选共享登录身份会更新目标原生主机认证，保留其他主机与完整配置', async () => {
  const f = fixture()
  const other = { id: 'other', identityId: 'account', tags: ['另一台'] }
  f.state.hosts.push(other)
  f.state.identities.push({ id: 'readonly', label: '只读', username: 'viewer', authMethod: 'password', password: '只读密码' })
  f.original.hostChain = { hostId: 'jump' }
  f.original.portForwards = [{ localPort: 18080, remotePort: 80 }]

  await f.bindHostCredential('existing', 'readonly')

  assert.equal(f.state.hosts[0].identityId, 'readonly')
  assert.deepEqual(f.state.hosts[0].hostChain, { hostId: 'jump' })
  assert.deepEqual(f.state.hosts[0].portForwards, [{ localPort: 18080, remotePort: 80 }])
  assert.strictEqual(f.state.hosts[1], other)
  assert.equal(f.state.hosts[1].identityId, 'account')
})

test('原生主机持久化失败时不报告连接保存成功', async () => {
  const state = { hosts: [{ id: 'host', protocol: 'ssh', username: 'old', tags: [] }], identities: [{ id: 'identity', username: 'new', authMethod: 'password', password: 'secret' }], keys: [] }
  const actions = createNetcattyVaultActions({ updateHosts: async () => 'failed' }, () => state)
  await assert.rejects(actions.bindHostCredential('host', 'identity'), /主机保存失败/)
  await assert.rejects(actions.createHost({ label: '新主机', hostname: '192.0.2.10', username: 'admin' }), /主机保存失败/)
})

test('SSH 密钥和 Telnet 密码身份写入各自的原生认证字段', async () => {
  const f = fixture()
  f.state.hosts.push({ id: 'telnet', label: '终端', protocol: 'telnet', username: 'old', telnetUsername: 'old', telnetPassword: 'old-secret', tags: ['保留'] })
  f.state.identities.push({ id: 'telnet-account', username: 'operator', authMethod: 'password', password: 'new-secret' })
  await f.bindHostCredential('existing', 'key')
  await f.bindHostCredential('telnet', 'telnet-account')
  assert.equal(f.state.hosts[0].identityId, '')
  assert.equal(f.state.hosts[0].identityFileId, 'key')
  assert.equal(f.state.hosts[1].telnetIdentityId, 'telnet-account')
  assert.equal(f.state.hosts[1].telnetUsername, undefined)
  assert.equal(f.state.hosts[1].telnetPassword, undefined)
  assert.deepEqual(f.state.hosts[1].tags, ['保留'])
  await assert.rejects(f.bindHostCredential('telnet', 'key'), /Telnet 不支持密钥/)
  f.state.identities.push({ id: 'certificate-account', username: 'cert', authMethod: 'certificate', password: 'secret' })
  await assert.rejects(f.bindHostCredential('telnet', 'certificate-account'), /Telnet 不支持密钥/)
  f.state.hosts[0].protocol = 'rdp'
  await assert.rejects(f.bindHostCredential('existing', 'account'), /暂不支持/)
})
