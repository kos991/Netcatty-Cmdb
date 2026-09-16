import React, { useEffect, useMemo, useState } from 'react'
import {
  Table,
  Button,
  Input,
  Space,
  Modal,
  Form,
  Popconfirm,
  message,
  Typography,
  Tooltip,
} from 'antd'
import { PlusOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons'
import { api } from './api'

export default function TablePage({ table }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null) // null = 新增
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = () => {
    setLoading(true)
    api
      .list(table.key)
      .then((r) => setRows(r.rows || []))
      .catch((e) => message.error('加载失败: ' + e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [table.key])

  const flatRows = useMemo(() => rows.map((r) => ({ ...r.data, __id: r.id })), [rows])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return flatRows
    return flatRows.filter((r) =>
      table.columns.some((c) => String(r[c] ?? '').toLowerCase().includes(kw)),
    )
  }, [flatRows, keyword, table.columns])

  const columns = useMemo(() => {
    const cols = table.columns.map((c) => ({
      title: c,
      dataIndex: c,
      key: c,
      ellipsis: true,
      render: (v) => (v === '' || v == null ? <span style={{ color: '#bbb' }}>—</span> : String(v)),
    }))
    cols.push({
      title: '操作',
      key: '__op',
      fixed: 'right',
      width: 120,
      render: (_, rec) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(rec)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该行？"
            onConfirm={() => doDelete(rec.__id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    })
    return cols
  }, [table.columns])

  const openEdit = (rec) => {
    setEditing(rec)
    form.setFieldsValue(rec)
    setModalOpen(true)
  }

  const openAdd = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const doDelete = async (id) => {
    try {
      await api.remove(table.key, id)
      message.success('已删除')
      load()
    } catch (e) {
      message.error('删除失败: ' + e.message)
    }
  }

  const onSubmit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const data = {}
      for (const c of table.columns) data[c] = values[c] ?? ''
      if (editing) {
        await api.update(table.key, editing.__id, data)
        message.success('已保存')
      } else {
        await api.create(table.key, data)
        message.success('已新增')
      }
      setModalOpen(false)
      load()
    } catch (e) {
      if (e?.errorFields) return // 表单校验错误
      message.error('保存失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          placeholder={`在「${table.name}」中搜索…`}
          style={{ width: 280 }}
          onSearch={setKeyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          新增
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <Tooltip title="导出为 Excel">
          <Button
            icon={<DownloadOutlined />}
            href={api.exportUrl(table.key, 'xlsx')}
            target="_blank"
          >
            Excel
          </Button>
        </Tooltip>
        <Button href={api.exportUrl(table.key, 'csv')} target="_blank">
          CSV
        </Button>
        <Typography.Text type="secondary">共 {filtered.length} 行</Typography.Text>
      </Space>

      <Table
        rowKey="__id"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (t) => `共 ${t} 行`,
        }}
      />

      <Modal
        title={(editing ? '编辑' : '新增') + ' · ' + table.name}
        open={modalOpen}
        onOk={onSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}
        >
          {table.columns.map((c) => (
            <Form.Item key={c} name={c} label={c}>
              <Input placeholder={c} allowClear />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  )
}
