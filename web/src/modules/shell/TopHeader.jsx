import React from 'react'
import {
  ClusterOutlined,
  DatabaseOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
  TeamOutlined,
  SlidersOutlined,
} from '@ant-design/icons'
import './top-header.css'

const ITEMS = [
  { key: 'search', label: '全局查询', icon: <SearchOutlined /> },
  { key: 'cmdb_center', label: 'CMDB 资产总账', icon: <DatabaseOutlined /> },
  { key: 'org_persons', label: '组织与人员', icon: <TeamOutlined /> },
  { key: 'custom_fields', label: '自定义字段', icon: <SlidersOutlined /> },
  { key: 'ip_pool', label: 'IP 规划池', icon: <ClusterOutlined /> },
]

export default function TopHeader({ current, onNavigate, onSearch }) {
  return (
    <header className="top-header">
      <button className="top-brand" type="button" onClick={() => onNavigate('search')}>
        <span className="top-brand-mark"><DatabaseOutlined /></span>
        <span><strong>CMDB</strong><small>资产管理平台</small></span>
      </button>
      <button className="top-search" type="button" onClick={onSearch}>
        <SearchOutlined /><span>搜索资产、服务器、人员或 IP</span><kbd>Ctrl K</kbd>
      </button>
      <nav className="top-nav" aria-label="主导航">
        {ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={current === item.key || (current === 'cmdb' && item.key === 'cmdb_center') ? 'active' : ''}
            onClick={() => onNavigate(item.key)}
          >
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="top-actions">
        <span className="top-online"><i />在线</span>
        <SettingOutlined />
        <span className="top-user"><UserOutlined /></span>
      </div>
    </header>
  )
}
