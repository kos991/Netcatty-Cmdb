import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Cpu, KeyRound, Network, Plus, Server, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AssetPanel, AssetPanelSave, AssetPanelSection } from './AssetPanel'
import { AssetDraftDiscardDialog, AssetFormPanel, AssetFormTabs, useAssetDraftGuard } from './AssetFormTabs'
import AssetCreateDialog from './AssetCreateDialog'
import { toast } from '@/components/ui/toast'
import { choices, Fields, textFields, validateFields } from './Fields'
import { additionalEditorRows, prepareInfrastructureEditorValues, resolveInfrastructureModelID } from './infrastructureEditorModel'
import { infrastructureNetworkZoneOptions } from './infrastructureTableModel'
import { customFieldDefinitions, infrastructureDeviceTypeOptions, infrastructureFieldProfile, supportsInfrastructurePhotos } from './state'
import { Field, SelectControl } from './ui'
import NetcattyConnectionFields from './NetcattyConnectionFields'
import DeviceImages from './DeviceImages'
import VendorBrandInput from './VendorBrandInput'
import HardwareCollection from './HardwareCollection'
import { hardwareField, useHardwareDrafts } from './HardwareFields'

const optionList = (items = [], blank = '未分配') => choices(items.map((item) => ({ value: item.id, label: item.name })), blank)


function NetworkInterfaces({ interfaces, zones, managementIP, onChange }) {
  const update = (index, patch) => onChange(interfaces.map((item, current) => current === index ? { ...item, ...patch } : item))
  const add = () => onChange([...interfaces, { name: `eth${interfaces.length}`, ip: '', main_ip_purpose: 'business', additional_ips_json: '[]', mask: '', gateway: '', mac: '', network_zone: '未分类', is_primary: 0, remark: '' }])
  const remove = (index) => onChange(interfaces.filter((_, current) => current !== index))
  const updateAdditional = (index, addresses) => update(index, { additional_ips_json: JSON.stringify(addresses) })
  const purposeOptions = [{ value: 'business', label: '业务' }, { value: 'out_of_band', label: '带外' }]
  return <div className="space-y-3">
    {interfaces.map((item, index) => {
      const additional = additionalEditorRows(item.additional_ips_json, item.name || item.if_name || '未命名')
      const isManagementIP = Boolean(String(item.ip || '').trim() && String(item.ip || '').trim() === String(managementIP || '').trim())
      return <div key={item.id || `new-${index}`} className="border-b border-border/60 pb-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-3"><span className="text-xs font-medium text-muted-foreground">接口 {index + 1}</span><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="删除接口" onClick={() => remove(index)}><Trash2 size={14} /></Button></div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="接口名称"><Input className="h-9" value={item.name || item.if_name || ''} onChange={(event) => update(index, { name: event.target.value, if_name: event.target.value })} /></Field>
        <Field label="接口 IP（可留空）"><Input className="h-9 font-mono" value={item.ip || ''} onChange={(event) => update(index, { ip: event.target.value, main_ip_purpose: item.main_ip_purpose === 'management' && event.target.value.trim() !== String(managementIP || '').trim() ? 'business' : item.main_ip_purpose })} /></Field>
        <Field label="接口主 IP 用途"><SelectControl className="w-full" value={item.main_ip_purpose || 'business'} onChange={(purpose) => update(index, { main_ip_purpose: purpose })} options={[...(isManagementIP || item.main_ip_purpose === 'management' ? [{ value: 'management', label: '仅管理' }] : []), ...purposeOptions, { value: 'business_out_of_band', label: '业务 + 带外' }]} /></Field>
        <Field label="网络分区"><SelectControl className="w-full" value={item.network_zone || item.net_zone || ''} onChange={(value) => update(index, { network_zone: value, net_zone: value })} options={choices(zones)} /></Field>
        <Field label="掩码 / 前缀"><Input className="h-9 font-mono" value={item.mask || ''} onChange={(event) => update(index, { mask: event.target.value })} /></Field>
        <Field label="网关"><Input className="h-9 font-mono" value={item.gateway || ''} onChange={(event) => update(index, { gateway: event.target.value })} /></Field>
        <Field label="MAC 地址"><Input className="h-9 font-mono" value={item.mac || ''} onChange={(event) => update(index, { mac: event.target.value })} /></Field>
        <Field label="VLAN"><Input className="h-9" type="number" min="0" value={item.vlan_id || 0} onChange={(event) => update(index, { vlan_id: Number(event.target.value) })} /></Field>
        <Field label="备注" className="md:col-span-2"><Input className="h-9" value={item.remark || ''} onChange={(event) => update(index, { remark: event.target.value })} /></Field>
      </div>
      <div className="mt-3 space-y-2"><span className="text-[11px] text-muted-foreground">同一接口的附加地址</span>{additional.map((address, addressIndex) => <div key={addressIndex} className="flex min-w-0 gap-2"><Input className="h-8 min-w-0 flex-1 font-mono" aria-label={`接口 ${index + 1} 附加 IP ${addressIndex + 1}`} value={address.ip || ''} onChange={(event) => updateAdditional(index, additional.map((current, currentIndex) => currentIndex === addressIndex ? { ...current, ip: event.target.value } : current))} /><SelectControl className="w-24 shrink-0" value={address.purpose || 'business'} onChange={(purpose) => updateAdditional(index, additional.map((current, currentIndex) => currentIndex === addressIndex ? { ...current, purpose } : current))} options={purposeOptions} /><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="删除附加地址" onClick={() => updateAdditional(index, additional.filter((_, currentIndex) => currentIndex !== addressIndex))}><Trash2 size={14} /></Button></div>)}<Button type="button" variant="outline" size="sm" onClick={() => updateAdditional(index, [...additional, { ip: '', purpose: 'business' }])}><Plus size={14} className="mr-1" />添加此接口地址</Button></div>
    </div>})}
    <Button type="button" variant="outline" size="sm" onClick={add}><Plus size={14} className="mr-1" />添加接口</Button>
  </div>
}

