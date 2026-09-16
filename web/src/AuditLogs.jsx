import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Descriptions, Drawer, Table, Input, Select, Button, Tag, Space, Typography } from 'antd'
import {
  SearchOutlined,
  ReloadOutlined,
  HistoryOutlined,
  SwapOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { api } from './api'

// 履历类型 → 展示色与图标（沿用原有语义）
const TYPE_STYLE = {
  调换使用人: { color: 'success', icon: <SwapOutlined /> },
  设备维修更换: { color: 'orange', icon: <ToolOutlined /> },
  建档入库: { color: 'purple', icon: <HistoryOutlined /> },
  设备回收注销: { color: 'red', icon: <HistoryOutlined /> },
}

export default function AuditLogs({ meta, focusTarget }) {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [logType, setLogType] = useState('全部')
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getLogs({
        log_type: logType === '全部' ? '' : logType,
        keyword,
        page,
        page_size: pageSize,
      })
      setLogs(res.list || [])
      setTotal(res.total || 0)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [logType, keyword, page, pageSize])

  useEffect(() => {
    loadData()
  }, [loadData])

  const openTarget = async () => {
    if (focusTarget?.tableKey !== 'asset_logs') return
    setDetail({ id: focusTarget.id })
    setDetailError('')
    try {
      const response = await api.getAsset(focusTarget.data?.['资产ID'])
      const log = response.logs?.find((item) => item.id === focusTarget.id)
      if (!log) throw new Error('未找到该履历记录')
      setDetail(log)
    } catch (e) { setDetailError(e.message) }
  }
  useEffect(() => { openTarget() }, [focusTarget])

  const typeOptions = ['全部', ...(meta?.log_types || [])]

  const columns = [
    { title: '发生时间', dataIndex: 'log_time', width: 170, render: (v) => v || '-' },
    {
      title: '操作类型',
      dataIndex: 'log_type',
      width: 150,
      render: (v) => {
        const st = TYPE_STYLE[v] || { color: 'blue', icon: <HistoryOutlined /> }
        return (
          <Tag color={st.color} icon={st.icon}>
            {v}
          </Tag>
        )
      },
    },
    {
      title: '关联资产',
      dataIndex: 'asset_id',
      width: 110,
      render: (v) => (v ? `#${v}` : '-'),
    },
    {
      title: '人员交接变动',
      key: 'users',
      width: 220,
      render: (_, r) =>
        r.log_type === '调换使用人' ? (
          <div>
            <span style={{ textDecoration: 'line-through', color: '#bbb' }}>{r.from_user || '无'}</span>
            <span style={{ margin: '0 4px' }}>→</span>
            <strong style={{ color: '#389e0d' }}>{r.to_user}</strong>
            <div style={{ fontSize: 12, color: '#888' }}>
              {r.from_location || '-'} → {r.to_location || '-'}
            </div>
          </div>
        ) : (
          r.to_user || r.from_user || '-'
        ),
    },
    {
      title: 'SN 换件记录',
      key: 'sn',
      width: 200,
      render: (_, r) =>
        r.old_sn || r.new_sn ? (
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {r.old_sn ? <span style={{ textDecoration: 'line-through', color: '#999' }}>{r.old_sn}</span> : null}
            {r.old_sn && r.new_sn ? ' → ' : ''}
            {r.new_sn ? <b style={{ color: '#fa8c16' }}>{r.new_sn}</b> : null}
          </span>
        ) : (
          '-'
        ),
    },
    { title: '详细说明 / 原因', dataIndex: 'description', render: (v) => v || '-' },
    { title: '经办人', dataIndex: 'operator', width: 120, render: (v) => v || '系统' },
  ]

  return (
    <div>
      <div className="cmdb-page-heading"><h2>运维履历</h2></div>
      {error && <Alert type="error" showIcon message="加载履历失败" description={error} action={<Button onClick={loadData}>重试</Button>} />}
      <div className="cmdb-query-toolbar" style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <Input.Search
            allowClear
            style={{ width: 300 }}
            placeholder="搜索人员 / SN / 变更说明 / 经办人"
            prefix={<SearchOutlined />}
            onSearch={(v) => {
              setPage(1)
              setKeyword(v.trim())
            }}
          />
          <Select
            size="middle"
            style={{ width: 170 }}
            value={logType}
            onChange={(v) => {
              setLogType(v)
              setPage(1)
            }}
            options={typeOptions.map((t) => ({ value: t, label: t === '全部' ? '全部类型' : t }))}
          />
          <Button icon={<ReloadOutlined />} onClick={loadData}>
            刷新
          </Button>
          <Typography.Text type="secondary">
            共 <b>{total}</b> 条履历日志
          </Typography.Text>
        </Space>
      </div>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={logs}
        onRow={(record) => ({ onClick: () => { setDetailError(''); setDetail(record) } })}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无履历记录' }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p)
            if (ps && ps !== pageSize) setPageSize(ps)
          },
        }}
      />
      <Drawer title="运维履历详情" width={600} open={!!detail} onClose={() => setDetail(null)}>
        {detailError ? <Alert type="error" message={detailError} action={<Button onClick={openTarget}>重试</Button>} /> : <Descriptions column={1} bordered items={[
          ['发生时间', detail?.log_time], ['操作类型', detail?.log_type], ['关联资产', detail?.asset_id],
          ['原使用人', detail?.from_user], ['新使用人', detail?.to_user], ['原位置', detail?.from_location], ['新位置', detail?.to_location],
          ['原序列号', detail?.old_sn], ['新序列号', detail?.new_sn], ['说明', detail?.description], ['经办人', detail?.operator],
        ].map(([label, value]) => ({ key: label, label, children: value || '-' }))} />}
      </Drawer>
    </div>
  )
}
