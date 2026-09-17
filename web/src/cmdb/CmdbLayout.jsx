import React, { useLayoutEffect, useRef, useState } from 'react'
import { AppstoreOutlined, LaptopOutlined, DesktopOutlined, DatabaseOutlined } from '@ant-design/icons'
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import './cmdb.css'
import './resource-ledger.css'
import CmdbResources from './CmdbResources'
import AssetCenter from '../AssetCenter'
import ServerCenter from '../ServerCenter'

gsap.registerPlugin(Flip)

export const CMDB_NAV = [
  { key: 'resources', label: '资源总账', note: '统一资源视图', icon: <AppstoreOutlined /> },
  { key: 'assets', label: '终端资产', note: '人员与位置台账', icon: <LaptopOutlined /> },
  { key: 'servers', label: '基础设施与业务系统', note: '主机和业务系统', icon: <DesktopOutlined /> },
]

const EMPTY_META = {
  departments: [], rooms: [], statuses: [], log_types: [], subnets: [],
  server_statuses: [], app_types: [], app_statuses: [],
}

export default function CmdbLayout({ meta, tab, onTabChange, focusTarget }) {
  const [innerTab, setInnerTab] = useState('resources')
  const current = tab || innerTab
  const flipState = useRef(null)

  useLayoutEffect(() => {
    if (!flipState.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    Flip.from(flipState.current, { duration: 0.28, ease: 'power2.out', absolute: true, clearProps: 'all' })
    flipState.current = null
  }, [current])

  const switchTab = (key) => {
    const marker = document.querySelector('.cmdb-module-nav-v2 .active-marker')
    if (marker) flipState.current = Flip.getState(marker)
    setInnerTab(key)
    onTabChange?.(key)
  }

  const renderModule = () => {
    const currentMeta = meta || EMPTY_META
    if (current === 'assets') return <AssetCenter meta={currentMeta} focusTarget={focusTarget} />
    if (current === 'servers') return <ServerCenter meta={currentMeta} focusTarget={focusTarget} />
    return <CmdbResources meta={currentMeta} />
  }

  return (
    <div className={`cmdb-workspace-v2 ${current === 'resources' ? 'resource-workspace' : ''}`}>
      <header className="cmdb-head-v2">
        <div className="cmdb-title-v2">
          <span><DatabaseOutlined /></span>
          <div><h1>Cmdb</h1></div>
        </div>
        <nav className="cmdb-module-nav-v2" aria-label="Cmdb 台账">
          {CMDB_NAV.map((item) => (
            <button key={item.key} type="button" className={current === item.key ? 'active' : ''} onClick={() => switchTab(item.key)}>
              {current === item.key ? <i className="active-marker" /> : null}
              <span>{item.icon}</span>
              <div><strong>{item.label}</strong><small>{item.note}</small></div>
            </button>
          ))}
        </nav>
      </header>
      <main className="cmdb-content-v2">{renderModule()}</main>
    </div>
  )
}
