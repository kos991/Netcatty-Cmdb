import React from 'react'
import { buildRouterInterfaceRows } from './deviceWorkspaceModel'

function Summary({ label, value }) {
  return <div className="min-w-0 border-r border-border/60 px-3 py-2.5 last:border-r-0"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-xs text-foreground">{value}</p></div>
}

export default function RouterOperations({ detail }) {
  const interfaces = buildRouterInterfaceRows(detail.interfaces || [])
  const gateways = [...new Set(interfaces.map((item) => item.gateway).filter(Boolean))]
  return <div className="space-y-3" data-section="router-operations">
    <div className="grid grid-cols-2 border-y border-border/60 sm:grid-cols-4"><Summary label="接口数量" value={interfaces.length} /><Summary label="已登记地址" value={(detail.ipam || []).length} /><Summary label="上下联链路" value={(detail.links || []).length} /><Summary label="已登记网关" value={gateways.length} /></div>
    {!interfaces.length ? <div className="border-y border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">暂未登记接口</div> : <div className="max-w-full overflow-auto border-y border-border/70"><table className="w-full min-w-[500px] border-collapse text-xs"><thead className="bg-muted/30 text-left text-[10px] text-muted-foreground"><tr><th className="px-3 py-2 font-medium">接口</th><th className="px-3 py-2 font-medium">角色 / 网络区域</th><th className="px-3 py-2 font-medium">IP / 掩码</th><th className="px-3 py-2 font-medium">网关</th><th className="px-3 py-2 font-medium">VLAN</th></tr></thead><tbody className="divide-y divide-border/50">{interfaces.map((item) => <tr key={item.id} className="hover:bg-muted/20"><td className="px-3 py-2 font-mono">{item.name}</td><td className="px-3 py-2">{item.role}</td><td className="px-3 py-2 font-mono">{item.ip}{item.mask ? ` / ${item.mask}` : ''}</td><td className="px-3 py-2 font-mono">{item.gateway || '-'}</td><td className="px-3 py-2 font-mono">{item.vlan || '-'}</td></tr>)}</tbody></table></div>}
  </div>
}
