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

test('资产内创建主机保留现有主机全部配置，使用最新主机集合追加', async () => {
  const f = fixture()
  const created = await f.createHost({ label: '交换机', hostname: '192.0.2.2', credentialId: 'account', protocol: 'telnet', port: 23 })
  assert.strictEqual(f.state.hosts[0], f.original)
  assert.equal(created.username, 'admin')
  assert.equal(created.telnetIdentityId, 'account')
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