const INFRASTRUCTURE_FORM_TABS = [
  { key: 'basic', label: '基本信息' },
  { key: 'ownership', label: '归属与位置' },
  { key: 'network', label: '网络与系统' },
  { key: 'credentials', label: '凭证中心' },
]

export default function InfrastructureEditor({ open, onOpenChange, expanded, onExpandedChange, onWidthChange, record, directory, busy, onSubmit, netcatty, photoDraft = {}, onPhotoDraftChange, onBusyChange }) {
  const hardwareDrafts = useHardwareDrafts(`${open ? 'open' : 'closed'}:${record?.id || 'new-infrastructure'}`)
  const [values, setValues] = useState(record || {})
  const [formTab, setFormTab] = useState('basic')
  const [baseline, setBaseline] = useState(record || {})
  const draftGuard = useAssetDraftGuard(baseline, values, () => onOpenChange(false))
  const [photoBusy, setPhotoBusy] = useState(false)
  useEffect(() => { onBusyChange?.(photoBusy); return () => onBusyChange?.(false) }, [photoBusy, onBusyChange])
  const meta = directory?.meta || {}
  const people = directory?.people || []
  const deviceTypes = useMemo(() => directory?.deviceTypes || [], [directory?.deviceTypes])
  const models = useMemo(() => meta.models || [], [meta.models])
  const customFields = useMemo(() => directory?.customFields || [], [directory?.customFields])
  const networkZones = useMemo(() => infrastructureNetworkZoneOptions(meta.net_zones || []), [meta.net_zones])
  const initializedSession = useRef('')


  useEffect(() => {
    const session = `${open ? 'open' : 'closed'}:${record?.id || 'new'}`
    if (!open || !record) {
      initializedSession.current = ''
      return
    }
    initializedSession.current = session
    const prepared = prepareInfrastructureEditorValues(record, models)
    setValues(prepared)
    setBaseline(prepared)
    setFormTab('basic')
  }, [open, record, models])
  useEffect(() => {
    if (!models.length) return
    const sync = (current) => {
      const matched = models.find(item => Number(item.id) === Number(current.model_id))
      if (!matched || (current.vendor === matched.vendor && current.model === matched.model)) return current
      return { ...current, vendor: matched.vendor, model: matched.model }
    }
    setValues(sync)
    setBaseline(sync)
  }, [models])

  const deviceTypeName = values.device_type || deviceTypes.find((item) => item.id === Number(values.category_id))?.name || ''
  const profile = infrastructureFieldProfile(deviceTypeName)
  const photosSupported = supportsInfrastructurePhotos({ ...values, category_name: deviceTypeName })
  useEffect(() => {
    if (!photosSupported && Object.keys(photoDraft).length) onPhotoDraftChange({})
  }, [photosSupported, photoDraft, onPhotoDraftChange])
  const basicFields = useMemo(() => [
    { key: 'name', label: '设备名称', required: true },
    { key: 'asset_code', label: '资产编号' },
    { key: 'category_id', label: '设备类型', numeric: true, preserveZero: !!record?.id && !Number(values.category_id) && !!values.device_type, searchable: true, options: choices(infrastructureDeviceTypeOptions(deviceTypes, record?.id ? values : {}), '未分配'), derive: (id) => {
      const item = deviceTypes.find((entry) => entry.id === Number(id))
      const nextProfile = infrastructureFieldProfile(item?.name || '')
      return item ? { device_type: item.name, asset_class: nextProfile.kind === 'virtual' ? 'virtual' : 'physical' } : {}
    } },
    { key: 'status', label: '设备状态', options: choices(meta.statuses || []) },
    { key: 'sn', label: '设备 SN' },
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
    { key: 'owner_id', label: '负责人', numeric: true, searchable: true, options: choices(people.map((person) => ({ value: person.id, label: [person.name, person.department].filter(Boolean).join(' · ') })), '未分配'), derive: (id) => {
      const person = people.find((item) => item.id === id)
      return person ? { owner: person.name, department: person.department } : { owner: '', department: '' }
    } },
    ...textFields([['department', '部门'], ['owner', '负责人姓名']]),
  ]
  const locationFields = [
    { key: 'room', label: '房间 / 具体位置' },
    { key: 'data_center', label: '所属机房', placeholder: '如：2楼数据中心机房（不含机柜名）' },
    { key: 'cabinet_name', label: '机柜名称（可留空）', placeholder: '如：1-1机柜（不含机房名）' },
    ...textFields([['floor', '楼层'], ['cabinet_row', '机柜排']]),
    { key: 'cabinet_col', label: '机柜列', type: 'number', min: 0 },
    { key: 'start_u', label: '起始 U 位', type: 'number', min: 0 },
    { key: 'height_u', label: '占用 U 数', type: 'number', min: 1 },
  ]
  const systemFields = [
    hardwareField('vcpu', 'vCPU（核）', hardwareDrafts, !profile.virtualCompute),
    hardwareField('cpu_info', 'CPU 配置', hardwareDrafts, !profile.cpu),
    hardwareField('memory_mb', '内存', hardwareDrafts, !profile.memory),
    hardwareField('disk_info', '硬盘 / 磁盘配置', hardwareDrafts, !profile.disk),
    { key: 'os_type', label: '操作系统类型', hidden: !profile.os, searchable: true, options: choices([...new Set(['Windows Server', 'Windows', '银河麒麟', '统信 UOS', 'openEuler', '龙蜥 Anolis OS', '中科方德', 'Ubuntu', 'Debian', 'CentOS', 'Rocky Linux', 'Red Hat Enterprise Linux', 'AlmaLinux', 'Linux', 'Unix', 'VMware ESXi', 'Proxmox VE', 'Nutanix AHV', 'Microsoft Hyper-V', 'KVM', 'Citrix Hypervisor', '华为 FusionCompute', 'H3C UIS', '深信服 aCloud', 'SmartX', 'ZStack', 'OpenStack', 'VirtualBox', '其他', '未知', values.os_type].filter(Boolean))]) },
    { key: 'os_version', label: '操作系统版本', hidden: !profile.os },
  ]
  const extendedBasicFields = [...basicFields, { key: 'remark', label: '备注', type: 'textarea' }, ...customFieldDefinitions(customFields, values.asset_class || 'physical')]

  if (!record) return null
  const submit = () => {
    try {
      if (photoBusy) throw new Error('请等待照片处理完成')
      validateFields([...basicFields, ...systemFields], values)
      onSubmit(values)
    } catch (error) {
      toast.error(error.message)
    }
  }
  const footer = <AssetPanelSave onCancel={draftGuard.requestClose} onSave={submit} busy={busy || photoBusy} />
  const body = <form id="cmdb-infrastructure-editor" onSubmit={(event) => { event.preventDefault(); submit() }}>
    <AssetFormPanel active={formTab === 'basic'} section="basic">
      <AssetPanelSection title="基本信息" icon={Cpu}>{!deviceTypes.length ? <p className="text-xs text-destructive">请先在配置中心维护设备类型。</p> : null}<Fields fields={extendedBasicFields} value={values} onChange={setValues} />{profile.brandModel ? <p className="text-[11px] text-muted-foreground">{Number(values.model_id) ? '品牌与型号已关联型号库。' : '品牌与型号可手工填写并保存。'}</p> : null}</AssetPanelSection>
    </AssetFormPanel>
    <AssetFormPanel active={formTab === 'ownership'} section="ownership">
      <AssetPanelSection title="归属与位置" icon={Building2}>
        <Fields fields={ownershipFields} value={values} onChange={setValues} />
        {profile.kind !== 'virtual' ? <><h4 className="text-xs font-medium">安装位置</h4><p className="text-[11px] text-muted-foreground">机房与机柜分别填写；起始 U 位为 0 表示未上架。</p><Fields fields={locationFields} value={values} onChange={setValues} /></> : <p className="text-[11px] text-muted-foreground">虚拟资源无实体位置，不录入机柜位置或设备照片。</p>}
        {photosSupported ? <DeviceImages kind="infrastructure" id={record.id} draftMode={!record.id || Object.keys(photoDraft).length > 0} draftImages={photoDraft} onDraftChange={onPhotoDraftChange} onBusyChange={setPhotoBusy} /> : null}
      </AssetPanelSection>
    </AssetFormPanel>
    <AssetFormPanel active={formTab === 'network'} section="network">
      <AssetPanelSection title="网络与系统" icon={Network}>
        <div className="cmdb-form-grid grid min-w-0 grid-cols-1 gap-x-3.5 gap-y-3 sm:grid-cols-2">
          <Field label="管理 IP"><Input className="h-[34px] font-mono text-[13px]" value={values.mgmt_ip || ''} onChange={(event) => setValues({ ...values, mgmt_ip: event.target.value })} /></Field>
          <Field label="管理 IP 网络类型"><SelectControl className="w-full" value={values.net_type || ''} onChange={(value) => setValues({ ...values, net_type: value })} options={choices(networkZones, '未配置')} /></Field>
          <Field label="业务 IP（兼容字段）"><Input className="h-[34px] font-mono text-[13px]" value={values.biz_ip || ''} onChange={(event) => setValues({ ...values, biz_ip: event.target.value })} /></Field>
        </div>
        <p className="text-[11px] text-muted-foreground">管理 IP 用于默认连接；多个业务、带外地址在接口中分别登记网络分区。</p>
        {profile.deviceMac ? <Field label="设备级 MAC 地址"><Input className="h-[34px] font-mono text-[13px]" value={values.mac || ''} onChange={(event) => setValues({ ...values, mac: event.target.value })} /></Field> : null}
        <NetworkInterfaces interfaces={values.interfaces || []} zones={networkZones} managementIP={values.mgmt_ip} onChange={(interfaces) => setValues({ ...values, interfaces })} />
        {profile.systemSection ? <><h4 className="text-xs font-medium">{profile.systemSection}</h4><Fields fields={systemFields} value={values} onChange={setValues} />{(profile.cpu || profile.virtualCompute) ? <HardwareCollection value={values} onChange={setValues} connection={netcatty.connection} /> : null}</> : null}
      </AssetPanelSection>
    </AssetFormPanel>
    <AssetFormPanel active={formTab === 'credentials'} section="credentials">
      <AssetPanelSection title="凭证中心" icon={KeyRound}>
        <NetcattyConnectionFields asset={values} value={netcatty.connection} onChange={netcatty.setConnection} hosts={netcatty.hosts} credentials={netcatty.credentials} loading={netcatty.loading} error={netcatty.error} createHost={netcatty.createHost} createCredential={netcatty.createCredential} />
      </AssetPanelSection>
    </AssetFormPanel>
    <AssetDraftDiscardDialog guard={draftGuard} busy={busy} />
  </form>
  return record.id
    ? <AssetPanel open={open} expanded={expanded} onExpandedChange={onExpandedChange} onWidthChange={onWidthChange} onClose={draftGuard.requestClose} title="编辑基础设施" subtitle={record.asset_code} icon={Server} tabs={<AssetFormTabs tabs={INFRASTRUCTURE_FORM_TABS} value={formTab} onChange={setFormTab} dataSection="infrastructure-form-tabs" />} footer={footer} dataSection="cmdb-infrastructure-editor">{body}</AssetPanel>
    : <AssetCreateDialog open={open} onOpenChange={(value) => { if (!value) draftGuard.requestClose() }} title="新增基础设施" icon={Server} tabs={INFRASTRUCTURE_FORM_TABS} tab={formTab} onTabChange={setFormTab} busy={busy || photoBusy} footer={footer}>{body}</AssetCreateDialog>
}
