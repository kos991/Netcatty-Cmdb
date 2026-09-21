import React, { useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Row, Progress, Statistic, Table, Typography, Skeleton } from 'antd'
import {
  DesktopOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { api } from './api'

const { Text } = Typography

function StatCard({ title, value, suffix, icon, accent, note }) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Statistic
        title={
          <span>
            <span style={{ color: accent, marginRight: 6 }}>{icon}</span>
            {title}
          </span>
        }
        value={value}
        suffix={suffix}
        valueStyle={{ color: accent, fontWeight: 700 }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {note}
      </Text>
    </Card>
  )
}

function RingCard({ title, percent, label, accent, rows }) {
  return (
    <Card size="small" title={title} style={{ height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <Progress
          type="circle"
          percent={percent}
          size={104}
          strokeColor={accent}
          format={(p) => <span style={{ color: accent, fontWeight: 700 }}>{p}%</span>}
        />
      </div>
      <Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 12, marginBottom: 12 }}>
        {label}
      </Text>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
          <Text type="secondary">{r.label}</Text>
          <Text strong style={{ color: r.color }}>
            {r.value}
          </Text>
        </div>
      ))}
    </Card>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const loadStats = async () => {
    setLoading(true)
    try { setStats(await api.getStats()); setError('') }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { loadStats() }, [])

  const errorView = error && <Alert type="error" showIcon message="加载统计失败" description={error} action={<Button onClick={loadStats} loading={loading}>重试</Button>} />
  if (!stats) return errorView || <Skeleton active paragraph={{ rows: 8 }} />

  const total = stats.total_assets || 1
  const zaiyongRate = Math.round(((stats.status_zaiyong || 0) / total) * 100)
  const anyuanTotal = (stats.anyuan_installed || 0) + (stats.anyuan_uninstalled || 0) || 1
  const anyuanRate = Math.round(((stats.anyuan_installed || 0) / anyuanTotal) * 100)
  const ipTotal = stats.ip_total || 1
  const ipRate = Math.round(((stats.ip_used || 0) / ipTotal) * 100)

  const deptRows = stats.dept_distribution || []

  return (
    <div>
      <div className="cmdb-page-heading"><h2>统计概览</h2><Button onClick={loadStats} loading={loading}>刷新</Button></div>
      {errorView}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={6}>
          <StatCard
            title="终端资产总数"
            value={stats.total_assets ?? 0}
            suffix="台"
            icon={<DesktopOutlined />}
            accent="#1677ff"
            note={`在用率 ${zaiyongRate}%（${stats.status_zaiyong || 0} 台在用）`}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatCard
            title="服务器台账"
            value={stats.server_total ?? 0}
            suffix="台"
            icon={<DatabaseOutlined />}
            accent="#722ed1"
            note={`运行中 ${stats.server_running || 0} 台（含带外 BMC 管控）`}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatCard
            title="业务系统"
            value={stats.app_total ?? 0}
            suffix="个"
            icon={<AppstoreOutlined />}
            accent="#13c2c2"
            note="含数据库、中间件与业务应用"
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatCard
            title="累计流转与维护记录"
            value={stats.total_logs ?? 0}
            suffix="条"
            icon={<SwapOutlined />}
            accent="#389e0d"
            note={`调换人 ${stats.transfer_count || 0} 次 / 维修换件 ${stats.maintenance_count || 0} 次`}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <RingCard
            title="终端资产在用与健康度"
            percent={zaiyongRate}
            label="按在用台数占终端总数计算"
            accent="#1677ff"
            rows={[
              { label: '正常在用', value: `${stats.status_zaiyong ?? 0} 台` },
              { label: '闲置可用', value: `${stats.status_xianzhi ?? 0} 台` },
              { label: '报修 / 维修中', value: `${stats.status_weixiu ?? 0} 台`, color: '#d48806' },
              { label: '库房备用', value: `${stats.status_cangku ?? 0} 台` },
            ]}
          />
        </Col>
        <Col xs={24} md={8}>
          <RingCard
            title="软件安装覆盖"
            percent={anyuanRate}
            label="按已登记安全软件的终端占比计算"
            accent={anyuanRate > 80 ? '#389e0d' : '#d48806'}
            rows={[
              { label: '已登记安全软件', value: `${stats.anyuan_installed ?? 0} 台`, color: '#389e0d' },
              { label: '未安装 / 待补丁', value: `${stats.anyuan_uninstalled ?? 0} 台`, color: '#cf1322' },
              { label: '合规达标评级', value: '良好' },
            ]}
          />
        </Col>
        <Col xs={24} md={8}>
          <RingCard
            title="专网 IP 资源池规划占用"
            percent={ipRate}
            label="按已分配在用地址占规划池总量计算"
            accent="#722ed1"
            rows={[
              { label: '规划池总容量', value: `${stats.ip_total ?? 0} 个` },
              { label: '已分配在用', value: `${stats.ip_used ?? 0} 个`, color: '#722ed1' },
              { label: '可用空闲地址', value: `${stats.ip_free ?? 0} 个`, color: '#389e0d' },
            ]}
          />
        </Col>
      </Row>

      <Card size="small" title="终端资产部门分布排行（Top 10）" style={{ marginTop: 16 }}>
        <Table
          rowKey={(r, i) => r.department || i}
          size="small"
          dataSource={deptRows}
          pagination={false}
          locale={{ emptyText: '暂无部门分布数据' }}
          columns={[
            { title: '排名', key: 'rank', width: 70, render: (_, __, i) => i + 1 },
            { title: '部门名称', dataIndex: 'department' },
            {
              title: '终端资产数',
              dataIndex: 'count',
              width: 140,
              render: (v) => <b>{v} 台</b>,
            },
            {
              title: '占比',
              key: 'percent',
              width: 220,
              render: (_, r) => {
                const pct = Math.round((r.count / total) * 100)
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Progress percent={pct} showInfo={false} size="small" style={{ flex: 1, margin: 0 }} />
                    <span style={{ width: 36, textAlign: 'right', fontSize: 12 }}>{pct}%</span>
                  </div>
                )
              },
            },
          ]}
        />
      </Card>
    </div>
  )
}
