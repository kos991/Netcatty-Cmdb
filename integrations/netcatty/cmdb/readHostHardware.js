import { resolveBridgeKeyAuth, resolveBridgeSshAgentAuth, resolveHostAuth } from '../../domain/sshAuth'
import { hardwareCommand, parseHardwareOutput } from './hostHardwareParser.js'

export async function readHostHardware(backend, host, snapshot, family) {
  if (String(host.protocol || 'ssh').toLowerCase() !== 'ssh') throw new Error('硬件读取要求 SSH 主机')
  if (!backend.execCommand) throw new Error('当前 Netcatty 不支持 SSH 命令读取')
  const command = hardwareCommand(family)
  const auth = resolveHostAuth({ host, keys: [...snapshot.keys], identities: [...snapshot.identities] })
  const keyAuth = resolveBridgeKeyAuth({ key: auth.key, fallbackIdentityFilePaths: host.identityFilePaths, passphrase: auth.passphrase })
  const result = await backend.execCommand({
    hostname: host.hostname, hostId: host.id, port: host.port || 22, username: auth.username,
    authMethod: auth.authMethod, password: auth.password, privateKey: keyAuth.privateKey,
    certificate: auth.key?.certificate, publicKey: auth.key?.publicKey, keyId: auth.keyId, keySource: auth.key?.source,
    passphrase: keyAuth.passphrase, identityFilePaths: keyAuth.identityFilePaths,
    ...resolveBridgeSshAgentAuth(host, auth.key, auth.authMethod),
    legacyAlgorithms: host.legacyAlgorithms, skipEcdsaHostKey: host.skipEcdsaHostKey, algorithmOverrides: host.algorithms,
    command, timeout: 20000, enableKeyboardInteractive: true, requiresMfa: !!host.requiresMfa,
    sessionId: `cmdb-hardware-${host.id}-${Date.now()}`,
  })
  if (result?.code == null || result.code !== 0) throw new Error(`硬件读取命令失败（状态 ${result?.code ?? '未知'}）${result?.stderr ? `：${result.stderr}` : ''}`)
  if (new TextEncoder().encode(result.stdout || '').byteLength > 1024 * 1024) throw new Error('硬件返回超过 1 MiB，未回填')
  return parseHardwareOutput(family, result.stdout)
}
