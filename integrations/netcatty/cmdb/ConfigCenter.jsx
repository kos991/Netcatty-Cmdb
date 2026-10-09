import React, { useEffect, useMemo, useState } from 'react'
import { Cloud, DatabaseBackup, Download, FolderOpen, HardDrive, ListChecks, Network, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { VaultPageHeader } from '@/components/vault/VaultPageHeader'
import {
  CMDB_CLOUD_SYNC_STORAGE_KEY,
  CMDB_CLOUD_SYNC_SETTINGS_EVENT,
  readCmdbCloudSyncSettings,
  requestCmdbCloudSync,
  writeCmdbCloudSyncSettings,
} from '../../application/CmdbCloudSync'
import { api } from './api'
import { allPages, directoryChanged, useAction, useDirectory, useQuery } from './hooks'
import { selectAttachmentDirectory } from './transport'
import { buildAttachmentMigrationSummary, buildAttachmentStorageSummary } from './attachmentStorageModel'
import { ErrorBanner, Field, SelectControl } from './ui'
import Catalog from './Catalog'
import Taxonomy from './Taxonomy'

const WORK_TABS = [['rule', '编号规则'], ['work-order-categories', '工单类别'], ['work-order-types', '运维类型'], ['work-order-priorities', '优先级']]
const BASIC = [{ key: 'name', label: '名称', required: true }, { key: 'remark', label: '说明', type: 'textarea' }, { key: 'sort_order', label: '排序', type: 'number', min: 0 }]
const RULE_DEFAULTS = { name: 'GD', vendor: '-', version: 'YYYYMMDD', remark: '每日', sort_order: 4 }
const loadNetworkTypes = async () => (await api.config('network-types')).list || []
const loadModels = () => allPages(api.models)
const loadWorkOrderRule = () => api.config('work-order-rule')

function SettingsRow({ title, summary, onEdit, section }) {
  return <section data-section={section} className="flex min-h-14 min-w-0 items-center gap-4 border-b border-border/70 px-5 py-2.5">
    <span className="w-40 shrink-0 text-xs font-medium max-[650px]:w-28">{title}</span>
    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={summary}>{summary}</span>
    <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={onEdit}>编辑</Button>
  </section>
}

function entrySummary(entries, renderItem) {
  if (!entries?.length) return '暂无配置'
  const names = entries.slice(0, 3).map(renderItem).join('、')
  return entries.length > 3 ? `${names} 等 ${entries.length} 项` : names
}

const specifications = Object.fromEntries(WORK_TABS.filter(([key]) => key !== 'rule').map(([kind, title]) => [kind, {
  title,
  load: async () => (await api.config(kind)).list || [],
  save: async (values, original) => original.id ? api.updateConfig(kind, original.id, values) : api.createConfig(kind, values),
  remove: (row) => api.deleteConfig(kind, row.id),
}]))

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

function TaxonomySettings() {
  const [open, setOpen] = useState(false)
  const [selectedKind, setSelectedKind] = useState('terminal-categories')
  const load = React.useCallback(async () => {
    const kinds = [['terminal-categories', '终端设备类型'], ['infrastructure-categories', '基础设施设备类型'], ['application-categories', '业务系统类型']]
    return Promise.all(kinds.map(async ([kind, label]) => ({ kind, label, entries: (await api.taxonomy(kind)).list || [] })))
  }, [])
  const query = useDirectory(load)
  return <div>
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <div data-section="cmdb-settings-catalog">{(query.data || []).map((item) => <SettingsRow key={item.kind} title={item.label} summary={entrySummary(item.entries, (entry) => entry.name)} onEdit={() => { setSelectedKind(item.kind); setOpen(true) }} />)}</div>
    <Taxonomy key={selectedKind} initialKind={selectedKind} open={open} onOpenChange={setOpen} onChanged={() => { query.reload(); directoryChanged() }} />
  </div>
}

function ModelSettings() {
  const load = React.useCallback(async () => allPages(api.models), [])
  return <Catalog title="型号" load={load} defaults={{ vendor: '', model: '' }} save={(values, original) => original.id ? api.updateModel(original.id, values) : api.createModel(values)} remove={(row) => api.deleteModel(row.id)} fields={[{ key: 'vendor', label: '品牌 / 厂商', required: true }, { key: 'model', label: '型号', required: true }]} columns={[{ key: 'vendor', label: '品牌 / 厂商' }, { key: 'model', label: '型号' }]} />
}

function NetworkSettings() {
  const load = React.useCallback(async () => (await api.config('network-types')).list || [], [])
  return <Catalog title="网络类型" load={load} defaults={{ sort_order: 0 }} save={(values, original) => original.id ? api.updateConfig('network-types', original.id, values) : api.createConfig('network-types', values)} remove={(row) => api.deleteConfig('network-types', row.id)} fields={BASIC} columns={[{ key: 'name', label: '名称' }, { key: 'remark', label: '说明' }, { key: 'sort_order', label: '排序' }]} />
}

function SettingsCatalogSection({ title, icon: Icon, load, renderItem, children, section }) {
  const [open, setOpen] = useState(false)
  const query = useDirectory(load)
  return <section data-section={section}>
    {query.error ? <ErrorBanner message={query.error} onRetry={query.reload} /> : null}
    <SettingsRow title={title} summary={entrySummary(query.data, renderItem)} onEdit={() => setOpen(true)} />
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(680px,calc(100vh-40px))] w-[min(880px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border px-5 py-4"><DialogTitle className="flex items-center gap-2 text-sm"><Icon size={15} />编辑{title}</DialogTitle></DialogHeader>
        {open ? children : null}
      </DialogContent>
    </Dialog>
  </section>
}

function TemplateSettings() {
  const action = useAction()
  const templates = [['终端资产', api.downloadAssetTemplate], ['基础设施', api.downloadInfrastructureTemplate], ['IPAM/IP', api.downloadIPTemplate]]
  return <div className="min-h-0 flex-1 overflow-auto"><section className="border-b border-border/70 px-5 py-4"><h2 className="text-sm font-semibold">导入模板</h2><p className="mt-1 text-xs text-muted-foreground">下载模板后，回到对应业务页导入；筛选导出也在对应业务页</p></section><div className="max-w-4xl divide-y divide-border/70">{templates.map(([label, download]) => <div key={label} className="flex min-h-14 items-center justify-between gap-3 px-5"><span className="text-xs">{label}</span><Button size="sm" variant="outline" disabled={action.busy} onClick={() => action.run(download)}><Download size={14} className="mr-1.5" />下载模板</Button></div>)}</div></div>
}

function NumberRule() {
  const query = useQuery(loadWorkOrderRule)
  const [values, setValues] = useState(RULE_DEFAULTS)
  const [open, setOpen] = useState(false)
  const action = useAction()
  const record = query.data?.list?.[0]
  useEffect(() => { if (record) setValues({ ...RULE_DEFAULTS, ...record }) }, [record])
  const date = new Date()
  const dateValue = values.version === 'YYYY' ? String(date.getFullYear()) : values.version === 'YYYYMM' ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}` : values.version === 'YYYYMMDD' ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}` : ''
  const preview = [values.name || 'GD', dateValue, '1'.padStart(Number(values.sort_order) || 4, '0')].filter(Boolean).join(values.vendor ?? '-')
  const change = (key, value) => setValues((old) => ({ ...old, [key]: value }))
  const save = async () => {
    const succeeded = await action.run(async () => {
    if (!/^[A-Z0-9]{1,12}$/.test(values.name || '')) throw new Error('固定前缀只能使用 1-12 位大写字母或数字')
    if (record?.id) await api.updateConfig('work-order-rule', record.id, values)
    else await api.createConfig('work-order-rule', values)
    query.reload()
    }, '编号规则已保存')
    if (succeeded) setOpen(false)
  }
  return <div>
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <SettingsRow title="编号规则" summary={`${record ? '已启用' : '默认规则'} · ${preview} · ${values.remark}`} onEdit={() => setOpen(true)} />
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(600px,calc(100vw-32px))] max-w-none p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border px-5 py-4"><DialogTitle className="text-sm">编辑工单编号规则</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="固定前缀" required><Input className="h-9 font-mono" value={values.name} onChange={(event) => change('name', event.target.value.toUpperCase())} /></Field>
          <Field label="分隔符"><SelectControl className="w-full" value={values.vendor} onChange={(value) => change('vendor', value)} options={[{ value: '-', label: '短横线 -' }, { value: '_', label: '下划线 _' }, { value: '', label: '无分隔符' }]} /></Field>
          <Field label="日期段"><SelectControl className="w-full" value={values.version} onChange={(value) => change('version', value)} options={[{ value: 'YYYYMMDD', label: '年月日 YYYYMMDD' }, { value: 'YYYYMM', label: '年月 YYYYMM' }, { value: 'YYYY', label: '年 YYYY' }, { value: 'NONE', label: '无日期段' }]} /></Field>
          <Field label="流水号位数"><SelectControl className="w-full" value={String(values.sort_order)} onChange={(value) => change('sort_order', Number(value))} options={[3, 4, 5, 6, 7, 8].map((value) => ({ value: String(value), label: String(value) }))} /></Field>
          <Field label="重置周期"><SelectControl className="w-full" value={values.remark} onChange={(value) => change('remark', value)} options={['每日', '每月', '每年', '不重置'].map((value) => ({ value, label: value }))} /></Field>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3"><span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={preview}>格式示例：{preview}</span><Button size="sm" onClick={save} disabled={action.busy}><Save size={14} className="mr-1.5" />保存规则</Button></div>
      </DialogContent>
    </Dialog>
  </div>
}

