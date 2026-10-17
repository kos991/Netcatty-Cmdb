import React from 'react'
import { Combobox } from '@/components/ui/combobox'
import { VENDOR_BRANDS } from './vendorBrandModel'
import { VendorBrandIcon } from './VendorBrandIcon'

const presets = Object.entries(VENDOR_BRANDS).map(([brand, item]) => ({
  value: item.label,
  label: item.label,
  sublabel: item.aliases.join(' / '),
  icon: <VendorBrandIcon brand={brand} />,
}))

// 输入即时写入原字段，自定义名称无需选中预设或按回车确认。
export default function VendorBrandInput({ value, onChange, 'aria-label': label = '品牌 / 厂商', disabled }) {
  return <Combobox value={value} options={presets} onValueChange={onChange} onInputValueChange={onChange}
    allowCreate createText="使用" placeholder="选择预设或输入品牌" emptyText="可直接填写自定义品牌"
    ariaLabel={label} disabled={disabled} triggerClassName="h-9 text-xs"
    icon={<VendorBrandIcon value={value} />} />
}
