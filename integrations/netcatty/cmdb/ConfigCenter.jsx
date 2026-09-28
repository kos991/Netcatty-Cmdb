import React, { useEffect, useMemo, useState } from 'react'
import { Cloud, DatabaseBackup, FolderOpen, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { VaultPageHeader } from '@/components/vault/VaultPageHeader'
import {
  CMDB_CLOUD_SYNC_REQUEST_EVENT,
  CMDB_CLOUD_SYNC_SETTINGS_EVENT,
  readCmdbCloudSyncSettings,
  writeCmdbCloudSyncSettings,
} from '../../application/CmdbCloudSync'
import { api } from './api'
import { directoryChanged, useAction, useQuery } from './hooks'
import { ErrorBanner, Field, SelectControl } from './ui'
import Catalog from './Catalog'

const GROUPS = [['work', '工单配置'], ['project', '项目设置']]
const WORK_TABS = [['rule', '编号规则'], ['work-order-categories', '工单类别'], ['work-order-types', '运维类型'], ['work-order-priorities', '优先级']]
const BASIC = [{ key: 'name', label: '名称', required: true }, { key: 'remark', label: '说明', type: 'textarea' }, { key: 'sort_order', label: '排序', type: 'number', min: 0 }]
const RULE_DEFAULTS = { name: 'GD', vendor: '-', version: 'YYYYMMDD', remark: '每日', sort_order: 4 }

const specifications = Object.fromEntries(WORK_TABS.filter(([key]) => key !== 'rule').map(([kind, title]) => [kind, {
  title,
  load: async () => (await api.config(kind)).list || [],
  save: async (values, original) => original.id ? api.updateConfig(kind, original.id, values) : api.createConfig(kind, values),
  remove: (row) => api.deleteConfig(kind, row.id),
}]))

function TabButton({ active, onClick, children }) {
  return <button type="button" onClick={onClick} className={`h-full shrink-0 whitespace-nowrap border-b-2 px-4 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{children}</button>
}

function ConfigCatalog({ kind }) {
  const spec = specifications[kind]
  const load = React.useCallback(async () => spec.load(), [spec])
  const columns = [
    { key: 'name', label: '名称' },
    { key: 'remark', label: '说明' },
    { key: 'sort_order', label: '排序' },
  ]
  return <Catalog key={kind} {...spec} load={load} defaults={{ sort_order: 0 }} columns={columns} fields={BASIC} />
}

function NumberRule() {
  const query = useQuery(() => api.config('work-order-rule'), [])
  const [values, setValues] = useState(RULE_DEFAULTS)
  const action = useAction()
  const record = query.data?.list?.[0]
  useEffect(() => { if (record) setValues({ ...RULE_DEFAULTS, ...record }) }, [record])
  const date = new Date()
  const dateValue = values.version === 'YYYY' ? String(date.getFullYear()) : values.version === 'YYYYMM' ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}` : values.version === 'YYYYMMDD' ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}` : ''
  const preview = [values.name || 'GD', dateValue, '1'.padStart(Number(values.sort_order) || 4, '0')].filter(Boolean).join(values.vendor ?? '-')
  const change = (key, value) => setValues((old) => ({ ...old, [key]: value }))
  const save = () => action.run(async () => {
    if (!/^[A-Z0-9]{1,12}$/.test(values.name || '')) throw new Error('固定前缀只能使用 1-12 位大写字母或数字')
    if (record?.id) await api.updateConfig('work-order-rule', record.id, values)
    else await api.createConfig('work-order-rule', values)
    query.reload()
  }, '编号规则已保存')
  return <div className="min-h-0 flex-1 overflow-auto">
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <section className="border-b border-border/70 px-5 py-4">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold">工单编号规则</h2><p className="mt-1 text-xs text-muted-foreground">工单创建时由系统生成，表单不允许手工填写</p></div><Button size="sm" onClick={save} disabled={action.busy}><Save size={14} className="mr-1.5" />保存规则</Button></div>
      <div className="mt-4 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="固定前缀" required><Input className="h-9 font-mono" value={values.name} onChange={(event) => change('name', event.target.value.toUpperCase())} /></Field>
        <Field label="分隔符"><SelectControl className="w-full" value={values.vendor} onChange={(value) => change('vendor', value)} options={[{ value: '-', label: '短横线 -' }, { value: '_', label: '下划线 _' }, { value: '', label: '无分隔符' }]} /></Field>
        <Field label="日期段"><SelectControl className="w-full" value={values.version} onChange={(value) => change('version', value)} options={[{ value: 'YYYYMMDD', label: '年月日 YYYYMMDD' }, { value: 'YYYYMM', label: '年月 YYYYMM' }, { value: 'YYYY', label: '年 YYYY' }, { value: 'NONE', label: '无日期段' }]} /></Field>
        <Field label="流水号位数"><SelectControl className="w-full" value={String(values.sort_order)} onChange={(value) => change('sort_order', Number(value))} options={[3, 4, 5, 6, 7, 8].map((value) => ({ value: String(value), label: String(value) }))} /></Field>
        <Field label="重置周期"><SelectControl className="w-full" value={values.remark} onChange={(value) => change('remark', value)} options={['每日', '每月', '每年', '不重置'].map((value) => ({ value, label: value }))} /></Field>
      </div>
    </section>
    <div className="grid max-w-5xl grid-cols-2 border-b border-border/70 lg:grid-cols-4">
      {[['下一张工单编号', preview], ['当前流水', '0'.repeat(Number(values.sort_order) || 4)], ['规则状态', record ? '已启用' : '使用默认规则'], ['重置周期', values.remark]].map(([label, value]) => <div key={label} className="border-r border-border/70 px-5 py-4 last:border-r-0"><span className="text-[11px] text-muted-foreground">{label}</span><strong className="mt-1 block font-mono text-base tabular-nums">{value}</strong></div>)}
    </div>
    <section className="px-5 py-5"><h3 className="text-sm font-medium">规则说明</h3><p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">修改规则只影响保存后的新工单，历史工单编号保持不变。编号由当前项目、日期段和流水号共同生成。</p></section>
  </div>
}

function ProjectSettings() {
  const query = useQuery(api.projects)
  const action = useAction()
  const project = query.data?.list?.[0]
  const [values, setValues] = useState({ name: '', code: '' })
  const [syncSettings, setSyncSettings] = useState(readCmdbCloudSyncSettings)
  const [confirmEnable, setConfirmEnable] = useState(false)
  const [confirmLegacySync, setConfirmLegacySync] = useState(false)
  const [legacySyncResult, setLegacySyncResult] = useState(null)
  useEffect(() => { if (project) setValues({ name: project.name || '', code: project.code || '' }) }, [project])
  useEffect(() => {
    const refresh = () => setSyncSettings(readCmdbCloudSyncSettings())
    window.addEventListener(CMDB_CLOUD_SYNC_SETTINGS_EVENT, refresh)
    return () => window.removeEventListener(CMDB_CLOUD_SYNC_SETTINGS_EVENT, refresh)
  }, [])
  const attachmentPath = `cmdb/attachments/${values.code || 'default'}`
  const updateSync = (changes) => setSyncSettings(writeCmdbCloudSyncSettings(changes))
  const syncStatus = syncSettings.lastStatus === 'error'
    ? `失败：${syncSettings.lastError || '未知错误'}`
    : syncSettings.lastSyncedAt
      ? `成功 · ${new Date(syncSettings.lastSyncedAt).toLocaleString()}`
      : '尚未同步'
  return <div className="min-h-0 flex-1 overflow-auto">
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <section className="px-5 py-4"><div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold">项目设置</h2><p className="mt-1 text-xs text-muted-foreground">维护当前项目资料和附件存储位置</p></div><Button size="sm" disabled={!project || action.busy} onClick={() => action.run(async () => { await api.updateProject(project.id, values); query.reload() }, '项目设置已保存')}><Save size={14} className="mr-1.5" />保存设置</Button></div>
      <div className="mt-5 grid max-w-4xl grid-cols-2 gap-4"><Field label="项目名称" required><Input className="h-9" value={values.name} onChange={(event) => setValues((old) => ({ ...old, name: event.target.value }))} /></Field><Field label="项目编码" required><Input className="h-9 font-mono" value={values.code} onChange={(event) => setValues((old) => ({ ...old, code: event.target.value }))} /></Field></div>
    </section>
    <section className="border-t border-border/70 px-5 py-5"><div className="flex items-center gap-2"><FolderOpen size={16} /><h3 className="text-sm font-medium">附件存储</h3></div><p className="mt-1 text-xs text-muted-foreground">工单附件按项目独立保存</p><div className="mt-4 max-w-4xl"><Field label="附件管理路径"><Input className="h-9 font-mono" value={attachmentPath} readOnly /></Field><p className="mt-2 text-[11px] text-muted-foreground">相对于 Netcatty 用户数据目录；绝对路径不参与云同步。</p></div></section>
    <section className="border-t border-border/70 px-5 py-5" data-section="cmdb-cloud-sync-settings">
      <div className="flex max-w-4xl items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3"><Cloud className="mt-0.5 h-4 w-4 shrink-0" /><div><h3 className="text-sm font-medium">Netcatty 云同步</h3><p className="mt-1 text-xs text-muted-foreground">Cmdb 规范快照随现有加密同步载荷传输</p></div></div>
        <Switch checked={syncSettings.enabled} onCheckedChange={(checked) => checked ? setConfirmEnable(true) : updateSync({ enabled: false })} aria-label="随 Netcatty 云同步" />
      </div>
      <div className="mt-4 max-w-4xl divide-y divide-border/60 border-y border-border/60">
        <label className="flex min-h-12 items-center justify-between gap-4 py-2 text-xs"><span>同步人员联系电话</span><Switch checked={syncSettings.includeContacts} disabled={!syncSettings.enabled} onCheckedChange={(checked) => updateSync({ includeContacts: checked })} /></label>
        <label className="flex min-h-12 items-center justify-between gap-4 py-2 text-xs"><span>同步运维履历</span><Switch checked={syncSettings.includeHistory} disabled={!syncSettings.enabled} onCheckedChange={(checked) => updateSync({ includeHistory: checked })} /></label>
      </div>
      <div className="mt-4 flex max-w-4xl items-center justify-between gap-4">
        <div className={`flex min-w-0 items-center gap-2 text-xs ${syncSettings.lastStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}><ShieldCheck className="h-4 w-4 shrink-0" /><span className="truncate">{syncStatus}</span></div>
        <Button type="button" size="sm" variant="outline" disabled={!syncSettings.enabled} onClick={() => window.dispatchEvent(new CustomEvent(CMDB_CLOUD_SYNC_REQUEST_EVENT))}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />立即同步</Button>
      </div>
    </section>
    <section className="border-t border-border/70 px-5 py-5" data-section="cmdb-data-maintenance">
      <div className="flex max-w-4xl items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3"><DatabaseBackup className="mt-0.5 h-4 w-4 shrink-0" /><div><h3 className="text-sm font-medium">数据维护</h3><p className="mt-1 text-xs text-muted-foreground">将当前项目的旧终端与基础设施台账幂等写入 Cmdb；已有映射会跳过，不会删除现有资产。</p></div></div>
        <Button type="button" size="sm" variant="outline" disabled={action.busy} onClick={() => setConfirmLegacySync(true)}>同步历史台账</Button>
      </div>
      {legacySyncResult ? <p className="mt-4 max-w-4xl border-y border-border/60 py-3 text-xs text-muted-foreground">上次执行结果：新增组织 {legacySyncResult.org_inserted || 0}，新增终端资产 {legacySyncResult.asset_inserted || 0}，新增基础设施 {legacySyncResult.server_inserted || 0}，跳过已有记录 {legacySyncResult.skipped || 0}。</p> : null}
    </section>
    <ConfirmDialog open={confirmEnable} onOpenChange={setConfirmEnable} title="启用 Cmdb 云同步" message="Cmdb 业务数据将进入 Netcatty 现有的端到端加密同步载荷。附件文件、邮箱、密码和密钥不会上传。" confirmLabel="启用" onConfirm={() => { updateSync({ enabled: true }); setConfirmEnable(false) }} />
    <ConfirmDialog open={confirmLegacySync} onOpenChange={setConfirmLegacySync} title="同步历史台账" message="确认把当前项目的旧终端资产与基础设施台账写入 Cmdb？该操作按来源记录幂等执行，已同步记录会跳过。" confirmLabel="开始同步" busy={action.busy} onConfirm={async () => { const succeeded = await action.run(async () => { const result = await api.syncInfrastructure(); setLegacySyncResult(result); directoryChanged() }, '历史台账同步完成'); if (succeeded) setConfirmLegacySync(false) }} />
  </div>
}

export default function ConfigCenter() {
  const [group, setGroup] = useState('work')
  const [workTab, setWorkTab] = useState('rule')
  const project = useQuery(api.projects)
  const projectLabel = useMemo(() => project.data?.list?.[0]?.name || '当前项目', [project.data])
  let content
  if (group === 'project') content = <ProjectSettings />
  else content = workTab === 'rule' ? <NumberRule /> : <ConfigCatalog kind={workTab} />
  const tabs = group === 'work' ? WORK_TABS : []
  return <div className="flex h-full min-h-0 flex-col">
    <VaultPageHeader dataSection="cmdb-config-header"><strong className="text-sm">配置中心</strong><span className="ml-1 text-[11px] text-muted-foreground">当前项目：{projectLabel}</span></VaultPageHeader>
    <nav className="flex h-[44px] shrink-0 items-stretch overflow-x-auto border-b border-border/70 px-3" aria-label="配置分类">{GROUPS.map(([key, label]) => <TabButton key={key} active={group === key} onClick={() => setGroup(key)}>{label}</TabButton>)}</nav>
    {tabs.length > 0 && <nav className="flex h-[44px] shrink-0 items-stretch overflow-x-auto border-b border-border/70 px-3" aria-label="配置项目">{tabs.map(([key, label]) => <TabButton key={key} active={workTab === key} onClick={() => setWorkTab(key)}>{label}</TabButton>)}<span className="ml-auto hidden shrink-0 self-center pr-3 text-[11px] text-muted-foreground lg:block">配置仅作用于当前项目</span></nav>}
    {content}
  </div>
}
