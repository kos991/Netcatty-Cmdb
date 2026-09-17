import React, { useState } from 'react'
import {
  AppstoreOutlined,
  BellOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons'
import './shell-preview.css'

const modules = [
  { key: 'search', label: '全局查询', icon: <SearchOutlined /> },
  { key: 'cmdb', label: 'Cmdb', icon: <DatabaseOutlined /> },
  { key: 'ip', label: 'IP 规划池', icon: <ClusterOutlined /> },
  { key: 'logs', label: '运维履历', icon: <HistoryOutlined /> },
  { key: 'dashboard', label: '统计看板', icon: <DashboardOutlined /> },
]

const assets = [
  ['终端资产-031', 'ZC-VDI-0031', '192.0.2.31', '终端运维组', '在用'],
  ['机房服务器-DB01', 'SRV-DB-0001', '192.0.2.12', '平台运维组', '在线'],
  ['终端资产-032', 'ZC-VDI-0032', '192.0.2.32', '终端运维组', '维修中'],
  ['应用服务器-协作平台', 'APP-XT-0004', '192.0.2.24', '平台运维组', '在线'],
]

function QueryPanel({ compact = false }) {
  return <div className={compact ? 'sp-query compact' : 'sp-query'}>
    <div className="sp-query-input"><SearchOutlined /><span>搜索资产名称、编号、SN、IP、负责人……</span><kbd>Ctrl K</kbd></div>
    {!compact && <div className="sp-query-scopes"><span>查询范围</span><b>全部模块</b><i>资产 1,286</i><i>服务器 42</i><i>应用 86</i><i>IP 地址 2,048</i></div>}
  </div>
}

function Results({ dense = false }) {
  return <div className={dense ? 'sp-results dense' : 'sp-results'}>
    <div className="sp-result-head"><strong>最近访问的资源</strong><span>共 1,286 项</span><button>查看全部</button></div>
    <div className="sp-table">
      <div className="sp-tr sp-th"><span>名称 / 编号</span><span>状态</span><span>管理 IP</span><span>所属部门</span><span>操作</span></div>
      {assets.map((row) => <div className="sp-tr" key={row[1]}><span><b>{row[0]}</b><small>{row[1]}</small></span><span><em className={row[4] === '维修中' ? 'warn' : 'ok'} />{row[4]}</span><code>{row[2]}</code><span>{row[3]}</span><button>详情</button></div>)}
    </div>
  </div>
}

function PreviewA({ active, setActive }) {
  return <div className="sp-shell shell-a">
    <header className="a-top"><div className="a-brand"><span className="a-mark">C</span><div><strong>Cmdb</strong><small>资产与基础设施全景管理</small></div></div><nav>{modules.map((m) => <button className={active === m.key ? 'active' : ''} onClick={() => setActive(m.key)} key={m.key}>{m.icon}{m.label}</button>)}</nav><div className="a-actions"><BellOutlined /><span className="a-status"><i />服务正常</span><UserOutlined /></div></header>
    <div className="a-sub"><span>当前位置：{modules.find((m) => m.key === active)?.label}</span><div><button>导出</button><button>帮助</button></div></div>
    <main className="a-main"><div className="a-title"><div><small>资产管理系统 / 查询台</small><h1>{active === 'search' ? '全局查询' : modules.find((m) => m.key === active)?.label}</h1><p>跨模块定位资源，结果可直接进入对应台账。</p></div><span className="a-date">2026 年 09 月 16 日</span></div><QueryPanel /><div className="a-kpis"><div><small>在用资产</small><strong>1,204</strong><span>↑ 2.4%</span></div><div><small>待处理履历</small><strong>18</strong><span className="orange">需要关注</span></div><div><small>IP 可用地址</small><strong>642</strong><span>31.3% 空闲</span></div><div><small>服务器在线率</small><strong>98.7%</strong><span>42 台服务器</span></div></div><Results /></main>
  </div>
}

function PreviewB({ active, setActive }) {
  return <div className="sp-shell shell-b">
    <header className="b-top"><div className="b-brand"><span><DatabaseOutlined /></span><strong>Cmdb</strong></div><div className="b-search"><SearchOutlined /><span>Search resources...</span><kbd>⌘ K</kbd></div><nav>{modules.map((m) => <button className={active === m.key ? 'active' : ''} onClick={() => setActive(m.key)} key={m.key}>{m.label}</button>)}</nav><div className="b-actions"><BellOutlined /><SettingOutlined /><span className="b-user">Z</span></div></header>
    <main className="b-main"><aside><div className="b-side-title">WORKSPACE</div>{['资源总账','终端资产','基础设施','业务系统'].map((x, i) => <button className={i === 0 ? 'active' : ''} key={x}><AppstoreOutlined />{x}<span>{[1286, 1180, 42, 86][i]}</span></button>)}<div className="b-side-title second">TOOLS</div>{['IP 规划池','运维履历','统计看板'].map((x) => <button key={x}><FileSearchOutlined />{x}</button>)}</aside><section className="b-content"><div className="b-crumb">Cmdb / 资源总账 <span>·</span> 所有资源</div><div className="b-head"><div><h1>资源总账</h1><p>Inventory / All resources</p></div><div><button className="b-ghost">批量编辑</button><button className="b-primary">+ 新增资源</button></div></div><div className="b-filter"><div><SearchOutlined /><span>筛选名称、IP 或编号</span></div><button>状态：全部⌄</button><button>组织：全部⌄</button><button>字段设置</button></div><Results dense /></section></main>
  </div>
}

function PreviewC({ active, setActive }) {
  return <div className="sp-shell shell-c">
    <header className="c-top"><div className="c-brand"><span className="c-logo">Cmdb</span><div><strong>Cmdb</strong><small>资产与基础设施管理系统</small></div></div><div className="c-global"><SearchOutlined /><span>全局查询：输入资产、服务器、IP 或人员</span></div><div className="c-user"><span className="c-dot" />在线　管理员⌄</div></header>
    <nav className="c-nav">{modules.map((m) => <button className={active === m.key ? 'active' : ''} onClick={() => setActive(m.key)} key={m.key}>{m.icon}<span>{m.label}</span></button>)}<div className="c-nav-fill" /><button><SettingOutlined /><span>系统设置</span></button></nav>
    <main className="c-main"><div className="c-banner"><div><span>工作台 / {modules.find((m) => m.key === active)?.label}</span><h1>今天，先找到你要的资产</h1><p>统一检索入口，进入模块后继续按条件和分页查询。</p></div><div className="c-banner-stat"><b>1,286</b><span>资源总量</span></div></div><QueryPanel compact /><div className="c-grid"><section><div className="c-section-head"><strong>资产状态概览</strong><button>进入看板 →</button></div><div className="c-status-grid"><div><i className="blue" /><b>1,204</b><span>在用</span></div><div><i className="green" /><b>42</b><span>在线服务器</span></div><div><i className="orange" /><b>18</b><span>维修中</span></div><div><i className="gray" /><b>22</b><span>闲置</span></div></div></section><section><div className="c-section-head"><strong>快捷入口</strong></div><div className="c-links"><button onClick={() => setActive('cmdb')}><DatabaseOutlined />资源总账</button><button onClick={() => setActive('ip')}><ClusterOutlined />IP 规划池</button><button onClick={() => setActive('logs')}><HistoryOutlined />运维履历</button><button onClick={() => setActive('dashboard')}><DashboardOutlined />统计看板</button></div></section></div><Results /></main>
  </div>
}

export default function ShellPreview() {
  const [scheme, setScheme] = useState('a')
  const [active, setActive] = useState('search')
  return <div className="shell-preview-page"><div className="sp-picker"><strong>前台界面方案预览</strong><span>选择整套系统框架</span><div className="sp-options"><button className={scheme === 'a' ? 'active' : ''} onClick={() => setScheme('a')}><b>A</b><span>政务查询台</span><small>正式、清晰、查询优先</small></button><button className={scheme === 'b' ? 'active' : ''} onClick={() => setScheme('b')}><b>B</b><span>NetBox 控制台</span><small>紧凑、工程、资源密度高</small></button><button className={scheme === 'c' ? 'active' : ''} onClick={() => setScheme('c')}><b>C</b><span>国产运维台</span><small>模块工作区、操作集中</small></button></div></div>{scheme === 'a' ? <PreviewA active={active} setActive={setActive} /> : scheme === 'b' ? <PreviewB active={active} setActive={setActive} /> : <PreviewC active={active} setActive={setActive} />}</div>
}