function ProjectSettings() {
  const query = useQuery(api.projects)
  const attachmentQuery = useQuery(api.attachmentStorage)
  const action = useAction()
  const project = query.data?.list?.[0]
  const [values, setValues] = useState({ name: '', code: '' })
  const [syncSettings, setSyncSettings] = useState(readCmdbCloudSyncSettings)
  const [confirmEnable, setConfirmEnable] = useState(false)
  const [confirmLegacySync, setConfirmLegacySync] = useState(false)
  const [legacySyncResult, setLegacySyncResult] = useState(null)
  const [migration, setMigration] = useState(null)
  useEffect(() => { if (project) setValues({ name: project.name || '', code: project.code || '' }) }, [project])
  useEffect(() => {
    const refresh = () => setSyncSettings(readCmdbCloudSyncSettings())
    window.addEventListener(CMDB_CLOUD_SYNC_SETTINGS_EVENT, refresh)
    const refreshStorage = (event) => { if (event.key === CMDB_CLOUD_SYNC_STORAGE_KEY) refresh() }
    window.addEventListener('storage', refreshStorage)
    return () => { window.removeEventListener(CMDB_CLOUD_SYNC_SETTINGS_EVENT, refresh); window.removeEventListener('storage', refreshStorage) }
  }, [])
  const attachmentSummary = buildAttachmentStorageSummary(attachmentQuery.data)
  const updateSync = (changes) => setSyncSettings(writeCmdbCloudSyncSettings(changes))
  const syncStatus = syncSettings.lastStatus === 'error'
    ? `失败：${syncSettings.lastError || '未知错误'}`
    : syncSettings.lastSyncedAt
      ? `成功 · ${new Date(syncSettings.lastSyncedAt).toLocaleString()}`
      : '尚未同步'
  const prepareMigration = async (targetRoot, restoreDefault = false) => {
    const succeeded = await action.run(async () => {
      const preview = await api.preflightAttachmentStorage(targetRoot)
      setMigration({ preview, restoreDefault })
    })
    return succeeded
  }
  const chooseAttachmentDirectory = () => action.run(async () => {
    const target = await selectAttachmentDirectory()
    if (!target) return
    const preview = await api.preflightAttachmentStorage(target)
    setMigration({ preview, restoreDefault: false })
  })
  const confirmMigration = async () => {
    const succeeded = await action.run(async () => {
      if (migration?.restoreDefault) await api.restoreDefaultAttachmentStorage()
      else await api.migrateAttachmentStorage(migration?.preview?.target_root || '')
      await attachmentQuery.reload()
      setMigration(null)
    }, '附件目录已更新')
    if (!succeeded) return
  }
  return <div className="min-h-0 flex-1 overflow-auto">
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    {attachmentQuery.error && <ErrorBanner message={attachmentQuery.error} onRetry={attachmentQuery.reload} />}
    <section className="px-5 py-4"><div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold">项目设置</h2><p className="mt-1 text-xs text-muted-foreground">维护当前项目资料和附件存储位置</p></div><Button size="sm" disabled={!project || action.busy} onClick={() => action.run(async () => { await api.updateProject(project.id, values); query.reload() }, '项目设置已保存')}><Save size={14} className="mr-1.5" />保存设置</Button></div>
      <div className="mt-5 grid max-w-4xl grid-cols-2 gap-4"><Field label="项目名称" required><Input className="h-9" value={values.name} onChange={(event) => setValues((old) => ({ ...old, name: event.target.value }))} /></Field><Field label="项目编码" required><Input className="h-9 font-mono" value={values.code} onChange={(event) => setValues((old) => ({ ...old, code: event.target.value }))} /></Field></div>
    </section>
    <section className="border-t border-border/70 px-5 py-5" data-section="cmdb-attachment-storage"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><FolderOpen size={16} /><h3 className="text-sm font-medium">附件存储</h3></div><p className="mt-1 text-xs text-muted-foreground">工单附件按当前项目独立保存；目录切换前会先校验文件数量与大小</p></div><div className="flex shrink-0 items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={!project || action.busy || attachmentQuery.loading} onClick={chooseAttachmentDirectory}>选择目录</Button><Button type="button" size="sm" variant="ghost" disabled={!project || action.busy || attachmentQuery.loading || attachmentQuery.data?.uses_default} onClick={() => prepareMigration('', true)}>恢复默认</Button></div></div><div className="mt-4 max-w-4xl"><Field label="附件管理路径"><Input className="h-9 font-mono" value={attachmentSummary.path} readOnly /></Field><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>{attachmentSummary.modeLabel}</span><span className={attachmentQuery.data?.writable === false ? 'text-destructive' : ''}>{attachmentSummary.writableLabel}</span><span>{attachmentSummary.countLabel}</span><span>{attachmentSummary.sizeLabel}</span></div><p className="mt-2 text-[11px] text-muted-foreground">本地目录保存明文附件；启用 Netcatty 云同步且已解锁时，附件会加密后补传，未连接云端时仍可本地使用。</p></div></section>
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
        <Button type="button" size="sm" variant="outline" disabled={!syncSettings.enabled} onClick={requestCmdbCloudSync}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />立即同步</Button>
      </div>
    </section>
    <section className="border-t border-border/70 px-5 py-5" data-section="cmdb-data-maintenance">
      <div className="flex max-w-4xl items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3"><DatabaseBackup className="mt-0.5 h-4 w-4 shrink-0" /><div><h3 className="text-sm font-medium">数据维护</h3><p className="mt-1 text-xs text-muted-foreground">将当前项目的旧终端与基础设施台账幂等写入 Cmdb；已有映射会跳过，不会删除现有资产。</p></div></div>
        <Button type="button" size="sm" variant="outline" disabled={action.busy} onClick={() => setConfirmLegacySync(true)}>同步历史台账</Button>
      </div>
      {legacySyncResult ? <p className="mt-4 max-w-4xl border-y border-border/60 py-3 text-xs text-muted-foreground">上次执行结果：新增组织 {legacySyncResult.org_inserted || 0}，新增终端资产 {legacySyncResult.asset_inserted || 0}，新增基础设施 {legacySyncResult.server_inserted || 0}，跳过已有记录 {legacySyncResult.skipped || 0}。</p> : null}
    </section>
    <ConfirmDialog open={confirmEnable} onOpenChange={setConfirmEnable} title="启用 Cmdb 云同步" message="Cmdb 业务数据进入 Netcatty 现有的端到端加密同步载荷；工单附件仅在 Netcatty 已解锁且 S3 可用时加密上传，密码和密钥不会写入 Cmdb。" confirmLabel="启用" onConfirm={() => { updateSync({ enabled: true }); setConfirmEnable(false) }} />
    <ConfirmDialog open={!!migration} onOpenChange={(open) => { if (!open && !action.busy) setMigration(null) }} title={migration?.restoreDefault ? '恢复默认附件目录' : '迁移附件目录'} message={migration ? (() => { const summary = buildAttachmentMigrationSummary(migration.preview); return `源目录：${summary.source}\n目标目录：${summary.target}\n将处理 ${summary.countLabel}，共 ${summary.sizeLabel}。迁移失败时会保留原目录。` })() : ''} confirmLabel="确认迁移" busy={action.busy} onConfirm={confirmMigration} />
    <ConfirmDialog open={confirmLegacySync} onOpenChange={setConfirmLegacySync} title="同步历史台账" message="确认把当前项目的旧终端资产与基础设施台账写入 Cmdb？该操作按来源记录幂等执行，已同步记录会跳过。" confirmLabel="开始同步" busy={action.busy} onConfirm={async () => { const succeeded = await action.run(async () => { const result = await api.syncInfrastructure(); setLegacySyncResult(result); directoryChanged() }, '历史台账同步完成'); if (succeeded) setConfirmLegacySync(false) }} />
  </div>
}

