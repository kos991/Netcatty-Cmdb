import React, { useEffect, useState } from 'react'
import { Table, Typography, Spin, Tag } from 'antd'
import { api } from './api'

const tableNameMap = { hezi: '终端主机登记', xianshi: '显示器登记' }

export default function Duplicates() {
  const [dups, setDups] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .duplicates()
      .then((r) => setDups(r.duplicates || []))
      .catch(() => setDups([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  const columns = [
    { title: 'SN', dataIndex: 'sn', key: 'sn' },
    { title: '重复次数', dataIndex: 'count', key: 'count', width: 120 },
    {
      title: '出现位置',
      dataIndex: 'where',
      key: 'where',
      render: (where) =>
        (where || []).map((w) => {
          const [t, id] = w.split('#')
          return (
            <Tag key={w} color="orange">
              {tableNameMap[t] || t} · ID {id}
            </Tag>
          )
        }),
    },
  ]

  return (
    <div>
      <Typography.Paragraph type="secondary">
        统计“终端主机登记.SN”与“显示器登记.显示器 SN”中出现超过一次的设备编号。
      </Typography.Paragraph>
      <Table
        rowKey="sn"
        size="small"
        columns={columns}
        dataSource={dups}
        pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 条` }}
      />
    </div>
  )
}
