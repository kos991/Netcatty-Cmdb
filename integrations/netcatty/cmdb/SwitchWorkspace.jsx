import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildSwitchPortPanel } from './switchPortPanel'
import { deviceReadTime } from './deviceWorkspaceModel'

const SECURITY_TABS = [
  ['acl', 'ACL 规则'],
  ['accounts', '设备账号'],
  ['access', 'SSH/Telnet'],
  ['snmp', 'SNMP'],
]

const formatTime = deviceReadTime

function Fact({ label, value, mono = false }) {
  return <div className="min-w-0 border-r border-border/60 px-3 py-2.5 last:border-r-0">
    <p className="text-[10px] text-muted-foreground">{label}</p>
    <p className={`mt-1 truncate text-xs text-foreground ${mono ? 'font-mono' : ''}`} title={String(value || '-')}>{value || '-'}</p>
  </div>
}

function ConfigTable({ columns, rows, empty }) {
  if (!rows?.length) return <div className="border-y border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">{empty}</div>
  return <div className="max-w-full overflow-auto border border-border/70">
    <table className="w-full min-w-[520px] border-collapse text-xs">
      <thead className="sticky top-0 bg-muted/50 text-left text-[10px] text-muted-foreground"><tr>{columns.map((column) => <th key={column.key} className="border-b border-border/70 px-3 py-2 font-medium">{column.label}</th>)}</tr></thead>
      <tbody className="divide-y divide-border/50">{rows.map((row, index) => <tr key={row.id || `${row.name || row.username || 'row'}-${index}`} className="hover:bg-muted/20">{columns.map((column) => <td key={column.key} className={`px-3 py-2 align-top ${column.mono ? 'font-mono' : ''}`}>{column.render ? column.render(row[column.key], row) : (row[column.key] || '-')}</td>)}</tr>)}</tbody>
    </table>
  </div>
}