export default function ConfigCenter() {
  const project = useQuery(api.projects)
  const projectLabel = useMemo(() => project.data?.list?.[0]?.name || '当前项目', [project.data])
  const [section, setSection] = useState('assets')
  return <div className="flex h-full min-h-0 flex-col">
    <VaultPageHeader dataSection="cmdb-config-header"><strong className="text-sm">Cmdb</strong><span className="ml-1 text-[11px] text-muted-foreground">当前项目：{projectLabel}</span></VaultPageHeader>
    <Tabs value={section} onValueChange={setSection} className="shrink-0 border-b border-border/70 px-5 py-2">
      <TabsList className="h-8 bg-muted/60">
        <TabsTrigger value="assets" className="h-7 px-4 text-xs">资产配置</TabsTrigger>
        <TabsTrigger value="work" className="h-7 px-4 text-xs">工单配置</TabsTrigger>
        <TabsTrigger value="project" className="h-7 px-4 text-xs">项目与数据</TabsTrigger>
      </TabsList>
    </Tabs>
    <div className="min-h-0 flex-1 overflow-y-auto" data-section="cmdb-settings-content">
      {section === 'assets' && <div data-section="cmdb-settings-assets">
        <TaxonomySettings />
        <SettingsCatalogSection title="网络类型" icon={Network} section="cmdb-settings-network" load={loadNetworkTypes} renderItem={(item) => item.name}><NetworkSettings /></SettingsCatalogSection>
        <SettingsCatalogSection title="型号库" icon={HardDrive} section="cmdb-settings-models" load={loadModels} renderItem={(item) => `${item.vendor} · ${item.model}`}><ModelSettings /></SettingsCatalogSection>
      </div>}
      {section === 'work' && <div data-section="cmdb-settings-work-orders"><NumberRule />
        {WORK_TABS.filter(([kind]) => kind !== 'rule').map(([kind, label]) => <SettingsCatalogSection key={kind} title={label} icon={ListChecks} section={`cmdb-settings-${kind}`} load={specifications[kind].load} renderItem={(item) => item.name}><ConfigCatalog kind={kind} /></SettingsCatalogSection>)}
      </div>}
      {section === 'project' && <div data-section="cmdb-settings-project"><ProjectSettings /><TemplateSettings /></div>}
    </div>
  </div>
}
