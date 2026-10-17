import { resolveBridgeKeyAuth, resolveBridgeSshAgentAuth, resolveHostAuth } from '../../domain/sshAuth'

const MARKERS = ['CPU', 'MEMORY', 'DISKS', 'OS']
export function hardwareCommand(family) {
  if (family === 'Linux') return `set -e
printf '__CMDB_CPU__\\n'
LC_ALL=C lscpu
printf '__CMDB_MEMORY__\\n'
cat /proc/meminfo
printf '__CMDB_DISKS__\\n'
LC_ALL=C lsblk -bdn -o NAME,SIZE,TYPE,MODEL
printf '__CMDB_OS__\\n'
cat /etc/os-release`
  if (family === 'Windows') {
    const script = `$ErrorActionPreference='Stop'; $cpu=@(Get-CimInstance Win32_Processor); $mem=Get-CimInstance Win32_ComputerSystem; $disks=@(Get-CimInstance Win32_DiskDrive); $os=Get-CimInstance Win32_OperatingSystem; [ordered]@{cpu_info=(($cpu | Group-Object Name | ForEach-Object { ('{0} x {1}' -f $_.Count,$_.Name.Trim()) }) -join ' / '); vcpu=($cpu | Measure-Object NumberOfLogicalProcessors -Sum).Sum; memory_mb=[math]::Round($mem.TotalPhysicalMemory/1MB); disk_info=(($disks | ForEach-Object { ('{0} GB {1} {2}' -f [math]::Round($_.Size/1GB,2),$_.InterfaceType,$_.Model.Trim()) }) -join ' / '); os_type=$os.Caption; os_version=$os.Version} | ConvertTo-Json -Compress`
    const utf8Script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $ProgressPreference='SilentlyContinue'; ` + script
    const encoded = btoa(Array.from(utf8Script, char => String.fromCharCode(char.charCodeAt(0) & 255, char.charCodeAt(0) >>> 8)).join(''))
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`
  }
  throw new Error('仅支持 Linux / Windows 的 SSH 硬件读取；ESXi 请手动填写')
}

export function parseHardwareOutput(family, output) {
  const text = String(output || '').replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('主机未返回硬件数据')
  if (family === 'Windows') {
    const value = JSON.parse(text)
    const memory = Number(value.memory_mb)
    if (!value.cpu_info || !value.disk_info || !Number.isSafeInteger(memory) || memory <= 0) throw new Error('Windows 硬件返回缺少 CPU、内存或磁盘字段')
    return { cpu_info: String(value.cpu_info), ...(Number.isSafeInteger(Number(value.vcpu)) && Number(value.vcpu) > 0 ? { vcpu: Number(value.vcpu) } : {}), memory_mb: memory, disk_info: String(value.disk_info), os_type: String(value.os_type || ''), os_version: String(value.os_version || '') }
  }
  if (family !== 'Linux') throw new Error('不支持的硬件读取系统')
  const sections = {}
  for (let i = 0; i < MARKERS.length; i++) {
    const start = text.indexOf(`__CMDB_${MARKERS[i]}__`)
    const end = i + 1 < MARKERS.length ? text.indexOf(`__CMDB_${MARKERS[i + 1]}__`) : text.length
    if (start < 0 || end < start) throw new Error('Linux 硬件返回不完整，未回填任何字段')
    sections[MARKERS[i]] = text.slice(start + `__CMDB_${MARKERS[i]}__`.length, end).trim()
  }
  const cpu = sections.CPU.match(/^Model name:\s*(.+)$/m)?.[1]?.trim()
  const sockets = sections.CPU.match(/^Socket\(s\):\s*(\d+)/m)?.[1]
  const kb = Number(sections.MEMORY.match(/^MemTotal:\s*(\d+)\s*kB/m)?.[1])
  const disks = sections.DISKS.split('\n').map(line => line.trim().match(/^(\S+)\s+(\d+)\s+(\S+)\s*(.*)$/)).filter(match => match?.[3] === 'disk')
  const os = Object.fromEntries(sections.OS.split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const split = line.indexOf('=')
    return [line.slice(0, split), line.slice(split + 1).replace(/^['"]|['"]$/g, '')]
  }))
  if (!cpu || !kb || !disks.length) throw new Error('Linux 硬件返回缺少 CPU、内存或磁盘数据')
  return {
    cpu_info: sockets ? `${sockets} × ${cpu}` : cpu,
    ...(Number(sections.CPU.match(/^CPU\(s\):\s*(\d+)/m)?.[1]) > 0 ? { vcpu: Number(sections.CPU.match(/^CPU\(s\):\s*(\d+)/m)[1]) } : {}),
    memory_mb: Math.round(kb / 1024),
    disk_info: disks.map(match => `${Math.round(Number(match[2]) / 1024 ** 3 * 100) / 100} GB${match[4] ? ` ${match[4]}` : ''}`).join(' / '),
    os_type: os.NAME || 'Linux', os_version: os.VERSION_ID || '',
  }
}

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
