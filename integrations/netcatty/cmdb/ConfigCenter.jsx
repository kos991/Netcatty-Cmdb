import React, { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from './api'
import { allPages, useAction, useQuery } from './hooks'
import { textFields } from './Fields'
import { ErrorBanner, Field, SelectControl } from './ui'
import Catalog from './Catalog'
import Credentials from './Credentials'
import Labels from './Labels'

const GROUPS = [['asset', '资产配置'], ['work', '工单配置'], ['project', '项目设置']]
const ASSET_TABS = [['device-types', '设备类型'], ['software', '软件目录'], ['locations', '位置目录'], ['statuses', '设备状态'], ['models', '厂商与型号'], ['credentials', '凭证中心'], ['labels', '编码与标签']]
const WORK_TABS = [['rule', '编号规则'], ['work-order-categories', '工单类别'], ['work-order-types', '运维类型'], ['work-order-priorities', '优先级']]
const BASIC = [{ key: 'name', label: '名称', required: true }, { key: 'remark', label: '说明', type: 'textarea' }, { key: 'sort_order', label: '排序', type: 'number', min: 0 }]
const MODELS = textFields([['vendor', '厂商'], ['model', '型号']]).map((field) => ({ ...field, required: field.key === 'model' }))
const RULE_DEFAULTS = { name: 'GD', vendor: '-', version: 'YYYYMMDD', remark: '每日', sort_order: 4 }

const specifications = Object.fromEntries([...ASSET_TABS, ...WORK_TABS.filter(([key]) => key !== 'rule')].map(([kind, title]) => [kind, {
  title,
  load: async () => kind === 'models' ? allPages(api.models) : (await api.config(kind)).list || [],
  save: async (values, original) => {
    if (kind === 'models') return original.id ? api.updateModel(original.id, values) : api.createModel(values)
    return original.id ? api.updateConfig(kind, original.id, values) : api.createConfig(kind, values)
  },
  remove: (row) => kind === 'models' ? api.deleteModel(row.id) : api.deleteConfig(kind, row.id),
}]))

function TabButton({ active, onClick, children }) {
  return <button type="button" onClick={onClick} className={`h-full border-b-2 px-4 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{children}</button>
}

function fieldsFor(kind, original, items) {
  if (kind === 'models') return MODELS
  if (kind === 'software') return [...BASIC, ...textFields([['vendor', '厂商'], ['version', '版本']])]
  if (kind === 'device-types') {
    const excluded = new Set(original?.id ? [original.id] : [])
    let changed = true
    while (changed) { changed = false; items.forEach((item) => { if (excluded.has(item.parent_id) && !excluded.has(item.id)) { excluded.add(item.id); changed = true } }) }
    return [...BASIC, { key: 'parent_id', label: '上级类型', numeric: true, options: [{ value: 0, label: '顶级类型' }, ...items.filter((item) => !excluded.has(item.id)).map((item) => ({ value: item.id, label: item.name }))] }]
  }
  return BASIC
}

function ConfigCatalog({ kind }) {
  const spec = specifications[kind]
  const load = React.useCallback(async () => spec.load(), [spec])
  const columns = kind === 'models' ? MODELS.map(({ key, label }) => ({ key, label })) : [
    { key: 'name', label: '名称' },
    ...(kind === 'software' ? [{ key: 'vendor', label: '厂商' }, { key: 'version', label: '版本' }] : []),
    { key: 'remark', label: '说明' },
    { key: 'sort_order', label: '排序' },
  ]
  return <Catalog key={kind} {...spec} load={load} defaults={{ sort_order: 0, parent_id: 0 }} columns={columns} fields={(_, original, items) => fieldsFor(kind, original, items)} />
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
      <div className="mt-4 grid grid-cols-5 gap-3">
        <Field label="固定前缀" required><Input className="h-9 font-mono" value={values.name} onChange={(event) => change('name', event.target.value.toUpperCase())} /></Field>
        <Field label="分隔符"><SelectControl className="w-full" value={values.vendor} onChange={(value) => change('vendor', value)} options={[{ value: '-', label: '短横线 -' }, { value: '_', label: '下划线 _' }, { value: '', label: '无分隔符' }]} /></Field>
        <Field label="日期段"><SelectControl className="w-full" value={values.version} onChange={(value) => change('version', value)} options={[{ value: 'YYYYMMDD', label: '年月日 YYYYMMDD' }, { value: 'YYYYMM', label: '年月 YYYYMM' }, { value: 'YYYY', label: '年 YYYY' }, { value: 'NONE', label: '无日期段' }]} /></Field>
        <Field label="流水号位数"><SelectControl className="w-full" value={String(values.sort_order)} onChange={(value) => change('sort_order', Number(value))} options={[3, 4, 5, 6, 7, 8].map((value) => ({ value: String(value), label: String(value) }))} /></Field>
        <Field label="重置周期"><SelectControl className="w-full" value={values.remark} onChange={(value) => change('remark', value)} options={['每日', '每月', '每年', '不重置'].map((value) => ({ value, label: value }))} /></Field>
      </div>
    </section>
    <div className="grid grid-cols-4 border-b border-border/70">
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
  useEffect(() => { if (project) setValues({ name: project.name || '', code: project.code || '' }) }, [project])
  const attachmentPath = `cmdb/attachments/${values.code || 'default'}`
  return <div className="min-h-0 flex-1 overflow-auto">
    {query.error && <ErrorBanner message={query.error} onRetry={query.reload} />}
    <section className="px-5 py-4"><div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold">项目设置</h2><p className="mt-1 text-xs text-muted-foreground">维护当前项目资料和附件存储位置</p></div><Button size="sm" disabled={!project || action.busy} onClick={() => action.run(async () => { await api.updateProject(project.id, values); query.reload() }, '项目设置已保存')}><Save size={14} className="mr-1.5" />保存设置</Button></div>
      <div className="mt-5 grid max-w-4xl grid-cols-2 gap-4"><Field label="项目名称" required><Input className="h-9" value={values.name} onChange={(event) => setValues((old) => ({ ...old, name: event.target.value }))} /></Field><Field label="项目编码" required><Input className="h-9 font-mono" value={values.code} onChange={(event) => setValues((old) => ({ ...old, code: event.target.value }))} /></Field></div>
    </section>
    <section className="border-t border-border/70 px-5 py-5"><div className="flex items-center gap-2"><FolderOpen size={16} /><h3 className="text-sm font-medium">附件存储</h3></div><p className="mt-1 text-xs text-muted-foreground">工单附件按项目独立保存</p><div className="mt-4 max-w-4xl"><Field label="附件管理路径"><Input className="h-9 font-mono" value={attachmentPath} readOnly /></Field><p className="mt-2 text-[11px] text-muted-foreground">相对于 Netcatty 用户数据目录；绝对路径不参与云同步。</p></div></section>
  </div>
}

export default function ConfigCenter() {
  const [group, setGroup] = useState('work')
  const [assetTab, setAssetTab] = useState('device-types')
  const [workTab, setWorkTab] = useState('rule')
  const project = useQuery(api.projects)
  const projectLabel = useMemo(() => project.data?.list?.[0]?.name || '当前项目', [project.data])
  let content
  if (group === 'project') content = <ProjectSettings />
  else if (group === 'work') content = workTab === 'rule' ? <NumberRule /> : <ConfigCatalog kind={workTab} />
  else content = assetTab === 'credentials' ? <Credentials /> : assetTab === 'labels' ? <Labels /> : <ConfigCatalog kind={assetTab} />
  const tabs = group === 'asset' ? ASSET_TABS : group === 'work' ? WORK_TABS : []
  const selected = group === 'asset' ? assetTab : workTab
  const selectTab = group === 'asset' ? setAssetTab : setWorkTab
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-[62px] shrink-0 items-center border-b border-border/70 px-5"><strong className="text-sm">配置中心</strong><span className="ml-3 text-[11px] text-muted-foreground">当前项目：{projectLabel}</span></header>
    <nav className="flex h-[46px] shrink-0 items-stretch border-b border-border/70 px-3" aria-label="配置分类">{GROUPS.map(([key, label]) => <TabButton key={key} active={group === key} onClick={() => setGroup(key)}>{label}</TabButton>)}</nav>
    {tabs.length > 0 && <nav className="flex h-[48px] shrink-0 items-stretch border-b border-border/70 px-3" aria-label="配置项目">{tabs.map(([key, label]) => <TabButton key={key} active={selected === key} onClick={() => selectTab(key)}>{label}</TabButton>)}<span className="ml-auto self-center pr-3 text-[11px] text-muted-foreground">配置仅作用于当前项目</span></nav>}
    {content}
  </div>
}
