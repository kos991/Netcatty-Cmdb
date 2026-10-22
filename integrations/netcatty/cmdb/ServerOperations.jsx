import React from 'react'

export default function ServerOperations({ detail, onOpenApplication }) {
  const applications = detail.related_applications || []
  return <div className="space-y-5" data-section="server-operations">
    <section><header className="mb-2 flex min-h-[30px] items-center"><h2 className="text-xs font-semibold">承载业务系统</h2><span className="ml-auto font-mono text-[10px] text-muted-foreground">{applications.length}</span></header>{!applications.length ? <div className="border-y border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">暂未关联业务系统</div> : <div className="divide-y divide-border/50 border-y border-border/60">{applications.map((item) => <button type="button" key={item.id} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left text-xs hover:bg-muted/30" onClick={() => onOpenApplication?.(item.id)}><div className="min-w-0"><p className="truncate font-medium text-primary">{item.app_name || `业务系统 #${item.id}`}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.app_type || '业务系统'} · {item.status || '未标注状态'}</p></div><span className="font-mono text-[10px] text-muted-foreground">{[item.server_biz_ip, item.port ? `:${item.port}` : ''].filter(Boolean).join('') || '-'}</span></button>)}</div>}</section>
  </div>
}
