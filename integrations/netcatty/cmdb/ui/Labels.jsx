import React, { useCallback, useState } from 'react'
import { Archive, Barcode, Printer, RefreshCw, RotateCcw, ScanLine, Settings2, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { api } from './api'
import { useAction, useQuery } from './hooks'
import { Fields, validateFields } from './Fields'
import { ActionIcon, DataTable, DefinitionList, DetailSheet, ErrorBanner, ModalForm, Pagination, SearchBox, SelectControl, StatusPill, statusTone, Toolbar } from './ui'

const TABS = ['全部', '使用中', '孤儿', '已归档']

export default function Labels() {
  const [tab, setTab] = useState('全部')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selected, setSelected] = useState([])
  const [scan, setScan] = useState(false)
  const [scanValue, setScanValue] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [rule, setRule] = useState(null)
  const [printed, setPrinted] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const action = useAction()
  const loader = useCallback(() => api.labels({ tab, keyword: search, page, page_size: pageSize }), [tab, search, page, pageSize])
  const query = useQuery(loader)
  const loadPrinted = useCallback(() => printed ? api.printedLabels() : Promise.resolve({ list: [] }), [printed])
  const printedQuery = useQuery(loadPrinted)
  const reload = () => { setSelected([]); query.reload() }
  const locate = () => action.run(async () => {
    const value = scanValue.trim()
    if (!value) throw new Error('请输入或扫描编码')
    const response = await api.labels({ tab: '全部', keyword: value, page: 1, page_size: 1 })
    setScanResult(response.list?.[0] || null)
    if (!response.list?.length) throw new Error(`未找到编码 ${value}`)
  })
  const openRule = () => action.run(async () => { const response = await api.labelRule(); setRule({ prefix: response.prefix || 'ZC' }) })
  return <div className="flex min-h-0 flex-1 flex-col">
    <Toolbar>
      <SelectControl value={tab} onChange={(v) => { setTab(v); setPage(1); setSelected([]) }} options={TABS.map((value) => ({ value, label: value === '孤儿' && query.data?.orphan_count ? `${value}（${query.data.orphan_count}）` : value }))} className="w-36" />
      <SearchBox value={keyword} onChange={setKeyword} onSearch={() => { setSearch(keyword.trim()); setPage(1) }} placeholder="搜索编码、资产名称或 SN" />
      <Button variant="outline" size="sm" onClick={() => { setSearch(keyword.trim()); setPage(1) }}>查询</Button>
      <div className="ml-auto flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={action.busy} onClick={() => action.run(async () => { await api.generateLabels(); reload() }, '资产编码已生成')}><Barcode size={14} className="mr-1" />生成编码</Button><ActionIcon label="扫码或编码定位" onClick={() => { setScan(true); setScanValue(''); setScanResult(null) }}><ScanLine size={15} /></ActionIcon><ActionIcon label="编码规则" onClick={openRule}><Settings2 size={15} /></ActionIcon><ActionIcon label="打印审计" onClick={() => setPrinted(true)}><Printer size={15} /></ActionIcon><ActionIcon label="修复孤儿编码" onClick={() => action.run(async () => { await api.repairLabels(); reload() }, '孤儿编码已处理')}><Wrench size={15} /></ActionIcon><Button variant="outline" size="sm" disabled={!selected.length || action.busy} onClick={() => action.run(async () => { await api.printLabels(selected); reload() }, `已记录打印 ${selected.length} 条`)}><Printer size={14} className="mr-1" />打印（{selected.length}）</Button><ActionIcon label="刷新" onClick={reload}><RefreshCw size={15} /></ActionIcon></div>
    </Toolbar>
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <DataTable loading={query.loading} selected={selected} onSelectedChange={setSelected} rows={query.error ? [] : query.data?.list || []} columns={[
      { key: 'code', label: '编码', className: 'font-mono text-xs' }, { key: 'asset_name', label: '资产名称' }, { key: 'sn', label: 'SN', className: 'font-mono text-xs' }, { key: 'department', label: '部门' }, { key: 'owner', label: '负责人' }, { key: 'asset_code', label: '资产编号' }, { key: 'status', label: '状态', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
      { key: 'actions', label: '操作', render: (_, row) => <div className="flex">{row.status === '已归档' ? <ActionIcon label="恢复编码" onClick={() => action.run(async () => { await api.setLabelStatus(row.id, '使用中'); reload() }, '编码已恢复')}><RotateCcw size={15} /></ActionIcon> : <ActionIcon label="归档编码" onClick={() => action.run(async () => { await api.setLabelStatus(row.id, '已归档'); reload() }, '编码已归档')}><Archive size={15} /></ActionIcon>}<ActionIcon label="删除编码" danger onClick={() => setDeleting(row)}><Trash2 size={15} /></ActionIcon></div> },
    ]} />
    <Pagination page={page} pageSize={pageSize} total={query.data?.total || 0} onChange={(p, s) => { setPage(p); setPageSize(s) }} />
    <ModalForm open={scan} onOpenChange={setScan} title="扫码 / 编码定位" submitLabel="定位" busy={action.busy} onSubmit={locate}><Input autoFocus aria-label="资产编码" value={scanValue} onChange={(event) => setScanValue(event.target.value)} placeholder="扫描或输入编码" />{scanResult && <DefinitionList items={[['编码', scanResult.code], ['资产名称', scanResult.asset_name], ['资产编号', scanResult.asset_code], ['SN', scanResult.sn], ['部门', scanResult.department], ['负责人', scanResult.owner], ['状态', scanResult.status]]} />}</ModalForm>
    <ModalForm open={!!rule} onOpenChange={(v) => { if (!v) setRule(null) }} title="编码规则" busy={action.busy} onSubmit={() => action.run(async () => { validateFields([{ key: 'prefix', label: '编码前缀', required: true }], rule); await api.saveLabelRule(rule.prefix); setRule(null) }, '编码规则已保存')}><p className="text-xs text-muted-foreground">资产已有编号时沿用资产编号；没有编号时使用“前缀-资产 ID”生成。</p><Fields fields={[{ key: 'prefix', label: '编码前缀', required: true }]} value={rule || {}} onChange={setRule} /></ModalForm>
    <DetailSheet open={printed} onOpenChange={setPrinted} title="打印审计"><DataTable loading={printedQuery.loading} rows={printedQuery.data?.list || []} columns={[{ key: 'code', label: '编码' }, { key: 'asset_name', label: '资产名称' }, { key: 'print_batch', label: '打印批次' }, { key: 'created_at', label: '创建时间' }]} />{printedQuery.error && <ErrorBanner message={printedQuery.error} onRetry={printedQuery.reload} />}</DetailSheet>
    <ConfirmDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null) }} title="删除编码" message={`确认删除编码“${deleting?.code || ''}”？`} confirmLabel="删除" destructive busy={action.busy} onConfirm={() => action.run(async () => { await api.deleteLabel(deleting.id); setDeleting(null); reload() }, '编码已删除')} />
  </div>
}
