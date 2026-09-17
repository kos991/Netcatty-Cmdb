import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Input, Spin, Tag, message } from 'antd'
import {
  SearchOutlined,
  RightOutlined,
  LaptopOutlined,
  DesktopOutlined,
  AppstoreOutlined,
  HistoryOutlined,
  ClusterOutlined,
} from '@ant-design/icons'
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import { api } from './api'

gsap.registerPlugin(Flip)

const GROUPS = [
  { name: '终端资产', icon: <LaptopOutlined />, tone: 'blue', module: 'cmdb_center' },
  { name: '基础设施', icon: <DesktopOutlined />, tone: 'green', module: 'cmdb_center' },
  { name: '业务系统', icon: <AppstoreOutlined />, tone: 'violet', module: 'cmdb_center' },
  { name: '运维履历', icon: <HistoryOutlined />, tone: 'amber', module: 'logs' },
  { name: 'IP规划池', icon: <ClusterOutlined />, tone: 'cyan', module: 'ip_pool' },
]

export default function GlobalSearch({ onNavigate, onOpenModule }) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const resultRef = useRef(null)
  const flipState = useRef(null)

  const groups = useMemo(
    () => GROUPS.map((group) => ({ ...group, items: results.filter((item) => item.group === group.name) }))
      .filter((group) => group.items.length),
    [results],
  )

  useLayoutEffect(() => {
    if (!flipState.current || !resultRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    Flip.from(flipState.current, {
      targets: resultRef.current.querySelectorAll('.global-result-group'),
      duration: 0.32,
      ease: 'power2.out',
      stagger: 0.035,
      clearProps: 'all',
    })
    flipState.current = null
  }, [groups])

  const doSearch = async (value) => {
    const query = (value ?? keyword).trim()
    if (!query) {
      setResults([])
      setSearched(false)
      return
    }
    if (resultRef.current) flipState.current = Flip.getState(resultRef.current.querySelectorAll('.global-result-group'))
    setKeyword(query)
    setSearched(true)
    setLoading(true)
    try {
      const response = await api.search(query, 50)
      setResults(response.results || [])
    } catch (error) {
      setResults([])
      message.error(`全局查询失败：${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="global-search-v2">
      <section className="global-query-panel-v2">
        <div className="global-query-label-v2">输入任意线索</div>
        <div className="global-query-row-v2">
          <Input
            data-global-search-input
            allowClear
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => doSearch()}
            placeholder="姓名、资产编号、序列号、IP、服务器或应用名称"
            prefix={<SearchOutlined />}
          />
          <Button type="primary" onClick={() => doSearch()} loading={loading}>查询</Button>
        </div>
        <div className="global-scope-list-v2">
          <span>查询范围</span>
          {GROUPS.map((group) => <i key={group.name}>{group.name}</i>)}
        </div>
      </section>

      {!searched ? (
        <section className="global-entry-grid-v2">
          <div className="global-section-title-v2">
            <div><strong>按台账进入</strong><span>每个模块使用独立的查询和展示方式</span></div>
          </div>
          <div className="global-module-grid-v2">
            {GROUPS.map((group) => (
              <button key={group.name} type="button" className={`tone-${group.tone}`} onClick={() => onOpenModule?.(group.module)}>
                <span className="global-module-icon-v2">{group.icon}</span>
                <span><strong>{group.name}</strong><small>进入台账查询</small></span>
                <RightOutlined />
              </button>
            ))}
          </div>
        </section>
      ) : loading ? (
        <div className="global-search-state-v2"><Spin /></div>
      ) : groups.length === 0 ? (
        <div className="global-search-state-v2"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`未找到“${keyword}”相关记录`} /></div>
      ) : (
        <section className="global-results-v2" ref={resultRef}>
          <div className="global-section-title-v2">
            <div><strong>查询结果</strong><span>“{keyword}”共匹配 {results.length} 条记录</span></div>
            <Button type="text" onClick={() => { setKeyword(''); setResults([]); setSearched(false) }}>清空结果</Button>
          </div>
          {groups.map((group) => (
            <article className="global-result-group" key={group.name}>
              <header>
                <span className={`global-result-icon-v2 tone-${group.tone}`}>{group.icon}</span>
                <strong>{group.name}</strong>
                <Tag>{group.items.length}</Tag>
              </header>
              <div className="global-result-list-v2">
                {group.items.map((item, index) => {
                  const detail = Object.entries(item.data || {})
                    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
                    .slice(0, 4)
                    .map(([key, value]) => `${key}：${value}`)
                    .join(' · ')
                  return (
                    <button key={`${item.table}-${item.id}-${index}`} type="button" onClick={() => onNavigate?.(item)}>
                      <span><strong>{item.title || `${item.table} #${item.id}`}</strong><small>{[item.subtitle, detail].filter(Boolean).join(' · ')}</small></span>
                      <RightOutlined />
                    </button>
                  )
                })}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
