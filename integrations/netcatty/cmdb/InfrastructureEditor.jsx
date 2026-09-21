import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Building2, Cpu, KeyRound, Network, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { choices, Fields, textFields, validateFields } from './Fields'
import { Field, SelectControl } from './ui'

const SECTIONS = [
  ['basic', '基础信息', Box],
  ['credentials', '凭证关联', KeyRound],
  ['ownership', '归属关系', Building2],
  ['network', '网络配置', Network],
  ['system', '系统与软件', Cpu],
]

const DEVICE_TYPES = [
  ['server', '服务器'], ['virtual_machine', '虚拟机'], ['switch', '交换机'],
  ['router', '路由器'], ['security_device', '安全设备'], ['storage', '存储设备'],
].map(([value, label]) => ({ value, label }))

const optionList = (items = [], blank = '未分配') => choices(items.map((item) => ({ value: item.id, label: item.name })), blank)

function Section({ sectionKey, title, sectionRefs, children }) {
  return <section ref={(node) => { sectionRefs.current[sectionKey] = node }} data-asset-section={sectionKey} className="scroll-mt-4 border-b border-border/70 px-5 py-5 last:border-b-0">
    <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
    {children}
  </section>
}

function CredentialPicker({ credentials, assetId, selected, onChange }) {
  const available = credentials.filter((item) => !item.asset_id || item.asset_id === assetId)
  if (!available.length) return <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">凭证中心暂无可关联凭证</div>
  return <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
    {available.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 hover:bg-muted/40">
      <input type="checkbox" className="mt-1" checked={selected.includes(item.id)} onChange={(event) => onChange(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
      <span className="min-w-0"><strong className="block truncate text-sm font-medium">{item.name}</strong><span className="text-xs text-muted-foreground">{item.cred_type || '未分类'}{item.description ? ` · ${item.description}` : ''}</span></span>
    </label>)}
  </div>
}

function NetworkInterfaces({ interfaces, zones, onChange }) {
  const update = (index, patch) => onChange(interfaces.map((item, current) => current === index ? { ...item, ...patch } : item))
  const add = () => onChange([...interfaces, { name: `eth${interfaces.length}`, ip: '', mask: '', gateway: '', mac: '', network_zone: '未分类', is_primary: interfaces.length ? 0 : 1, remark: '' }])
  const remove = (index) => {
    const next = interfaces.filter((_, current) => current !== index)
    if (interfaces[index]?.is_primary && next.length) next[0] = { ...next[0], is_primary: 1 }
    onChange(next)
  }
  const setPrimary = (index) => onChange(interfaces.map((item, current) => ({ ...item, is_primary: current === index ? 1 : 0 })))
  return <div className="space-y-3">
    {interfaces.map((item, index) => <div key={item.id || `new-${index}`} className="border-b border-border/60 pb-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-3"><button type="button" onClick={() => setPrimary(index)} className={`text-xs font-medium ${item.is_primary ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{item.is_primary ? '主接口' : '设为主接口'}</button><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="删除网卡" onClick={() => remove(index)}><Trash2 size={14} /></Button></div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="接口名称"><Input className="h-9" value={item.name || item.if_name || ''} onChange={(event) => update(index, { name: event.target.value, if_name: event.target.value })} /></Field>
        <Field label="IP 地址" required><Input className="h-9 font-mono" value={item.ip || ''} onChange={(event) => update(index, { ip: event.target.value })} /></Field>
        <Field label="网络分区"><SelectControl className="w-full" value={item.network_zone || item.net_zone || ''} onChange={(value) => update(index, { network_zone: value, net_zone: value })} options={choices(zones)} /></Field>
        <Field label="掩码 / 前缀"><Input className="h-9 font-mono" value={item.mask || ''} onChange={(event) => update(index, { mask: event.target.value })} /></Field>
        <Field label="网关"><Input className="h-9 font-mono" value={item.gateway || ''} onChange={(event) => update(index, { gateway: event.target.value })} /></Field>
        <Field label="MAC 地址"><Input className="h-9 font-mono" value={item.mac || ''} onChange={(event) => update(index, { mac: event.target.value })} /></Field>
        <Field label="VLAN"><Input className="h-9" type="number" min="0" value={item.vlan_id || 0} onChange={(event) => update(index, { vlan_id: Number(event.target.value) })} /></Field>
        <Field label="备注" className="md:col-span-2"><Input className="h-9" value={item.remark || ''} onChange={(event) => update(index, { remark: event.target.value })} /></Field>
      </div>
    </div>)}
    <Button type="button" variant="outline" size="sm" onClick={add}><Plus size={14} className="mr-1" />添加网卡</Button>
  </div>
}

export default function InfrastructureEditor({ open, onOpenChange, record, directory, busy, onSubmit }) {
  const [active, setActive] = useState('basic')
  const [values, setValues] = useState(record || {})
  const [credentialIds, setCredentialIds] = useState([])
  const sectionRefs = useRef({})
  const meta = directory?.meta || {}
  const people = directory?.people || []
  const credentials = useMemo(() => directory?.credentials || [], [directory?.credentials])

  useEffect(() => {
    if (!open || !record) return
    setActive('basic')
    setValues({ ...record, interfaces: record.interfaces || [] })
    setCredentialIds(credentials.filter((item) => item.asset_id === record.id).map((item) => item.id))
  }, [open, record, credentials])

  const models = useMemo(() => meta.models || [], [meta.models])
  const basicFields = useMemo(() => [
    { key: 'name', label: '设备名称', required: true },
    { key: 'asset_code', label: '资产编码' },
    { key: 'asset_class', label: '资产大类', options: choices([{ value: 'physical', label: '物理硬件' }, { value: 'virtual', label: '虚拟资源' }]) },
    { key: 'device_type', label: '设备类型', options: choices(DEVICE_TYPES) },
    { key: 'category_id', label: '设备分类', numeric: true, searchable: true, options: optionList(meta.categories) },
    { key: 'status', label: '状态', options: choices(meta.statuses || []) },
    { key: 'sn', label: 'SN' },
    { key: 'tags', label: '资产标签' },
    { key: 'model_id', label: '设备模型', numeric: true, searchable: true, options: choices(models.map((item) => ({ value: item.id, label: [item.vendor, item.model].filter(Boolean).join(' · ') })), '未选择'), derive: (id) => {
      const model = models.find((item) => item.id === id)
      return model ? { vendor: model.vendor, model: model.model } : {}
    } },
    { key: 'vendor', label: '厂商' },
    { key: 'model', label: '型号' },
  ], [meta.categories, meta.statuses, models])

  const ownershipFields = [
    { key: 'org_id', label: '所属组织', numeric: true, searchable: true, options: optionList(meta.orgs) },
    { key: 'group_id', label: '所属分组', numeric: true, searchable: true, options: optionList(meta.groups) },
    { key: 'owner_id', label: '负责人', numeric: true, searchable: true, options: choices(people.map((person) => ({ value: person.id, label: [person.name, person.department].filter(Boolean).join(' · ') })), '未分配'), derive: (id) => {
      const person = people.find((item) => item.id === id)
      return person ? { owner: person.name, department: person.department } : { owner: '', department: '' }
    } },
    ...textFields([['department', '部门'], ['owner', '负责人姓名']]),
  ]
  const systemFields = [{ key: 'os_type', label: '操作系统类型', options: choices(['Linux', 'Windows', 'Unix', '网络设备系统', '存储系统', '其他', '未知']) }, ...textFields([['os_version', '操作系统版本'], ['security_software', '软件安装情况'], ['remark', '备注', 'textarea']])]

  if (!record) return null
  const submit = () => {
    try {
      validateFields(basicFields, values)
      for (const [index, item] of (values.interfaces || []).entries()) {
        if (!String(item.ip || '').trim()) throw new Error(`请填写第 ${index + 1} 个网卡的 IP 地址`)
      }
      onSubmit(values, credentialIds)
    } catch (error) {
      toast.error(error.message)
    }
  }
  const jump = (key) => {
    setActive(key)
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="grid h-[min(860px,92vh)] w-[min(1180px,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b border-border px-5 py-4 pr-12"><DialogTitle>{record.id ? '编辑基础设施' : '新增基础设施'}</DialogTitle></DialogHeader>
      <div className="grid min-h-0 grid-cols-[168px_minmax(0,1fr)]">
        <nav className="overflow-y-auto border-r border-border bg-muted/20 p-2" aria-label="资产表单分区">
          {SECTIONS.map(([key, label, Icon]) => <button type="button" key={key} onClick={() => jump(key)} className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs ${active === key ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon size={14} />{label}</button>)}
        </nav>
        <form id="cmdb-infrastructure-editor" onSubmit={(event) => { event.preventDefault(); submit() }} className="min-h-0 overflow-y-auto scroll-smooth">
          <Section sectionKey="basic" title="基础信息" sectionRefs={sectionRefs}><Fields fields={basicFields} value={values} onChange={setValues} /></Section>
          <Section sectionKey="credentials" title="凭证关联" sectionRefs={sectionRefs}><p className="mb-3 text-xs text-muted-foreground">关联凭证中心的元信息，不在资产档案中保存明文口令。</p><CredentialPicker credentials={credentials} assetId={record.id || 0} selected={credentialIds} onChange={setCredentialIds} /></Section>
          <Section sectionKey="ownership" title="归属关系" sectionRefs={sectionRefs}><Fields fields={ownershipFields} value={values} onChange={setValues} /></Section>
          <Section sectionKey="network" title="网络配置" sectionRefs={sectionRefs}><div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2"><Field label="管理 IP（主接口自动带出）"><Input className="h-9 bg-muted/30 font-mono" readOnly value={(values.interfaces || []).find((item) => item.is_primary)?.ip || values.mgmt_ip || ''} /></Field><Field label="设备级 MAC 地址"><Input className="h-9 font-mono" value={values.mac || ''} onChange={(event) => setValues({ ...values, mac: event.target.value })} /></Field></div><NetworkInterfaces interfaces={values.interfaces || []} zones={meta.net_zones || []} onChange={(interfaces) => setValues({ ...values, interfaces, mgmt_ip: interfaces.find((item) => item.is_primary)?.ip || '' })} /></Section>
          <Section sectionKey="system" title="系统与软件" sectionRefs={sectionRefs}><Fields fields={systemFields} value={values} onChange={setValues} /></Section>
        </form>
      </div>
      <DialogFooter className="border-t border-border bg-background px-5 py-3"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button><Button type="submit" form="cmdb-infrastructure-editor" disabled={busy}>{busy ? <Spinner className="mr-2" /> : null}保存</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
