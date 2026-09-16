import React, { useCallback, useEffect, useState } from 'react'
import { Card, Col, Row, Statistic, List, Empty, Tag, Progress, Button, Spin, Space, Typography, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { cmdbApi } from './cmdbApi'

const STATUS_ORDER = ['在线', '离线', '故障', '维护中', '在库', '报废']
const STATUS_COLOR = {
  在线: 'success',
  离线: 'error',
  故障: 'error',
  维护中: 'warning',
  在库: 'processing',
  报废: 'default',
}

function DistBars({ data, emptyText, color }) {
  if (!data || data.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
  }
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div>
      {data.map((d) => (
        <div key={d.name} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>{d.name}</span>
            <span style={{ color: '#888' }}>{d.count}</span>
          </div>
          <Progress
            percent={Math.round((d.count / max) * 100)}
            showInfo={false}
            size="small"
            strokeColor={color}
          />
        </div>
      ))}
    </div>
  )
}

export default function CmdbDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await cmdbApi.dashboard()
      setData(res)
    } catch (e) {
      setData({})
      message.error('加载仪表盘失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!data) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 60 }}>
        <Spin size="large" />
      </div>
    )
  }

  const statusCounts = data.status_counts || {}
  const recentAssets = data.recent_assets || []
  const recentOrders = data.recent_work_orders || []
  const abnormal = data.abnormal_devices || []
  const workOrderTotal = data.work_order_total || 0

  return (
    <div>
      <div className="cmdb-toolbar" style={{ justifyContent: 'space-between' }}>
        <Typography.Text type="secondary">
          聚焦资产健康、处理压力与近期风险，帮助你快速定位需要优先处理的问题。
        </Typography.Text>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>
          刷新数据
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        {/* 资产总览 */}
        <Col xs={24} lg={12}>
          <Card title="资产总览" size="small">
            <Statistic title="资产总数" value={data.total || 0} />
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="secondary">最近新增资产</Typography.Text>
              {recentAssets.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无资产" />
              ) : (
                <List
                  size="small"
                  dataSource={recentAssets}
                  renderItem={(a) => (
                    <List.Item>
                      <Space direction="vertical" size={0} style={{ width: '100%' }}>
                        <span>{a.name}</span>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {a.category_name || '未分类'} · {a.asset_code || '-'} · {a.created_at || '-'}
                        </Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </div>
          </Card>
        </Col>

        {/* 资产健康概览 */}
        <Col xs={24} lg={12}>
          <Card title="资产健康概览" size="small">
            <Row gutter={16}>
              <Col span={12}>
                <Statistic title="健康率" value={data.health_rate ?? 0} suffix="%" />
              </Col>
              <Col span={12}>
                <Statistic
                  title="需要重点关注"
                  value={data.attention_rate ?? 0}
                  suffix="%"
                  valueStyle={{ color: (data.attention_count || 0) > 0 ? '#cf1322' : undefined }}
                />
              </Col>
            </Row>
            <div style={{ marginTop: 12 }}>
              <Space wrap size={4}>
                {STATUS_ORDER.map((s) => (
                  <Tag key={s} color={STATUS_COLOR[s]}>
                    {s} {statusCounts[s] || 0}
                  </Tag>
                ))}
              </Space>
            </div>
          </Card>
        </Col>

        {/* 异常设备关注 */}
        <Col xs={24} lg={12}>
          <Card title="异常设备关注" size="small">
            <Typography.Text type="secondary">
              {abnormal.length} 台待关注（离线 / 故障）
            </Typography.Text>
            {abnormal.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无异常设备，当前运行状态良好" />
            ) : (
              <List
                size="small"
                dataSource={abnormal}
                renderItem={(a) => (
                  <List.Item>
                    <Space>
                      <Tag color={STATUS_COLOR[a.status] || 'default'}>{a.status}</Tag>
                      <span>{a.name}</span>
                      <Typography.Text type="secondary">{a.mgmt_ip || '-'}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* 最新工单动态 */}
        <Col xs={24} lg={12}>
          <Card title="最新工单动态" size="small">
            <Typography.Text type="secondary">{workOrderTotal} 条工单</Typography.Text>
            {recentOrders.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无最新工单" />
            ) : (
              <List
                size="small"
                dataSource={recentOrders}
                renderItem={(w) => (
                  <List.Item>
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <span>{w.subject}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {w.order_no || '-'} · {w.status || '-'} · {w.owner || '-'}
                      </Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* 设备分类分布 */}
        <Col xs={24} lg={8}>
          <Card title="设备分类分布" size="small">
            <DistBars data={data.category_dist} emptyText="暂无分类数据" color="#1f4e79" />
          </Card>
        </Col>

        {/* 部门资产分布 */}
        <Col xs={24} lg={8}>
          <Card title="部门资产分布" size="small">
            <DistBars data={(data.department_dist || []).slice(0, 10)} emptyText="暂无部门数据" color="#2f7ed8" />
          </Card>
        </Col>

        {/* 设备地理分布 */}
        <Col xs={24} lg={8}>
          <Card title="设备地理分布" size="small">
            <DistBars
              data={data.geo_dist}
              emptyText='暂无带地理位置的资产（可在资产编辑的"地理位置"中填写省份/城市）'
              color="#52a550"
            />
          </Card>
        </Col>

        {/* 即将过保资产 */}
        <Col xs={24}>
          <Card title="即将过保资产" size="small">
            <Typography.Text type="secondary">聚焦 90 天内到期资产，提前安排续保与替换计划。</Typography.Text>
            <div style={{ marginTop: 8 }}>
              {(data.expiring_count || 0) === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无近期过保资产" />
              ) : (
                <Statistic title="90 天内到期" value={data.expiring_count} suffix="项" />
              )}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
