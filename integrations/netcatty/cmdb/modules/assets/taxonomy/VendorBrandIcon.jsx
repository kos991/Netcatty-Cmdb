import React from 'react'
import { DistroAvatar } from '@/components/DistroAvatar'
import checkpointLogo from './vendor-icons/checkpoint.svg'
import dellemcLogo from './vendor-icons/dellemc.svg'
import dptechLogo from './vendor-icons/dptech.svg'
import hillstoneLogo from './vendor-icons/hillstone.svg'
import hpeLogo from './vendor-icons/hpe.svg'
import huaweiLogo from './vendor-icons/huawei.svg'
import ibmLogo from './vendor-icons/ibm.svg'
import inspurLogo from './vendor-icons/inspur.svg'
import lenovoLogo from './vendor-icons/lenovo.svg'
import kvmLogo from './vendor-icons/kvm.png'
import netappLogo from './vendor-icons/netapp.svg'
import nsfocusLogo from './vendor-icons/nsfocus.svg'
import nutanixLogo from './vendor-icons/nutanix.svg'
import openstackLogo from './vendor-icons/openstack.svg'
import purestorageLogo from './vendor-icons/purestorage.svg'
import proxmoxLogo from './vendor-icons/proxmox.svg'
import qianxinLogo from './vendor-icons/qianxin.svg'
import qnapLogo from './vendor-icons/qnap.svg'
import redhatLogo from './vendor-icons/redhat.svg'
import redhatopenshiftLogo from './vendor-icons/redhatopenshift.svg'
import ruijieLogo from './vendor-icons/ruijie.svg'
import sangforLogo from './vendor-icons/sangfor.svg'
import smartxLogo from './vendor-icons/smartx.svg'
import sonicwallLogo from './vendor-icons/sonicwall.svg'
import sophosLogo from './vendor-icons/sophos.svg'
import synologyLogo from './vendor-icons/synology.svg'
import topsecLogo from './vendor-icons/topsec.svg'
import venustechLogo from './vendor-icons/venustech.svg'
import virtualboxLogo from './vendor-icons/virtualbox.svg'
import vmwareLogo from './vendor-icons/vmware.svg'
import zstackLogo from './vendor-icons/zstack.svg'
import citrixLogo from './vendor-icons/citrix.svg'
import hypervLogo from './vendor-icons/microsoft.svg'
import kylinLogo from './vendor-icons/kylin.png'
import uosLogo from './vendor-icons/uos.png'
import fangdeLogo from './vendor-icons/fangde.svg'
import { resolveVendorBrand, vendorBrandLabel } from './vendorBrandModel'

export const VENDOR_LOGOS = {
  dellemc: dellemcLogo,
  netapp: netappLogo,
  ibm: ibmLogo,
  hpe: hpeLogo,
  lenovo: lenovoLogo,
  inspur: inspurLogo,
  synology: synologyLogo,
  qnap: qnapLogo,
  purestorage: purestorageLogo,
  ruijie: ruijieLogo,
  nsfocus: nsfocusLogo,
  topsec: topsecLogo,
  venustech: venustechLogo,
  qianxin: qianxinLogo,
  dptech: dptechLogo,
  sangfor: sangforLogo,
  hillstone: hillstoneLogo,
  sonicwall: sonicwallLogo,
  sophos: sophosLogo,
  checkpoint: checkpointLogo,
  vmware: vmwareLogo,
  proxmox: proxmoxLogo,
  nutanix: nutanixLogo,
  huawei: huaweiLogo,
  smartx: smartxLogo,
  zstack: zstackLogo,
  openstack: openstackLogo,
  hyperv: hypervLogo,
  citrix: citrixLogo,
  virtualbox: virtualboxLogo,
  kvm: kvmLogo,
  redhat: redhatLogo,
  openshift: redhatopenshiftLogo,
  kylin: kylinLogo,
  uos: uosLogo,
  fangde: fangdeLogo,
}

const NATIVE_BRANDS = new Set(['cisco', 'juniper', 'huawei', 'h3c', 'hpe', 'mikrotik', 'fortinet', 'paloalto', 'zyxel'])

export function VendorBrandIcon({ value = '', context = {}, brand: explicitBrand, size = 'sm', className = '' }) {
  const brand = explicitBrand || resolveVendorBrand(value, context)
  if (NATIVE_BRANDS.has(brand)) return <span data-vendor-brand={brand} title={vendorBrandLabel(brand)} className={`shrink-0 ${className}`}><DistroAvatar size={size} host={{ distro: brand, distroMode: 'auto', os: 'linux' }} fallback={vendorBrandLabel(brand)} /></span>
  const src = VENDOR_LOGOS[brand]
  if (!src) return null
  const dimensions = size === 'md' ? 'h-7 w-7 rounded-md' : 'h-5 w-5 rounded-[5px]'
  const imageSize = size === 'md' ? 'h-5 w-5' : 'h-4 w-4'
  return <span aria-hidden data-vendor-brand={brand} title={vendorBrandLabel(brand)} className={`grid shrink-0 place-items-center overflow-hidden border border-border/60 bg-white ${dimensions} ${className}`}><img src={src} alt="" className={`${imageSize} object-contain`} /></span>
}

export function VendorBrandValue({ value = '', model = '', className = '' }) {
  const text = [value, model].filter(Boolean).join(' ')
  return <div className={`flex min-w-0 items-center gap-2 ${className}`} title={text || undefined}>
    <VendorBrandIcon value={value} context={{ model }} />
    <span className="truncate">{text || '-'}</span>
  </div>
}
