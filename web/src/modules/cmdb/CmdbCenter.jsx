import React, { useEffect, useState } from 'react'
import { Alert } from 'antd'
import CmdbResources from '../../cmdb/CmdbResources'
import AssetCenter from '../../AssetCenter'
import ServerCenter from '../../ServerCenter'
import AuditLogs from '../../AuditLogs'
import './cmdb-new.css'

const tabs = [
  { key: 'resources', label: '资源总账' },
  { key: 'assets', label: '终端资产' },
  { key: 'servers', label: '物理服务器与应用' },
  { key: 'logs', label: '全院运维履历' },
]

/** CMDB 统一入口。每个台账保持独立组件和独立查询状态。 */
export default function CmdbCenter({ meta, tab = 'resources', onTabChange, focusTarget }) {
  const [active, setActive] = useState(tab || 'resources')
  useEffect(() => setActive(tab || 'resources'), [tab])
  const selectTab = (key) => { setActive(key); onTabChange?.(key) }

  let content
  if (active === 'resources') content = <CmdbResources meta={meta} />
  else if (active === 'assets') content = <AssetCenter meta={meta} focusTarget={focusTarget} />
  else if (active === 'servers') content = <ServerCenter meta={meta} focusTarget={focusTarget} />
  else if (active === 'logs') content = <AuditLogs meta={meta} />
  else content = <Alert type="warning" showIcon message="未知的 CMDB 台账" />

  return (
    <section className="cmdb-new-page cmdb-functional-page">
      <div className="cmdb-new-tabs" role="tablist" aria-label="CMDB 台账">
        {tabs.map((item) => (
          <button type="button" role="tab" aria-selected={active === item.key} className={active === item.key ? 'active' : ''} key={item.key} onClick={() => selectTab(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="cmdb-functional-content">{content}</div>
    </section>
  )
}
