// 按提示符逐条读取，分页时继续读取；断线或超时不能当成完整配置保存。
export async function readTelnetConfiguration(bridge, host, username, password, commands) {
  if (!bridge?.startTelnetSession || !bridge.onSessionData || !bridge.writeToSession || !bridge.closeSession) throw new Error('当前 Netcatty 不支持 Telnet 配置读取')
  const sessionId = `cmdb-switch-${crypto.randomUUID()}`
  return new Promise((resolve, reject) => {
    let output = ''
    let tail = ''
    let index = 0
    let settled = false
    let timer
    const disposers = []
    const finish = async error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      disposers.forEach(dispose => dispose?.())
      try { await bridge.closeSession(sessionId) } catch (closeError) { if (!error) error = closeError }
      if (error) reject(error)
      else resolve(output)
    }
    const armTimeout = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void finish(new Error('Telnet 读取超时，未保存不完整配置')), 20_000)
    }
    const sendNext = () => {
      if (settled) return
      if (index >= commands.length) { void finish(); return }
      tail = ''
      armTimeout()
      bridge.writeToSession(sessionId, `${commands[index++]}\r`, { automated: true })
    }
    disposers.push(bridge.onSessionData(sessionId, chunk => {
      if (settled) return
      output += String(chunk || '')
      tail = (tail + String(chunk || '')).slice(-4096)
      if (new TextEncoder().encode(output).byteLength > 1024 * 1024) { void finish(new Error('交换机返回内容超过 1 MiB，未保存不完整配置')); return }
      if (/--\s*More\s*--|----\s*More\s*----|Press (?:any key|SPACE).*continue/i.test(tail)) {
        tail = ''
        bridge.writeToSession(sessionId, ' ', { automated: true })
        armTimeout()
        return
      }
      if (/(?:^|[\r\n])(?:<[^<>\r\n]+>|\[[^\]\r\n]+\]|[\w./():-]+[#>])\s*$/.test(tail)) sendNext()
    }, { replayBacklog: true }))
    if (bridge.onSessionExit) disposers.push(bridge.onSessionExit(sessionId, () => void finish(new Error('Telnet 会话提前结束，未保存不完整配置'))))
    if (bridge.onTelnetAutoLoginCancelled) disposers.push(bridge.onTelnetAutoLoginCancelled(sessionId, () => void finish(new Error('Telnet 登录未完成，请检查主机中的用户名和密码'))))
    armTimeout()
    Promise.resolve(bridge.startTelnetSession({ sessionId, protocol: 'telnet', hostname: host.hostname, port: host.telnetPort || host.port || 23, username, password, cols: 160, rows: 48, charset: host.charset }))
      .catch(error => void finish(error instanceof Error ? error : new Error(String(error))))
  })
}
