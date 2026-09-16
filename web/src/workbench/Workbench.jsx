import React, { useCallback, useEffect, useState } from 'react'
import { Card, Tabs, Tag, Button, List, Typography, Progress, Spin, Space, Tooltip } from 'antd'
import {
  RightOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  ClusterOutlined,
  QrcodeOutlined,
  ToolOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  DashboardOutlined,
  HistoryOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { cmdbApi } from '../cmdb/cmdbApi'

const { Text, Title } = Typography

const STATUS_ORDER = ['在线', '在库', '报废', '维护中', '离线', '故障']

// 快捷功能：全部指向系统内真实存在的模块
const SHORTCUTS = [
  { key: 'search', label: '全局查询', icon: <SearchOutlined /> },
  { key: 'cmdb:resources', label: 'CMDB 资源', icon: <DatabaseOutlined /> },
  { key: 'cmdb:assets', label: '云桌面终端', icon: <DesktopOutlined /> },
  { key: 'cmdb:servers', label: '物理服务器', icon: <DatabaseOutlined /> },
  { key: 'cmdb:labels', label: '编码与标签', icon: <QrcodeOutlined /> },
  { key: 'cmdb:work-orders', label: '工单管理', icon: <ToolOutlined /> },
  { key: 'cmdb:credentials', label: '凭证中心', icon: <SafetyCertificateOutlined /> },
  { key: 'cmdb:config', label: '配置中心', icon: <SettingOutlined /> },
  { key: 'ip_pool', label: 'IP 规划池', icon: <ClusterOutlined /> },
  { key: 'logs', label: '运维履历', icon: <HistoryOutlined /> },
  { key: 'dashboard', label: '统计看板', icon: <DashboardOutlined /> },
]

// 依赖采集端的卡片：本项目没有采集进程与被管设备，如实标注而不是摆一排 0
function PendingCard({ title, reason }) {
  return (
    <Card size="small" title={title} style={{ height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 96,
          padding: '12px 8px',
          textAlign: 'center',
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          {reason}
        </Text>
      </div>
    </Card>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 6) return '凌晨好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function weekOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 1)
  const days = Math.floor((d - start) / 86400000)
  return Math.ceil((days + start.getDay() + 1) / 7)
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

export default function Workbench({ onOpen }) {
  const [orders, setOrders] = useState([])
  const [orderTotal, setOrderTotal] = useState(0)
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [wo, dash] = await Promise.all([
        cmdbApi.listWorkOrders({ page: 1, page_size: 5 }),
        cmdbApi.dashboard(),
      ])
      setOrders(wo.list || [])
      setOrderTotal(wo.total || 0)
      setHealth(dash || null)
    } catch (_) {
      setOrders([])
      setHealth(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const now = new Date()
  const statusCounts = health?.status_counts || {}

  const open = (key) => onOpen && onOpen(key)

  return (
    <div>
      {/* 问候头 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Title level={3} style={{ margin: 0 }}>
            {greeting()}，管理员
          </Title>
          <Text type="secondary">这是你的工作台 — 快速回到工作、处理待办、掌握全局状态。</Text>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Text type="secondary">
            {WEEKDAYS[now.getDay()]} · {dayjs(now).format('YYYY-MM-DD')}
          </Text>
          <div>
            <Text strong>第 {weekOfYear(now)} 周</Text>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* 第一行：最新工单 / 值班表 / 快捷功能 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16,
              marginBottom: 24,
            }}
          >
            <Card
              size="small"
              style={{ minHeight: 272, display: 'flex', flexDirection: 'column' }}
              styles={{ body: { display: 'flex', flexDirection: 'column', flex: 1, padding: 0 } }}
            >
              <Tabs
                size="small"
                defaultActiveKey="orders"
                style={{ padding: '0 8px' }}
                items={[
                  {
                    key: 'orders',
                    label: '最新工单',
                    children: (
                      <div style={{ flex: 1, overflow: 'auto', maxHeight: 200 }}>
                        {orders.length === 0 ? (
                          <div style={{ padding: 24, textAlign: 'center' }}>
                            <Text type="secondary">暂无工单</Text>
                          </div>
                        ) : (
                          <List
                            size="small"
                            dataSource={orders}
                            renderItem={(o) => (
                              <List.Item
                                style={{ cursor: 'pointer', padding: '8px 12px' }}
                                onClick={() => open('cmdb:work-orders')}
                              >
                                <List.Item.Meta
                                  title={<span style={{ fontSize: 13 }}>{o.subject}</span>}
                                  description={
                                    <span style={{ fontSize: 12 }}>
                                      {o.order_no || '-'} · {o.status || '-'} · {o.owner || '-'}
                                    </span>
                                  }
                                />
                                <RightOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />
                              </List.Item>
                            )}
                          />
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'projects',
                    label: '项目管理',
                    children: (
                      <div style={{ padding: 24, textAlign: 'center' }}>
                        <Text type="secondary">项目管理需要新增项目与时间记录数据表，尚未建立。</Text>
                      </div>
                    ),
                  },
                ]}
              />
              <div
                style={{
                  borderTop: '1px solid #f0f0f0',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Text type="secondary" style={{ flex: 1, fontSize: 12 }}>
                  共 {orderTotal} 条工单
                </Text>
                <Button size="small" type="link" onClick={() => open('cmdb:work-orders')}>
                  查看全部 <RightOutlined style={{ fontSize: 10 }} />
                </Button>
              </div>
            </Card>

            <Card
              size="small"
              style={{ minHeight: 272 }}
              title={
                <Space size={6}>
                  <span>值班表</span>
                  <Tag color="blue">今日</Tag>
                  <Tag>本周</Tag>
                </Space>
              }
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 150,
                  padding: '0 16px',
                  textAlign: 'center',
                }}
              >
                <Text type="secondary" style={{ fontSize: 12 }}>
                  值班表需要新增排班数据表（日期 / 班次 / 值班人 / 联系方式），尚未建立。
                  建立后此处显示今日与本周排班。
                </Text>
              </div>
            </Card>

            <Card
              size="small"
              style={{ minHeight: 272 }}
              styles={{ body: { padding: 0 } }}
            >
              <Tabs
                size="small"
                defaultActiveKey="shortcut"
                style={{ padding: '0 8px' }}
                items={[
                  {
                    key: 'shortcut',
                    label: '快捷功能',
                    children: (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                          gap: 4,
                          padding: 4,
                        }}
                      >
                        {SHORTCUTS.map((s) => (
                          <Tooltip key={s.key} title={s.label}>
                            <div
                              onClick={() => open(s.key)}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 4,
                                padding: '8px 2px',
                                borderRadius: 6,
                                cursor: 'pointer',
                                color: '#1f4e79',
                              }}
                            >
                              <span style={{ fontSize: 18 }}>{s.icon}</span>
                              <span style={{ fontSize: 11, color: '#888', textAlign: 'center', lineHeight: 1.2 }}>
                                {s.label}
                              </span>
                            </div>
                          </Tooltip>
                        ))}
                      </div>
                    ),
                  },
                  {
                    key: 'memo',
                    label: '备忘录',
                    children: (
                      <div style={{ padding: 24, textAlign: 'center' }}>
                        <Text type="secondary">备忘录需要新增便签数据表，尚未建立。</Text>
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          </div>

          {/* 运维态势概览 */}
          <Title level={5} style={{ marginBottom: 12 }}>
            运维态势概览
          </Title>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16,
            }}
          >
            <PendingCard title="备份任务" reason="依赖备份中心与适配器，本项目未接入备份系统。" />
            <PendingCard title="巡检任务" reason="依赖巡检模板 / 任务 / 报告，本项目未建立巡检子系统。" />

            {/* 资产健康：真实数据 */}
            <Card
              size="small"
              title="资产健康"
              extra={
                <Button size="small" type="link" onClick={() => open('dashboard')}>
                  查看全部 <RightOutlined style={{ fontSize: 10 }} />
                </Button>
              }
            >
              <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    资产总数
                  </Text>
                  <div style={{ fontSize: 24, fontWeight: 600 }}>{health?.total ?? 0}</div>
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    健康率
                  </Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#389e0d' }}>
                    {health?.health_rate ?? 0}%
                  </div>
                </div>
              </div>
              <Progress
                percent={Number(health?.health_rate) || 0}
                showInfo={false}
                strokeColor="#389e0d"
                size="small"
                style={{ marginBottom: 8 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {STATUS_ORDER.map((s) => `${s} ${statusCounts[s] || 0}`).join(' · ')}
              </Text>
            </Card>

            <Card
              size="small"
              title="即将过保"
              extra={
                <Button size="small" type="link" onClick={() => open('cmdb:resources')}>
                  查看全部 <RightOutlined style={{ fontSize: 10 }} />
                </Button>
              }
            >
              <div style={{ fontSize: 24, fontWeight: 600 }}>{health?.expiring_count ?? 0}</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                90 天内到期的资产（依据「保修到期」字段）
              </Text>
            </Card>

            <PendingCard title="异常业务" reason="依赖业务探测与健康度计算，本项目未接入采集端。" />
            <PendingCard title="监控健康" reason="依赖监控数据源与告警中心，本项目未接入采集端。" />
          </div>
        </>
      )}
    </div>
  )
}
