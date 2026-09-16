import React from 'react'

export default function ModuleTabs({ items, activeKey, onChange, label, secondary = false }) {
  return <nav className={`cmdb-module-tabs${secondary ? ' cmdb-submodule-tabs' : ''}`} aria-label={label}>
    {items.map((item) => <button type="button" key={item.key} aria-current={activeKey === item.key ? 'page' : undefined}
      className={activeKey === item.key ? 'active' : ''} onClick={() => onChange(item.key)}>{item.label}</button>)}
  </nav>
}
