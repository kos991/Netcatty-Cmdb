import React from 'react'
import { Building2 } from 'lucide-react'
import { AssetPanelFields, AssetPanelSection } from './AssetPanel'

export default function DeviceOwnershipBar({ ownership }) {
  return <section data-section="device-ownership-card">
    <AssetPanelSection title="资产归属" icon={Building2}>
      <AssetPanelFields items={[
        ['项目', ownership.project], ['组织', ownership.organization],
        ['负责人', ownership.owner],
        ['位置', ownership.location],
        ...(ownership.cabinet ? [['机柜位置', ownership.cabinet]] : []),
      ]} />
    </AssetPanelSection>
  </section>
}
