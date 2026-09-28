// 仅宿主读取完整密钥库并保存；展示摘要绝不能用于全量回写。
export function createNetcattyVaultActions(actions, getSnapshot) {
  const requireActions = () => { if (!actions) throw new Error('Netcatty 密钥库尚未初始化') }
  return {
    async createCredential(draft) {
      requireActions()
      const label = String(draft.label || '').trim()
      if (!label) throw new Error('请填写名称')
      const id = crypto.randomUUID()
      const snapshot = getSnapshot()
      if (draft.kind === 'key') {
        const privateKey = String(draft.privateKey || '').trim()
        if (!privateKey.includes('PRIVATE KEY-----')) throw new Error('请填写完整的 PEM / OpenSSH 私钥内容')
        const key = { id, label, type: draft.type || 'ED25519', privateKey, passphrase: draft.passphrase || undefined, savePassphrase: !!draft.passphrase, source: 'imported', category: 'key', created: Date.now() }
        await actions.updateKeys([...snapshot.keys, key])
        return { ...key, credentialKind: 'key' }
      }
      const username = String(draft.username || '').trim()
      if (!username) throw new Error('请填写用户名')
      const authMethod = draft.authMethod === 'key' ? 'key' : 'password'
      if (authMethod === 'key' && !snapshot.keys.some(key => key.id === draft.keyId)) throw new Error('请选择有效的 Netcatty 密钥')
      const identity = { id, label, username, authMethod, ...(authMethod === 'key' ? { keyId: draft.keyId } : { password: draft.password || undefined }), created: Date.now() }
      await actions.updateIdentities([...snapshot.identities, identity])
      return { ...identity, credentialKind: 'identity' }
    },
    async createHost(draft) {
      requireActions()
      const label = String(draft.label || '').trim()
      const hostname = String(draft.hostname || '').trim()
      if (!label || !hostname) throw new Error('请填写主机名称和地址')
      const protocol = draft.protocol === 'telnet' ? 'telnet' : 'ssh'
      const port = Number(draft.port || (protocol === 'telnet' ? 23 : 22))
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口应为 1 至 65535 的整数')
      const snapshot = getSnapshot()
      const identity = snapshot.identities.find(item => item.id === draft.credentialId)
      const key = snapshot.keys.find(item => item.id === draft.credentialId)
      if (draft.credentialId && !identity && !key) throw new Error('选择的身份或密钥已不存在')
      if (protocol === 'telnet' && (key || identity?.authMethod === 'key')) throw new Error('Telnet 不支持密钥认证，请使用密码身份')
      if (protocol === 'telnet' && identity && !identity.password) throw new Error('Telnet 登录身份尚未填写密码，请先在 Netcatty 钥匙串中补全')
      const username = String(identity?.username || draft.username || '').trim()
      if (!username) throw new Error('请填写用户名或选择已配置用户名的身份')
      const host = { id: crypto.randomUUID(), label, hostname, port, username, protocol, tags: [], createdAt: Date.now(), osOverride: 'auto',
        deviceType: draft.deviceType === 'network' ? 'network' : 'general',
        ...(identity ? { identityId: identity.id } : key ? { identityFileId: key.id, authMethod: 'key' } : { authMethod: 'password', password: draft.password || undefined }),
        ...(draft.group ? { group: String(draft.group).trim() } : {}),
        ...(draft.os ? { os: draft.os } : {}),
      }
      if (protocol === 'telnet') Object.assign(host, { telnetEnabled: true, telnetPort: port, telnetUsername: username, ...(identity ? { telnetIdentityId: identity.id } : { telnetPassword: draft.password || undefined }) })
      await actions.updateHosts(current => [...current, host])
      return host
    },
  }
}
