const clean = (value) => String(value || '').trim()

/**
 * 设备品牌识别只负责把用户输入归一化为本地资源 ID。
 * 原始品牌/厂商字段不会被替换，便于保留资产台账的真实写法。
 */
export const VENDOR_BRANDS = {
  dellemc: { label: 'Dell EMC', aliases: ['Dell EMC', 'Dell', 'PowerEdge', 'PowerStore', 'PowerMax', 'Unity'] },
  netapp: { label: 'NetApp', aliases: ['NetApp', 'ONTAP'] },
  ibm: { label: 'IBM', aliases: ['IBM', 'FlashSystem'] },
  hpe: { label: 'HPE', aliases: ['HPE', 'Hewlett-Packard', '惠普', 'Alletra', '3PAR', 'Nimble'] },
  lenovo: { label: '联想', aliases: ['Lenovo', '联想'] },
  inspur: { label: '浪潮', aliases: ['Inspur', '浪潮'] },
  synology: { label: '群晖', aliases: ['Synology', '群晖', 'DSM'] },
  qnap: { label: 'QNAP', aliases: ['QNAP', 'QTS', 'QuTS'] },
  purestorage: { label: 'Pure Storage', aliases: ['Pure Storage', 'Purity'] },
  huawei: { label: '华为', aliases: ['Huawei', '华为', 'FusionCompute', 'FusionCube', 'FusionServer', 'OceanStor'] },
  h3c: { label: 'H3C', aliases: ['H3C', '新华三', 'UIS', 'CAS'] },
  vmware: { label: 'VMware', aliases: ['VMware', 'vSphere', 'ESXi', 'vSAN', 'NSX'] },
  proxmox: { label: 'Proxmox VE', aliases: ['Proxmox', 'Proxmox VE', 'PVE'] },
  nutanix: { label: 'Nutanix', aliases: ['Nutanix', 'AOS', 'Prism'] },
  smartx: { label: 'SmartX', aliases: ['SmartX', 'SMTX'] },
  zstack: { label: 'ZStack', aliases: ['ZStack', 'Z-Stack'] },
  openstack: { label: 'OpenStack', aliases: ['OpenStack'] },
  hyperv: { label: 'Microsoft Hyper-V', aliases: ['Hyper-V', 'Hyper V', 'HyperV', 'Microsoft Hyper-V'] },
  citrix: { label: 'Citrix', aliases: ['Citrix', 'XenServer', 'Citrix Hypervisor'] },
  virtualbox: { label: 'VirtualBox', aliases: ['VirtualBox', 'Oracle VM VirtualBox'] },
  kvm: { label: 'KVM', aliases: ['KVM', 'Kernel-based Virtual Machine'] },
  redhat: { label: 'Red Hat', aliases: ['Red Hat', 'RHEL', 'RedHat'] },
  openshift: { label: 'Red Hat OpenShift', aliases: ['OpenShift', 'Red Hat OpenShift'] },
  kylin: { label: '麒麟软件', aliases: ['麒麟', '银河麒麟', '中标麒麟', 'Kylin', 'Kylinsoft'] },
  uos: { label: '统信软件', aliases: ['统信', 'UOS', 'UnionTech'] },
  fangde: { label: '中科方德', aliases: ['方德', 'NFSChina'] },
  sangfor: { label: '深信服', aliases: ['Sangfor', '深信服', 'aCloud'] },
  hillstone: { label: '山石网科', aliases: ['Hillstone', '山石', 'StoneOS'] },
  nsfocus: { label: '绿盟科技', aliases: ['NSFOCUS', '绿盟'] },
  topsec: { label: '天融信', aliases: ['Topsec', '天融信'] },
  venustech: { label: '启明星辰', aliases: ['Venustech', '启明星辰'] },
  qianxin: { label: '奇安信', aliases: ['Qianxin', 'Qi-Anxin', '奇安信'] },
  dptech: { label: '迪普科技', aliases: ['DPTech', '迪普'] },
  checkpoint: { label: 'Check Point', aliases: ['Check Point', 'Checkpoint'] },
  sophos: { label: 'Sophos', aliases: ['Sophos'] },
  sonicwall: { label: 'SonicWall', aliases: ['SonicWall', 'Sonic Wall'] },
  ruijie: { label: '锐捷', aliases: ['Ruijie', '锐捷'] },
  cisco: { label: 'Cisco', aliases: ['Cisco', '思科'] },
  juniper: { label: 'Juniper', aliases: ['Juniper', '瞻博'] },
  fortinet: { label: 'Fortinet', aliases: ['Fortinet', 'FortiGate', '飞塔'] },
  paloalto: { label: 'Palo Alto', aliases: ['Palo Alto', 'Palo Alto Networks'] },
  mikrotik: { label: 'MikroTik', aliases: ['MikroTik'] },
  zyxel: { label: 'Zyxel', aliases: ['Zyxel', '合勤'] },
}

