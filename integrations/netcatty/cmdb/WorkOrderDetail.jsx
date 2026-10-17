import React, { useCallback, useState } from 'react'
import { ChevronDown, History, Link2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api } from './api'
import { useAction, useQuery } from './hooks'
import { ErrorBanner, StatusPill, statusTone } from './ui'
import { getNextWorkOrderStatus } from './workOrderStatsModel'

const time = (value) => String(value || '').replace('T', ' ').slice(0, 16) || '—'
const actionLabel = (status) => ({ '处理中': '开始处理', '已解决': '标记解决', '已关闭': '结单' }[status] || '')

function WorkOrderRecords({ order, refreshKey }) {
  const loader = useCallback(() => { void refreshKey; return api.workOrderLogs(order.id) }, [order.id, refreshKey])
  const query = useQuery(loader)
  const [content, setContent] = useState('')
  const action = useAction()
  return <details data-work-order-records className="group rounded-md border border-border/70">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs font-semibold"><History size={14} className="text-muted-foreground" />处理记录<span className="ml-auto text-[11px] font-normal text-muted-foreground">{query.data?.total ?? '—'} 条</span><ChevronDown size={14} className="text-muted-foreground group-open:rotate-180" /></summary>
    <div className="space-y-4 border-t border-border/60 p-3.5">
      <section><h4 className="mb-2 text-[11px] text-muted-foreground">处理结果</h4><p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{order.result || '尚未填写处理结果'}</p></section>
      <section><h4 className="mb-2 text-[11px] text-muted-foreground">处理时间线</h4>{query.error ? <ErrorBanner message={query.error} onRetry={query.reload} /> : query.loading ? <p className="text-xs text-muted-foreground">正在加载记录…</p> : query.data?.list?.length ? <ol className="space-y-4 border-l border-border pl-4">{query.data.list.map((record) => <li key={record.id} className="relative text-xs"><span className="absolute -left-[20px] top-1 size-2 rounded-full border border-border bg-background" /><time className="text-[10px] text-muted-foreground">{time(record.created_at)}</time><div className="mt-1 font-medium">{record.action || '处理记录'}</div><p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{record.content}</p>{record.operator ? <p className="mt-1 text-[10px] text-muted-foreground">{record.operator}</p> : null}</li>)}</ol> : <p className="text-xs text-muted-foreground">暂无处理记录</p>}</section>
      {!['已关闭', '已取消'].includes(order.status) ? <form className="space-y-2 border-t border-border/60 pt-3" onSubmit={(event) => { event.preventDefault(); action.run(async () => { if (!content.trim()) throw new Error('请填写处理记录'); await api.addWorkOrderLog(order.id, { content: content.trim(), operator: order.maintainer || '' }); setContent(''); await query.reload() }, '处理记录已添加') }}><label htmlFor={`work-order-note-${order.id}`} className="text-[11px] text-muted-foreground">添加处理记录 <span className="text-destructive">*</span></label><Textarea id={`work-order-note-${order.id}`} required rows={3} value={content} disabled={action.busy} onChange={(event) => setContent(event.target.value)} placeholder="填写本次跟进、排查情况或补充说明" /><div className="flex justify-end"><Button type="submit" size="sm" disabled={action.busy}>添加记录</Button></div></form> : null}
    </div>
  </details>
}

export default function WorkOrderDetail({ orderId, projectName, refreshKey, busy, onClose, onEdit, onAdvance, onCancel, onNavigate, AttachmentPanel }) {
  const loader = useCallback(() => { void refreshKey; return api.workOrder(orderId) }, [orderId, refreshKey])
  const query = useQuery(loader)
  const order = query.data
  const next = order && getNextWorkOrderStatus(order.status)
  const active = order && !['已关闭', '已取消'].includes(order.status)
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}><DialogContent data-work-order-detail className="flex max-h-[min(780px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
    <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><div className="mb-2 flex flex-wrap items-center gap-2 pr-6 text-xs text-muted-foreground"><span className="font-mono">{order?.order_no || '工单详情'}</span>{order ? <><StatusPill tone={String(order.priority).startsWith('P1') ? 'danger' : 'neutral'}>{order.priority || '未配置优先级'}</StatusPill><StatusPill tone={statusTone(order.status)}>{order.status}</StatusPill></> : null}</div><DialogTitle className="break-words text-sm leading-relaxed">{order?.subject || '工单详情'}</DialogTitle></DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{query.error ? <ErrorBanner message={query.error} onRetry={query.reload} /> : query.loading ? <p className="py-6 text-center text-xs text-muted-foreground">正在加载工单详情…</p> : order ? <div className="space-y-3">
      <section className="rounded-md border border-border/70 p-3.5"><h3 className="mb-3 text-xs font-semibold">基本信息</h3><dl className="grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">{[
        ['所属项目', order.project_name || projectName], ['维护类型', order.biz_type], ['运维类型', order.operation_type], ['维护人员', order.maintainer], ['运维负责人', order.owner], ['发生时间', time(order.plan_time)], ['开始处理', time(order.started_at)], ['解决时间', time(order.resolved_at)], ['关闭时间', time(order.closed_at)], ['处理工时', order.status === '已关闭' ? order.started_at && order.resolved_at ? `${order.work_minutes || 0} 分钟` : '历史时间不完整' : '结单时自动计算'],
      ].map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[66px_minmax(0,1fr)] gap-2 text-[11px] leading-relaxed"><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value || '—'}</dd></div>)}</dl><h4 className="mb-2 mt-4 text-[11px] text-muted-foreground">维护描述</h4><p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{order.remark || '未填写维护描述'}</p></section>
      <section className="space-y-3 rounded-md border border-border/70 p-3.5"><h3 className="text-xs font-semibold">关联资源</h3>{order.assets?.length ? <div className="space-y-2">{order.assets.map((asset) => <button key={`${asset.asset_type}:${asset.asset_id}`} type="button" disabled={!onNavigate || !asset.asset_id} className="flex w-full items-center gap-2 rounded border border-border/60 bg-muted/20 p-2.5 text-left text-xs hover:bg-muted/50 disabled:opacity-60" onClick={() => { onClose(); onNavigate({ tableKey: { terminal: 'assets', infrastructure: 'cmdb_assets', application: 'server_apps' }[asset.asset_type], id: asset.asset_id }) }}><Link2 size={13} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 break-words text-primary">{asset.asset_name || `#${asset.asset_id}`}</span><span className="shrink-0 text-[10px] text-muted-foreground">{{ terminal: '终端资产', infrastructure: '基础设施', application: '业务系统' }[asset.asset_type] || asset.asset_type}</span></button>)}</div> : <p className="text-xs text-muted-foreground">未关联资源</p>}<AttachmentPanel workOrderId={order.id} /></section>
      <WorkOrderRecords key={order.id} order={order} refreshKey={refreshKey} />
    </div> : null}</div>
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">{order && !query.loading && !query.error ? <><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onEdit(order)}><Pencil size={13} className="mr-1" />编辑</Button>{active ? <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => onCancel(order)}>取消工单</Button> : null}<span className="flex-1" />{next ? <Button type="button" disabled={busy} onClick={() => onAdvance(order)}>{actionLabel(next)}</Button> : <Button type="button" variant="outline" onClick={onClose}>关闭</Button>}</> : <Button type="button" variant="outline" onClick={onClose}>关闭</Button>}</footer>
  </DialogContent></Dialog>
}
