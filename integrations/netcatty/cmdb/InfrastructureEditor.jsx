import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Building2, Cpu, Image as ImageIcon, KeyRound, Network, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { AsidePanel, AsidePanelFooter } from '@/components/ui/aside-panel'
import { Card } from '@/components/ui/card'
import { toast } from '@/components/ui/toast'
import { choices, Fields, textFields, validateFields } from './Fields'
import { managementIPFromInterfaces, prepareInfrastructureEditorValues, resolveInfrastructureModelID } from './infrastructureEditorModel'
import { customFieldDefinitions, infrastructureDeviceTypeOptions, infrastructureFieldProfile, supportsInfrastructurePhotos } from './state'
import { Field, SelectControl } from './ui'
import NetcattyConnectionFields from './NetcattyConnectionFields'
import DeviceImages from './DeviceImages'
import VendorBrandInput from './VendorBrandInput'

const optionList = (items = [], blank = '未分配') => choices(items.map((item) => ({ value: item.id, label: item.name })), blank)

function Section({ sectionKey, title, sectionRefs, children }) {
  return <section ref={(node) => { sectionRefs.current[sectionKey] = node }} data-asset-section={sectionKey} className="scroll-mt-3">
    <Card className="space-y-3 rounded-md border-border/80 bg-card p-4 shadow-none"><h3 className="text-xs font-semibold text-foreground">{title}</h3>{children}</Card>
  </section>
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
        <Field label={item.is_primary ? '管理 IP / 接口 IP' : 'IP 地址'} required><Input className="h-9 font-mono" value={item.ip || ''} onChange={(event) => update(index, { ip: event.target.value })} /></Field>
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

export default function InfrastructureEditor({ open, onOpenChange, record, directory, busy, onSubmit, netcatty, photoDraft = {}, onPhotoDraftChange }) {
  const [active, setActive] = useState('basic')
  const [values, setValues] = useState(record || {})
  const [photoBusy, setPhotoBusy] = useState(false)
  const sectionRefs = useRef({})
  const formRef = useRef(null)
  const meta = directory?.meta || {}
  const people = directory?.people || []
  const deviceTypes = useMemo(() => directory?.deviceTypes || [], [directory?.deviceTypes])
  const models = useMemo(() => meta.models || [], [meta.models])
  const customFields = useMemo(() => directory?.customFields || [], [directory?.customFields])

  useEffect(() => {
    if (!open || !record) return
    setActive('basic')
    setValues(prepareInfrastructureEditorValues(record, models))
  }, [open, record, models])

  const deviceTypeName = deviceTypes.find((item) => item.id === Number(values.category_id))?.name || values.device_type || ''
  const profile = infrastructureFieldProfile(deviceTypeName)
  const photosSupported = supportsInfrastructurePhotos({ ...values, category_name: deviceTypeName })
  useEffect(() => {
    if (!photosSupported && Object.keys(photoDraft).length) onPhotoDraftChange({})
  }, [photosSupported, photoDraft, onPhotoDraftChange])
  const basicFields = useMemo(() => [
    { key: 'name', label: '设备名称', required: true },
    { key: 'asset_code', label: '资产编码' },
    { key: 'category_id', label: '设备类型', numeric: true, preserveZero: !!record?.id && !Number(values.category_id) && !!values.device_type, searchable: true, options: choices(infrastructureDeviceTypeOptions(deviceTypes, record?.id ? values : {}), '未分配'), derive: (id) => {
      const item = deviceTypes.find((entry) => entry.id === Number(id))
      const nextProfile = infrastructureFieldProfile(item?.name || '')
      return item ? { device_type: item.name, asset_class: nextProfile.kind === 'virtual' ? 'virtual' : 'physical' } : {}
    } },
    { key: 'status', label: '状态', options: choices(meta.statuses || []) },
    { key: 'sn', label: 'SN' },
    { key: 'model_id', label: '从型号库带入', hidden: !profile.brandModel || !models.length, numeric: true, searchable: true, options: choices(models.map((item) => ({ value: item.id, label: [item.vendor, item.model].filter(Boolean).join(' · ') })), '手工填写'), derive: (id) => {
      const matchedModel = models.find((item) => item.id === id)
      return matchedModel ? { vendor: matchedModel.vendor, model: matchedModel.model } : {}
    } },
    { key: 'vendor', label: '品牌 / 厂商', hidden: !profile.brandModel, derive: (vendor, current) => ({ model_id: resolveInfrastructureModelID(models, vendor, current.model) }), render: ({ current, onChange, props }) => <VendorBrandInput {...props} value={current} onChange={onChange} /> },
    { key: 'model', label: '型号', hidden: !profile.brandModel, derive: (model, current) => ({ model_id: resolveInfrastructureModelID(models, current.vendor, model) }) },
    { key: 'provider', label: '供应商', hidden: !profile.provider },
  ], [deviceTypes, meta.statuses, models, profile.brandModel, profile.provider, record?.id, values])

  const ownershipFields = [
    { key: 'org_id', label: '所属组织', numeric: true, searchable: true, options: optionList(meta.orgs) },
    { key: 'group_id', label: '所属分组', numeric: true, searchable: true, options: optionList(meta.groups) },
    { key: 'owner_id', label: '负责人', numeric: true, searchable: true, options: choices(people.map((person) => ({ value: person.id, label: [person.name, person.department].filter(Boolean).join(' · ') })), '未分配'), derive: (id) => {
      const person = people.find((item) => item.id === id)
      return person ? { owner: person.name, department: person.department } : { owner: '', department: '' }
    } },
    ...textFields([['department', '部门'], ['owner', '负责人姓名']]),
  ]
  const locationFields = [
    ...textFields([['room', '房间 / 位置'], ['data_center', '机房'], ['floor', '楼层'], ['cabinet_name', '机柜'], ['cabinet_row', '机柜排']]),
    { key: 'cabinet_col', label: '机柜列', type: 'number', min: 0 },
    { key: 'start_u', label: '起始 U 位', type: 'number', min: 0 },
    { key: 'height_u', label: '占用 U 数', type: 'number', min: 1 },
  ]
  const systemFields = [
    { key: 'vcpu', label: 'vCPU（核）', type: 'number', min: 0, hidden: !profile.virtualCompute },
    { key: 'cpu_info', label: 'CPU 配置', hidden: !profile.cpu },
    { key: 'memory_mb', label: '内存（MB）', type: 'number', min: 0, hidden: !profile.memory },
    { key: 'disk_info', label: '硬盘 / 磁盘配置', hidden: !profile.disk },
    { key: 'os_type', label: '操作系统类型', hidden: !profile.os, searchable: true, options: choices([...new Set(['Windows Server', 'Windows', '银河麒麟', '统信 UOS', 'openEuler', '龙蜥 Anolis OS', '中科方德', 'Ubuntu', 'Debian', 'CentOS', 'Rocky Linux', 'Red Hat Enterprise Linux', 'AlmaLinux', 'Linux', 'Unix', 'VMware ESXi', 'Proxmox VE', 'Nutanix AHV', 'Microsoft Hyper-V', 'KVM', 'Citrix Hypervisor', '华为 FusionCompute', 'H3C UIS', '深信服 aCloud', 'SmartX', 'ZStack', 'OpenStack', 'VirtualBox', '其他', '未知', values.os_type].filter(Boolean))]) },
    { key: 'os_version', label: '操作系统版本', hidden: !profile.os },
  ]
  const extendedBasicFields = [...basicFields, { key: 'remark', label: '备注', type: 'textarea' }, ...customFieldDefinitions(customFields, values.asset_class || 'physical')]
  const sections = [
    ['basic', '基础信息', Box],
    ['connection', 'Netcatty 连接', KeyRound],
    ['ownership', '归属关系', Building2],
    ...(profile.kind !== 'virtual' ? [['location', '安装位置', Building2]] : []),
    ['network', '网络配置', Network],
    ...(profile.systemSection ? [['system', profile.systemSection, Cpu]] : []),
    ...(photosSupported ? [['photos', '设备照片', ImageIcon]] : []),
  ]

  if (!record) return null
  const submit = () => {
    try {
      if (photoBusy) throw new Error('请等待照片处理完成')
      validateFields(basicFields, values)
      for (const [index, item] of (values.interfaces || []).entries()) {
        if (!String(item.ip || '').trim()) throw new Error(`请填写第 ${index + 1} 个网卡的 IP 地址`)
      }
      onSubmit(values)
    } catch (error) {
      toast.error(error.message)
    }
  }
  const jump = (key) => {
    setActive(key)
    const form = formRef.current
    const section = sectionRefs.current[key]
    if (form && section) form.scrollTo({ top: form.scrollTop + section.getBoundingClientRect().top - form.getBoundingClientRect().top, behavior: 'smooth' })
  }
  return <AsidePanel open={open} onClose={() => onOpenChange(false)} title={record.id ? '编辑基础设施' : '新增基础设施'} width="w-[720px]" dataSection="cmdb-infrastructure-editor">
      <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[152px_minmax(0,1fr)]">
        <nav className="hidden overflow-y-auto border-r border-border bg-muted/20 p-2 sm:block" aria-label="资产表单分区">
          {sections.map(([key, label, Icon]) => <button type="button" key={key} onClick={() => jump(key)} className={`flex w-full items-center gap-1.5 whitespace-nowrap rounded px-2 py-2 text-left text-[11px] ${active === key ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon size={14} className="shrink-0" />{label}</button>)}
        </nav>
        <form ref={formRef} id="cmdb-infrastructure-editor" onSubmit={(event) => { event.preventDefault(); submit() }} className="min-h-0 space-y-3 overflow-y-auto overscroll-contain scroll-smooth p-4">
          <Section sectionKey="basic" title="基础信息" sectionRefs={sectionRefs}>{!deviceTypes.length ? <p className="mb-3 text-xs text-destructive">请先在配置中心维护设备类型。</p> : null}<Fields fields={extendedBasicFields} value={values} onChange={setValues} />{profile.brandModel ? <p className="mt-3 text-xs text-muted-foreground">{Number(values.model_id) ? '品牌与型号已关联型号库。' : '该品牌与型号尚未纳入型号库，资产信息仍会正常保存。'}</p> : null}</Section>
          <Section sectionKey="connection" title="Netcatty 连接" sectionRefs={sectionRefs}><NetcattyConnectionFields asset={values} value={netcatty.connection} onChange={netcatty.setConnection} hosts={netcatty.hosts} credentials={netcatty.credentials} loading={netcatty.loading} error={netcatty.error} createHost={netcatty.createHost} createCredential={netcatty.createCredential} /></Section>
          <Section sectionKey="ownership" title="归属关系" sectionRefs={sectionRefs}><Fields fields={ownershipFields} value={values} onChange={setValues} /></Section>
          {profile.kind !== 'virtual' ? <Section sectionKey="location" title="安装位置" sectionRefs={sectionRefs}><Fields fields={locationFields} value={values} onChange={setValues} /></Section> : null}
          <Section sectionKey="network" title="网络配置" sectionRefs={sectionRefs}>{profile.deviceMac ? <div className="mb-4 max-w-md"><Field label="设备级 MAC 地址"><Input className="h-9 font-mono" value={values.mac || ''} onChange={(event) => setValues({ ...values, mac: event.target.value })} /></Field></div> : null}<NetworkInterfaces interfaces={values.interfaces || []} zones={meta.net_zones || []} onChange={(interfaces) => setValues({ ...values, interfaces, mgmt_ip: managementIPFromInterfaces(interfaces) })} />{!(values.interfaces || []).length ? <p className="text-xs text-muted-foreground">添加第一个网络接口后，可直接在该接口填写管理 IP。</p> : null}</Section>
          {profile.systemSection ? <Section sectionKey="system" title={profile.systemSection} sectionRefs={sectionRefs}><Fields fields={systemFields} value={values} onChange={setValues} /></Section> : null}
          {photosSupported ? <Section sectionKey="photos" title="设备照片" sectionRefs={sectionRefs}><DeviceImages kind="infrastructure" id={record.id} draftMode={!record.id || Object.keys(photoDraft).length > 0} draftImages={photoDraft} onDraftChange={onPhotoDraftChange} onBusyChange={setPhotoBusy} /></Section> : null}
        </form>
      </div>
      <AsidePanelFooter><div className="flex gap-2"><Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button><Button type="submit" form="cmdb-infrastructure-editor" className="h-10 flex-1" disabled={busy || photoBusy}>{busy ? <Spinner className="mr-2" /> : null}保存</Button></div></AsidePanelFooter>
  </AsidePanel>
}
