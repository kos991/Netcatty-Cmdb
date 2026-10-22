import React, { useEffect, useState } from 'react'
import { Boxes, Cloud, Database, Download, FolderOpen, ListChecks, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  SettingCard,
  SettingRow,
  SettingsSection,
} from '@/components/settings/settings-ui'
import { useOptionalSettingsFocus } from '@/components/settings/SettingsFocusContext'
import { cancelSettingsFocus, focusSettingsAnchor } from '@/components/settings/settingsFocus'
import { api } from './api'
import { allPages, directoryChanged, useAction, useDirectory, useQuery } from './hooks'
import { ErrorBanner, Field, SelectControl } from './ui'
import SettingsCatalogEditor from './SettingsCatalogEditor'
import SettingsProjectStorage from './SettingsProjectStorage'
import SettingsSyncMaintenance from './SettingsSyncMaintenance'
import { CMDB_SETTINGS_SEARCH_ENTRIES } from './settingsNavigation'
import CmdbVersionBadge from './CmdbVersionBadge'
import Taxonomy from './Taxonomy'
import './settings.css'

const WORK_TABS = [['rule', '编号规则'], ['work-order-categories', '工单类别'], ['work-order-types', '运维类型'], ['work-order-priorities', '优先级']]
const BASIC = [{ key: 'name', label: '名称', required: true }, { key: 'remark', label: '说明', type: 'textarea' }, { key: 'sort_order', label: '排序', type: 'number', min: 0 }]
const RULE_DEFAULTS = { name: 'GD', vendor: '-', version: 'YYYYMMDD', remark: '每日', sort_order: 4 }
const TAXONOMIES = [['terminal-categories', '终端设备类型'], ['infrastructure-categories', '基础设施设备类型'], ['application-categories', '业务系统类型']]
const CATALOG_DEFAULTS = { sort_order: 0 }
const MODEL_DEFAULTS = { vendor: '', model: '' }
const MODEL_FIELDS = [{ key: 'vendor', label: '品牌 / 厂商', required: true }, { key: 'model', label: '型号', required: true }]
const NETWORK_TYPE_FIELDS = [
  { key: 'name', label: '名称', required: true },
  {
    key: 'color',
    label: '颜色',
    render: ({ current, onChange: change }) => <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="选择网络类型颜色"
        className="h-9 w-12 shrink-0 cursor-pointer rounded border border-input bg-background p-0.5"
        value={/^#[0-9A-Fa-f]{6}$/.test(String(current || '')) ? String(current) : '#94A3B8'}
        onChange={(event) => change(event.target.value.toUpperCase())}
      />
      <Input className="h-9 min-w-0 flex-1 font-mono text-xs" aria-label="网络类型颜色值" placeholder="留空使用灰色" value={current || ''} onChange={(event) => change(event.target.value.trim().toUpperCase())} />
      <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={() => change('')}>用默认灰</Button>
    </div>,
    validate: (value) => {
      const text = String(value || '').trim()
      if (text && !/^#[0-9A-Fa-f]{6}$/.test(text)) throw new Error('颜色需为 #RRGGBB 或留空')
    },
  },
  { key: 'remark', label: '说明', type: 'textarea' },
  { key: 'sort_order', label: '排序', type: 'number', min: 0 },
]
const loadWorkOrderRule = () => api.config('work-order-rule')

function CatalogSettingRow({ title, summary, onEdit, anchorId }) {
  return <SettingRow anchorId={anchorId} label={title} description={summary}>
    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onEdit}>编辑</Button>
  </SettingRow>
}

function entrySummary(entries, renderItem) {
  if (!entries?.length) return '暂无配置'
  const names = entries.slice(0, 3).map(renderItem).join('、')
  return entries.length > 3 ? `${names} 等 ${entries.length} 项` : names
}

const specifications = {
  ...Object.fromEntries([...WORK_TABS.filter(([key]) => key !== 'rule'), ['network-types', '网络类型']].map(([kind, title]) => [kind, {
    title,
    load: async () => (await api.config(kind)).list || [],
    save: (values, original) => original.id ? api.updateConfig(kind, original.id, values) : api.createConfig(kind, values),
    remove: (row) => api.deleteConfig(kind, row.id),
    fields: kind === 'network-types' ? NETWORK_TYPE_FIELDS : BASIC,
    defaults: CATALOG_DEFAULTS,
  }])),
  models: {
    title: '型号库', load: () => allPages(api.models), fields: MODEL_FIELDS, defaults: MODEL_DEFAULTS,
    save: (values, original) => original.id ? api.updateModel(original.id, values) : api.createModel(values),
    remove: (row) => api.deleteModel(row.id),
  },
}

function TaxonomySettings() {
  const [selectedKind, setSelectedKind] = useState(null)
  const load = React.useCallback(() => Promise.all(TAXONOMIES.map(async ([kind, label]) => ({ kind, label, entries: (await api.taxonomy(kind)).list || [] }))), [])
  const query = useDirectory(load)
  return <>
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <div className="divide-y divide-border" data-section="cmdb-settings-catalog">{TAXONOMIES.map(([kind, label]) => <CatalogSettingRow key={kind} anchorId={`cmdb-${kind}`} title={label} summary={query.loading && !query.data ? '正在读取目录…' : entrySummary(query.data?.find((item) => item.kind === kind)?.entries, (entry) => entry.name)} onEdit={() => setSelectedKind(kind)} />)}</div>
    {TAXONOMIES.map(([kind]) => <Taxonomy key={kind} initialKind={kind} open={selectedKind === kind} onOpenChange={(open) => { if (!open) setSelectedKind(null) }} onChanged={() => directoryChanged()} />)}
  </>
}

// 为历史未命名终端按「项目名称-设备简称-流水号」补全名称：先预览，确认后一次写入，已有名称不覆盖。
function TerminalNamingSettings() {
  const load = React.useCallback(() => api.terminalNamePreview(), [])
  const query = useDirectory(load)
  const [open, setOpen] = useState(false)
  const action = useAction()
  const list = query.data?.list || []
  const description = query.data
    ? list.length ? `${list.length} 台终端未命名，将从 ${list[0].name} 开始生成；已有名称不覆盖` : '所有终端均已命名；新增终端名称留空时自动生成'
    : '正在统计未命名终端…'
  const apply = () => action.run(async () => {
    const result = await api.applyTerminalNames()
    setOpen(false)
    query.reload()
    directoryChanged()
    return result
  }, '终端名称已补全')
  return <>
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <SettingRow anchorId="cmdb-naming" label="终端命名" description={description}>
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={!list.length} onClick={() => setOpen(true)}>补全名称</Button>
    </SettingRow>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="cmdb-theme-scope cmdb-record-shell cmdb-settings-dialog flex w-[min(640px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-section="terminal-naming-preview">
        <DialogHeader className="cmdb-record-header"><div className="min-w-0 pr-6"><DialogTitle>补全终端名称（{list.length} 台）</DialogTitle><p className="cmdb-settings-dialog-note">名称留空的终端按“项目名称-设备简称-流水号”生成，已有名称不覆盖。</p></div></DialogHeader>
        <div className="cmdb-record-body">
          <div className="max-h-80 overflow-auto rounded-lg border border-border/60 bg-background">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-muted-foreground"><tr><th className="px-3 py-2 text-left font-normal">新名称</th><th className="px-3 py-2 text-left font-normal">资产编码</th><th className="px-3 py-2 text-left font-normal">设备类型</th><th className="px-3 py-2 text-left font-normal">使用人</th></tr></thead>
              <tbody className="divide-y divide-border/60">{list.slice(0, 200).map((item) => <tr key={item.id}><td className="px-3 py-1.5 font-mono">{item.name}</td><td className="px-3 py-1.5">{item.asset_code || '-'}</td><td className="px-3 py-1.5">{item.device_type || '-'}</td><td className="px-3 py-1.5">{item.user_name || '-'}</td></tr>)}</tbody>
            </table>
          </div>
          {list.length > 200 ? <p className="mt-3 text-[11px] text-muted-foreground">仅预览前 200 台，确认后全部 {list.length} 台按相同规则写入。</p> : null}
        </div>
        <div className="cmdb-record-footer"><Button variant="outline" onClick={() => setOpen(false)} disabled={action.busy}>取消</Button><Button className="cmdb-primary-action" onClick={apply} disabled={action.busy}>{action.busy ? '写入中…' : `确认写入 ${list.length} 台`}</Button></div>
      </DialogContent>
    </Dialog>
  </>
}

function SettingsCatalogSection({ kind }) {
  const spec = specifications[kind]
  const [open, setOpen] = useState(false)
  const query = useDirectory(spec.load)
  return <div>
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <CatalogSettingRow anchorId={`cmdb-${kind}`} title={spec.title} summary={query.loading && !query.data ? '正在读取目录…' : entrySummary(query.data, (item) => item.name || `${item.vendor} · ${item.model}`)} onEdit={() => setOpen(true)} />
    <SettingsCatalogEditor {...spec} open={open} onOpenChange={setOpen} />
  </div>
}

function TemplateSettings() {
  const action = useAction()
  const templates = [['terminal', '终端资产', api.downloadAssetTemplate], ['infrastructure', '基础设施', api.downloadInfrastructureTemplate], ['ip', 'IP 地址', api.downloadIPTemplate], ['work-order', '工单', api.downloadWorkOrderTemplate]]
  return <SettingsSection title="导入模板">
    <SettingCard divided>
      {templates.map(([key, label, download]) => <SettingRow anchorId={`cmdb-template-${key}`} key={key} label={label} description="下载模板后，在对应业务页导入；导出沿用查询条件"><Button size="sm" className="h-8 text-xs" variant="outline" disabled={action.busy} onClick={() => action.run(download)}><Download size={14} className="mr-1.5" />下载模板</Button></SettingRow>)}
    </SettingCard>
  </SettingsSection>
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
    <CatalogSettingRow anchorId="cmdb-rule" title="工单编号规则" summary={`${record ? '已启用' : '默认规则'} · ${preview} · ${values.remark}`} onEdit={() => setOpen(true)} />
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="cmdb-theme-scope cmdb-record-shell cmdb-settings-dialog flex w-[min(600px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="cmdb-record-header"><DialogTitle className="pr-6">编辑工单编号规则</DialogTitle></DialogHeader>
        <form id="cmdb-work-order-rule-form" className="cmdb-record-body" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <div className="cmdb-record-section"><div className="cmdb-record-fields">
            <Field label="固定前缀" required><Input className="font-mono" value={values.name} onChange={(event) => change('name', event.target.value.toUpperCase())} /></Field>
            <Field label="分隔符"><SelectControl className="w-full" value={values.vendor} onChange={(value) => change('vendor', value)} options={[{ value: '-', label: '短横线 -' }, { value: '_', label: '下划线 _' }, { value: '', label: '无分隔符' }]} /></Field>
            <Field label="日期段"><SelectControl className="w-full" value={values.version} onChange={(value) => change('version', value)} options={[{ value: 'YYYYMMDD', label: '年月日 YYYYMMDD' }, { value: 'YYYYMM', label: '年月 YYYYMM' }, { value: 'YYYY', label: '年 YYYY' }, { value: 'NONE', label: '无日期段' }]} /></Field>
            <Field label="流水号位数"><SelectControl className="w-full" value={String(values.sort_order)} onChange={(value) => change('sort_order', Number(value))} options={[3, 4, 5, 6, 7, 8].map((value) => ({ value: String(value), label: String(value) }))} /></Field>
            <Field label="重置周期"><SelectControl className="w-full" value={values.remark} onChange={(value) => change('remark', value)} options={['每日', '每月', '每年', '不重置'].map((value) => ({ value, label: value }))} /></Field>
          </div></div>
          <p className="mt-3 truncate font-mono text-xs text-muted-foreground" title={preview}>格式示例：{preview}</p>
        </form>
        <div className="cmdb-record-footer"><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={action.busy}>取消</Button><Button className="cmdb-primary-action" type="submit" form="cmdb-work-order-rule-form" disabled={action.busy}><Save size={14} />保存规则</Button></div>
      </DialogContent>
    </Dialog>
  </div>
}

const PANELS = [
  ['assets', '资产目录', Boxes], ['work', '工单配置', ListChecks], ['templates', '导入模板', Download],
  ['project', '项目存储', FolderOpen], ['sync', '同步维护', Cloud],
]

export default function ConfigCenter() {
  const project = useQuery(api.currentProject)
  const focus = useOptionalSettingsFocus()
  const request = focus?.request
  const clearFocus = focus?.clearFocus
  const [section, setSection] = useState('assets')
  useEffect(() => {
    if (request?.tab !== 'cmdb') return
    const destination = CMDB_SETTINGS_SEARCH_ENTRIES.find((entry) => entry.id === request.anchorId)
    if (!destination) { clearFocus?.(); return }
    if (section !== destination.tab) { setSection(destination.tab); return }
    let cancelled = false
    // The host leaves Cmdb requests pending through the first lazy mount.
    const timer = window.setTimeout(() => {
      void focusSettingsAnchor(request.anchorId).finally(() => { if (!cancelled) clearFocus?.() })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer); cancelSettingsFocus() }
  }, [request, section, clearFocus])
  const content = {
    assets: <div className="cmdb-settings-sections" data-section="cmdb-settings-assets">
      <SettingsSection title="资产类型"><SettingCard><TaxonomySettings /><div className="border-t border-border"><TerminalNamingSettings /></div></SettingCard></SettingsSection>
      <SettingsSection title="网络与型号"><SettingCard divided><SettingsCatalogSection kind="network-types" /><SettingsCatalogSection kind="models" /></SettingCard></SettingsSection>
    </div>,
    work: <div className="cmdb-settings-sections" data-section="cmdb-settings-work"><SettingsSection title="工单配置"><SettingCard divided><NumberRule />{WORK_TABS.filter(([kind]) => kind !== 'rule').map(([kind]) => <SettingsCatalogSection key={kind} kind={kind} />)}</SettingCard></SettingsSection></div>,
    templates: <div className="cmdb-settings-sections"><TemplateSettings /></div>,
    project: <SettingsProjectStorage project={project.data} onSaved={project.reload} />,
    sync: <SettingsSyncMaintenance project={project.data} />,
  }
  return <TabsContent value="cmdb" forceMount className="cmdb-theme-scope m-0 h-full min-h-0 min-w-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
    <Tabs value={section} onValueChange={setSection} className="flex h-full min-h-0 flex-col overflow-hidden bg-background" data-section="cmdb-settings-content">
      <div className="cmdb-settings-header" data-section="cmdb-config-header">
        <div className="cmdb-settings-heading">
          <h2 className="flex min-w-0 items-center gap-2"><Database size={17} className="shrink-0 text-muted-foreground" /><span className="truncate">Cmdb</span><CmdbVersionBadge /></h2>
          <span className="cmdb-settings-project" title={project.data ? `当前项目：${project.data.name}` : undefined}>{project.data ? `当前项目：${project.data.name}` : project.loading ? '正在读取当前项目…' : '未读取到当前项目'}</span>
        </div>
        <TabsList aria-label="Cmdb 配置分区" className="cmdb-settings-tabs h-auto justify-start">
          {PANELS.map(([key, label, Icon]) => <TabsTrigger key={key} value={key} className="cmdb-settings-tab"><Icon size={14} /><span>{label}</span></TabsTrigger>)}
        </TabsList>
      </div>
      {project.error && <ErrorBanner message={project.error} onRetry={project.reload} />}
      <div className="cmdb-settings-panes">
        {PANELS.map(([key]) => <TabsContent key={key} value={key} forceMount data-settings-scroll-pane className="cmdb-settings-pane mt-0 data-[state=inactive]:hidden">{content[key]}</TabsContent>)}
      </div>
    </Tabs>
  </TabsContent>
}