function PortPanel({ switchData, links, onAddLinkForPort }) {
  const panel = useMemo(() => buildSwitchPortPanel(switchData?.interfaces || [], links || []), [links, switchData])
  const [selectedName, setSelectedName] = useState('')
  useEffect(() => {
    if (selectedName && !panel.ports.some((port) => port.name === selectedName)) setSelectedName('')
  }, [panel.ports, selectedName])
  const selected = panel.ports.find((port) => port.name === selectedName)
  const tones = {
    enabled: { dot: 'bg-emerald-400', label: '启用' },
    disabled: { dot: 'bg-muted-foreground/45', label: '关闭' },
    abnormal: { dot: 'bg-red-500', label: '异常' },
    unknown: { dot: 'bg-muted-foreground/30', label: '状态未知' },
    down: { dot: 'bg-amber-400', label: '未连接' },
  }
  return <section className="overflow-hidden border border-border/80" data-switch-port-panel>
    <header className="flex min-h-[40px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/70 px-3 py-2">
      <strong className="mr-auto text-xs font-semibold">端口面板</strong>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground"><span>启用 <b className="text-foreground">{panel.counts.enabled}</b></span><span>关闭 <b className="text-foreground">{panel.counts.disabled}</b></span><span>异常 <b className="text-foreground">{panel.counts.abnormal}</b></span><span>未知 <b className="text-foreground">{panel.counts.unknown}</b></span>{panel.counts.down ? <span>未连接 {panel.counts.down}</span> : null}<span>已登记 <b className="text-foreground">{panel.counts.registered}</b></span></div>
    </header>
    {!panel.ports.length ? <div className="px-4 py-8 text-center text-xs text-muted-foreground">尚未读取到物理端口</div> : <div className="grid grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-1.5 p-3">
      {panel.ports.map((port) => {
        const tone = tones[port.state]
        const active = selectedName === port.name
        return <button type="button" key={port.name} onClick={() => setSelectedName(active ? '' : port.name)} aria-label={`${port.name}，${tone.label}${port.registered ? `，${port.role}` : ''}`} className={`relative grid h-[46px] min-w-0 place-items-center overflow-hidden rounded-sm border bg-muted/25 px-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${active ? 'border-primary bg-primary/5' : 'border-border/80'}`}>
          <span className={`absolute top-1.5 h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          <strong className="mt-2 font-mono text-[10px] text-foreground">{port.number}</strong>
          {port.registered ? <span className="absolute inset-x-1 bottom-0 h-0.5 bg-sky-500" /> : null}
        </button>
      })}
    </div>}
    {selected ? <div className="border-t border-border/70 bg-muted/10"><div className="grid grid-cols-2 sm:grid-cols-4"><Fact label="端口" value={selected.name} mono /><Fact label="采集状态" value={tones[selected.state].label} /><Fact label={selected.registered ? "登记作用" : "设备描述"} value={selected.role || '未登记'} /><Fact label="链路类型" value={selected.mode || '-'} /><Fact label="PVID" value={selected.vlan || '-'} mono /><Fact label="允许 VLAN" value={selected.allowedVlans.join(', ') || '-'} mono /><Fact label="聚合组" value={selected.aggregation || '-'} mono /><Fact label="台账链路状态" value={selected.link?.status || '-'} /></div><div className="flex justify-end border-t border-border/60 px-3 py-2"><Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => onAddLinkForPort(selected.link?.local_port || selected.name)}><Link2 size={13} />{selected.registered ? '查看已登记链路' : '以此端口添加链路'}</Button></div></div> : null}
  </section>
}

function SecurityAccess({ switchData }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('acl')
  const counts = { acl: switchData?.acl?.length || 0, accounts: switchData?.accounts?.length || 0 }
  return <section className="border border-border/70" data-section="switch-security-access">
    <button type="button" className="flex min-h-[38px] w-full items-center gap-2 px-3 text-left text-xs font-semibold" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}安全与访问<span className="ml-auto font-normal text-muted-foreground">ACL {counts.acl} · 账号 {counts.accounts}</span></button>
    {open ? <div className="border-t border-border/60"><nav className="flex overflow-x-auto border-b border-border/60 px-2" aria-label="交换机安全配置">{SECURITY_TABS.map(([key, label]) => <button type="button" key={key} onClick={() => setTab(key)} className={`h-[36px] shrink-0 border-b-2 px-2.5 text-[11px] ${tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}{counts[key] ? ` ${counts[key]}` : ''}</button>)}</nav><div className="p-3">
      {tab === 'acl' ? <ConfigTable columns={[{ key: 'name', label: 'ACL' }, { key: 'rule', label: '规则', mono: true }, { key: 'action', label: '动作' }]} rows={switchData?.acl || []} empty="未读取到 ACL 规则" /> : null}
      {tab === 'accounts' ? <ConfigTable columns={[{ key: 'username', label: '账号', mono: true }, { key: 'role', label: '角色 / 权限' }, { key: 'services', label: '允许服务', render: (value) => value?.join('、') || '-' }, { key: 'status', label: '配置状态' }]} rows={switchData?.accounts || []} empty="未读取到设备账号" /> : null}
      {tab === 'access' ? <div className="grid grid-cols-1 border border-border/70 sm:grid-cols-2"><Fact label="SSH 服务" value={switchData?.services?.sshTelnet?.ssh || '未识别'} /><Fact label="Telnet 服务" value={switchData?.services?.sshTelnet?.telnet || '未识别'} /></div> : null}
      {tab === 'snmp' ? <div className="grid grid-cols-1 border border-border/70 sm:grid-cols-2 lg:grid-cols-3"><Fact label="SNMP 版本" value={switchData?.snmp?.version || '未识别'} /><Fact label="配置状态" value={switchData?.snmp?.configured || '未识别'} /><Fact label="安全级别" value={switchData?.snmp?.securityLevel || '-'} /><Fact label="认证 / 加密算法" value={switchData?.snmp?.algorithms || '-'} /><Fact label="绑定 ACL" value={switchData?.snmp?.acl || '-'} /><Fact label="用户" value={switchData?.snmp?.users?.join('、')} /><Fact label="组" value={switchData?.snmp?.groups?.join('、')} /><Fact label="视图" value={switchData?.snmp?.views?.join('、')} /><Fact label="Trap 目标" value={switchData?.snmp?.traps?.join('、') || '-'} /></div> : null}
    </div></div> : null}
  </section>
}

export default function SwitchWorkspace({ detail, snapshot, readError, onAddLinkForPort }) {
  const switchData = snapshot?.snapshot || snapshot
  const readAt = snapshot?.read_at || switchData?.readAt
  const aggregation = [...new Set((switchData?.interfaces || []).map((item) => item.aggregation).filter(Boolean))]
  return <div className="space-y-3" data-section="switch-workspace">
    {readError ? <div className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{readError}</div> : null}
    <div className="flex min-h-[34px] flex-wrap items-center gap-x-4 gap-y-1 border-y border-border/60 px-1 py-2 text-[11px] text-muted-foreground" data-section="switch-configuration-status">
      <span>管理 VLAN <b className="ml-1 font-mono font-medium text-foreground">{switchData?.device?.managementVlan || '-'}</b></span>
      <span>聚合组 <b className="ml-1 font-mono font-medium text-foreground">{aggregation.length}</b></span>
      <span>读取协议 <b className="ml-1 font-medium text-foreground">{snapshot?.protocol || '-'}</b></span>
      <span className="ml-auto">最近读取 <b className="ml-1 font-mono font-medium text-foreground">{formatTime(readAt)}</b></span>
    </div>
    {!switchData ? <div className="border-y border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">尚未读取配置。关联 Netcatty 主机后可通过 SSH 或 Telnet 只读采集。</div> : null}
    {switchData ? <p className="text-[11px] text-muted-foreground">历史配置快照 · {formatTime(readAt)} · {snapshot?.protocol || '未知协议'}{snapshot?.host_id && !detail.netcatty_links?.some(link => link.host_id === snapshot.host_id) ? ' · 采集主机当前未关联' : ''}。端口启停为采集配置，台账链路状态为人工登记。</p> : null}
    {switchData?.device?.model && detail.asset.model && switchData.device.model !== detail.asset.model ? <p className="text-[11px] text-amber-500">型号不一致：台账 {detail.asset.model}，采集 {switchData.device.model}。请核对设备。</p> : null}
    <PortPanel switchData={switchData} links={detail.links || []} onAddLinkForPort={onAddLinkForPort} />
    <SecurityAccess switchData={switchData} />
  </div>
}