const MATCHERS = [
  ['dellemc', /\bdell(?:\s*emc)?\b|poweredge|powerstore|powermax|\bunity(?:\s*xt)?\b/i],
  ['netapp', /netapp|ontap/i],
  ['ibm', /\bibm\b|flashsystem/i],
  ['hpe', /\bhpe\b|hewlett|惠普|alletra|\b3par\b|nimble/i],
  ['lenovo', /lenovo|联想/i],
  ['inspur', /inspur|浪潮/i],
  ['synology', /synology|群晖|\bdsm\b/i],
  ['qnap', /\bqnap\b|\bqts\b|quts/i],
  ['purestorage', /pure\s*storage|purity/i],
  ['vmware', /vmware|vsphere|esxi|vsan|\bnsx\b/i],
  ['proxmox', /proxmox(?:\s*ve)?|\bpve\b/i],
  ['nutanix', /nutanix|\baos\b|\bprism(?:\s*central)?\b/i],
  ['smartx', /smartx|smtx/i],
  ['zstack', /z\s*-?stack/i],
  ['openstack', /openstack/i],
  ['hyperv', /\bhyper\s*-?v\b/i],
  ['citrix', /citrix|xenserver|citrix\s+hypervisor/i],
  ['virtualbox', /virtualbox|oracle\s+vm/i],
  ['kvm', /\bkvm\b|kernel[- ]based\s+virtual\s+machine/i],
  ['openshift', /openshift/i],
  ['redhat', /red\s*hat|\brhel\b/i],
  ['kylin', /麒麟|\bkylin\b|kylinsoft/i],
  ['uos', /统信|\buos\b|uniontech/i],
  ['fangde', /方德|nfschina/i],
  ['huawei', /huawei|华为|fusioncompute|fusioncube|fusionserver|oceanstor/i],
  ['h3c', /\bh3c\b|新华三|\buis\b|\bcas\b/i],
  ['sangfor', /\bsangfor\b|深信服|\bacloud\b/i],
  ['hillstone', /\bhillstone\b|山石(?:网科)?|\bstoneos\b/i],
  ['nsfocus', /\bnsfocus\b|绿盟(?:科技)?/i],
  ['topsec', /\btopsec\b|天融信/i],
  ['venustech', /\bvenustech\b|启明星辰/i],
  ['qianxin', /\bqianxin\b|\bqi[-\s]?anxin\b|奇安信/i],
  ['dptech', /\bdptech\b|迪普(?:科技)?/i],
  ['checkpoint', /check\s*point/i],
  ['sophos', /\bsophos\b/i],
  ['sonicwall', /\bsonic\s*wall\b/i],
  ['ruijie', /ruijie|锐捷/i],
  ['cisco', /\bcisco\b|思科/i],
  ['juniper', /\bjuniper\b|瞻博/i],
  ['fortinet', /\bfortinet\b|\bfortigate\b|飞塔/i],
  ['paloalto', /palo\s*alto/i],
  ['mikrotik', /\bmikrotik\b/i],
  ['zyxel', /\bzyxel\b|合勤/i],
]

export function resolveVendorBrand(value, context = {}) {
  const text = clean(value) || clean(context.model)
  if (!text) return ''
  return MATCHERS.find(([, pattern]) => pattern.test(text))?.[0] || ''
}

export function vendorBrandLabel(id) {
  return VENDOR_BRANDS[id]?.label || ''
}
