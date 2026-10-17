import React from 'react'
import { Boxes, HardDrive, Network, Server, ShieldCheck } from 'lucide-react'
import { DistroAvatar } from '@/components/DistroAvatar'
import { resolveOperatingSystemPresentation } from './deviceWorkspaceModel'
import { VendorBrandIcon } from './VendorBrandIcon'
import dellemcLogo from './vendor-icons/dellemc.svg'
import dptechLogo from './vendor-icons/dptech.svg'
import sangforLogo from './vendor-icons/sangfor.svg'
import hillstoneLogo from './vendor-icons/hillstone.svg'
import hpeLogo from './vendor-icons/hpe.svg'
import ibmLogo from './vendor-icons/ibm.svg'
import inspurLogo from './vendor-icons/inspur.svg'
import lenovoLogo from './vendor-icons/lenovo.svg'
import netappLogo from './vendor-icons/netapp.svg'
import nsfocusLogo from './vendor-icons/nsfocus.svg'
import purestorageLogo from './vendor-icons/purestorage.svg'
import qianxinLogo from './vendor-icons/qianxin.svg'
import qnapLogo from './vendor-icons/qnap.svg'
import ruijieLogo from './vendor-icons/ruijie.svg'
import checkpointLogo from './vendor-icons/checkpoint.svg'
import sophosLogo from './vendor-icons/sophos.svg'
import sonicwallLogo from './vendor-icons/sonicwall.svg'
import synologyLogo from './vendor-icons/synology.svg'
import topsecLogo from './vendor-icons/topsec.svg'
import venustechLogo from './vendor-icons/venustech.svg'

const VENDOR_LOGOS = {
  dellemc: dellemcLogo,
  dptech: dptechLogo,
  hpe: hpeLogo,
  ibm: ibmLogo,
  inspur: inspurLogo,
  lenovo: lenovoLogo,
  netapp: netappLogo,
  nsfocus: nsfocusLogo,
  purestorage: purestorageLogo,
  qianxin: qianxinLogo,
  qnap: qnapLogo,
  ruijie: ruijieLogo,
  sangfor: sangforLogo,
  hillstone: hillstoneLogo,
  checkpoint: checkpointLogo,
  sophos: sophosLogo,
  sonicwall: sonicwallLogo,
  synology: synologyLogo,
  topsec: topsecLogo,
  venustech: venustechLogo,
}

function SystemIcon({ presentation }) {
  if (['vmware', 'proxmox', 'nutanix', 'smartx', 'zstack', 'openstack', 'hyperv', 'citrix', 'virtualbox', 'kvm', 'kylin', 'uos', 'fangde'].includes(presentation.distro)) return <span data-os-icon={presentation.distro}><VendorBrandIcon brand={presentation.distro} /></span>
  if (presentation.distro === 'hyperconverged') return <span aria-hidden data-os-icon="hyperconverged" className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-muted text-muted-foreground"><Boxes size={12} /></span>
  const vendorLogo = VENDOR_LOGOS[presentation.distro]
  if (vendorLogo) return <span aria-hidden data-os-icon={presentation.distro} className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-[5px] border border-border/60 bg-white"><img src={vendorLogo} alt="" className="h-4 w-4 object-contain" /></span>
  if (presentation.distro === 'security') return <span aria-hidden data-os-icon="security" className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-rose-600 text-white"><ShieldCheck size={12} /></span>
  if (presentation.distro === 'network') return <span aria-hidden data-os-icon="network" className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-slate-600 text-white"><Network size={12} /></span>
  if (presentation.distro === 'storage') return <span aria-hidden data-os-icon="storage" className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-cyan-700 text-white"><HardDrive size={12} /></span>
  if (presentation.distro === 'unknown') return <span aria-hidden data-os-icon="unknown" className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-muted text-muted-foreground"><Server size={12} /></span>
  return <DistroAvatar size="sm" fallback={presentation.name} host={{ distro: presentation.distro, distroMode: 'auto', os: presentation.distro === 'windows' ? 'windows' : presentation.distro === 'macos' ? 'macos' : 'linux' }} />
}

export default function OperatingSystemCell({ asset = {}, host = null, compact = false, hideIcon = false }) {
  const presentation = resolveOperatingSystemPresentation(asset, host)
  return <div className={`flex min-w-0 items-center gap-2 ${hideIcon ? 'pl-7' : ''}`} title={presentation.label} data-os-distro={presentation.distro}>
    {!hideIcon ? <SystemIcon presentation={presentation} /> : null}
    <div className="min-w-0 leading-tight">
      <p className="truncate text-xs">{compact ? presentation.label : presentation.name}</p>
      {!compact && presentation.version ? <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{presentation.version}</p> : null}
    </div>
  </div>
}
