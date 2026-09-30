// 仅宿主读取完整密钥库并保存；展示摘要绝不能用于全量回写。
export function createNetcattyVaultActions(actions, getSnapshot) {
  const requireActions = () => { if (!actions) throw new Error('Netcatty 密钥库尚未初始化') }
  return {
    async updateHostAddress(hostId, address) {
      requireActions()
      if (!String(address || '').trim()) throw new Error('跟随目标地址不能为空')
      const result = await actions.updateHosts(current => {
        if (!current.some(item => item.id === hostId)) throw new Error('原生主机已不存在')
        return current.map(item => item.id === hostId ? { ...item, hostname: address.trim() } : item)
      })
      if (result === 'failed') throw new Error('Netcatty 主机保存失败，请检查密钥库后重试')
    },
    async bindHostCredential(hostId, credentialId) {
      requireActions()
      const snapshot = getSnapshot()
      const host = snapshot.hosts.find(item => item.id === hostId)
      if (!host) throw new Error('关联的 Netcatty 主机已不存在，请重新选择')
      const identity = snapshot.identities.find(item => item.id === credentialId)
      const key = snapshot.keys.find(item => item.id === credentialId)
      if (!identity && !key) throw new Error('选择的身份或密钥已不存在，请重新选择')
      const protocol = host.protocol || 'ssh'
      if (protocol !== 'ssh' && protocol !== 'telnet') throw new Error(`${protocol} 主机暂不支持从 Cmdb 绑定认证`)
      if (protocol === 'telnet') {
        if (!identity || identity.authMethod !== 'password') throw new Error('Telnet 不支持密钥认证，请使用密码身份')
        if (!identity.username?.trim() || !identity.password) throw new Error('Telnet 登录身份需要用户名和密码')
      } else if (identity) {
        if (!identity.username?.trim()) throw new Error('SSH 登录身份缺少用户名')
        if (identity.authMethod === 'key' && !snapshot.keys.some(item => item.id === identity.keyId)) throw new Error('SSH 登录身份引用的密钥已不存在')
        if (identity.authMethod !== 'key' && identity.authMethod !== 'password') throw new Error(`SSH 暂不支持 ${identity.authMethod || '未知'} 身份认证`)
        if (identity.authMethod === 'password' && !identity.password) throw new Error('SSH 登录身份尚未填写密码')
      } else if (!host.username?.trim()) throw new Error('使用密钥连接前请先为主机填写用户名')
      const result = await actions.updateHosts(current => {
        if (!current.some(item => item.id === hostId)) throw new Error('关联的 Netcatty 主机已不存在，请重新选择')
        return current.map(item => {
          if (item.id !== hostId) return item
          if (protocol === 'telnet') return { ...item, telnetIdentityId: identity.id, telnetUsername: undefined, telnetPassword: undefined }
          return identity
            ? { ...item, identityId: identity.id, identityFileId: undefined, authMethod: identity.authMethod, authPolicyVersion: 1, password: undefined }
            : { ...item, identityId: '', identityFileId: key.id, authMethod: 'key', authPolicyVersion: 1, password: undefined }
        })
      })
      if (result === 'failed') throw new Error('Netcatty 主机保存失败，请检查密钥库后重试')
    },
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
      if (protocol === 'telnet' && (key || (identity && identity.authMethod !== 'password'))) throw new Error('Telnet 不支持密钥认证，请使用密码身份')
      if (protocol === 'telnet' && identity && !identity.password) throw new Error('Telnet 登录身份尚未填写密码，请先在 Netcatty 钥匙串中补全')
      const username = String(identity?.username || draft.username || '').trim()
      if (!username) throw new Error('请填写用户名或选择已配置用户名的身份')
      const host = { id: crypto.randomUUID(), label, hostname, port, username, protocol, tags: [], createdAt: Date.now(), osOverride: 'auto',
        deviceType: draft.deviceType === 'network' ? 'network' : 'general',
        ...(identity ? { identityId: identity.id } : key ? { identityFileId: key.id, authMethod: 'key' } : { authMethod: 'password', password: draft.password || undefined }),
        ...(draft.group ? { group: String(draft.group).trim() } : {}),
        ...(draft.os ? { os: draft.os } : {}),
      }
      if (protocol === 'telnet') Object.assign(host, { telnetEnabled: true, telnetPort: port, ...(identity ? { telnetIdentityId: identity.id } : { telnetUsername: username, telnetPassword: draft.password || undefined }) })
      const result = await actions.updateHosts(current => [...current, host])
      if (result === 'failed') throw new Error('Netcatty 主机保存失败，请检查密钥库后重试')
      return host
    },
  }
}
