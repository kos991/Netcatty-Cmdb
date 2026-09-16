import React, { useCallback, useEffect, useState } from 'react'
import {
  Modal,
  Table,
  Button,
  Space,
  Tag,
  Form,
  Input,
  AutoComplete,
  Popconfirm,
  message,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { api } from './api'

const CATEGORY_COLOR = { 专网: 'blue', 外网: 'orange', 内网: 'green' }

// 「网段管理」：定义各网段的名称、类别（专网 / 外网 / 内网）、网段前缀、网关、VLAN 与用途。
// 重命名网段会由后端级联更新 ip_pool.subnet；网段下还有 IP 时后端会拒绝删除。
export default function IPSubnetManager({ open, onClose, onChanged }) {
  const [list, setList] = useState([])
  const [categories, setCategories] = useState(['专网', '外网', '内网'])
  const [loading, setLoading] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getIPSubnets()
      setList(res.list || [])
      if (res.categories && res.categories.length) setCategories(res.categories)
    } catch (e) {
      message.error('加载网段失败：' + e.message)
      setList([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ category: '专网' })
    setFormOpen(true)
  }

  const openEdit = (rec) => {
    setEditing(rec)
    form.setFieldsValue({
      name: rec.name,
      category: rec.category || '专网',
      prefix: rec.prefix || '',
      cidr: rec.cidr || '',
      gateway: rec.gateway || '',
      vlan: rec.vlan || '',
      purpose: rec.purpose || '',
      remark: rec.remark || '',
    })
    setFormOpen(true)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      if (editing) {
        await api.updateIPSubnet(editing.id, values)
        message.success('已保存')
      } else {
        await api.createIPSubnet(values)
        message.success(`已新增网段「${values.name}」`)
      }
      setFormOpen(false)
      load()
      onChanged && onChanged()
    } catch (e) {
      if (e?.errorFields) return
      message.error('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async (rec) => {
    try {
      await api.deleteIPSubnet(rec.id)
      message.success('已删除网段定义')
      load()
      onChanged && onChanged()
    } catch (e) {
      message.error(e.message)
    }
  }

  const columns = [
    {
      title: '网段名称',
      dataIndex: 'name',
      width: 180,
      render: (v, r) => (
        <Space size={4}>
          <span>{v}</span>
          {r.defined === false ? <Tag color="warning">未定义</Tag> : null}
        </Space>
      ),
    },
    {
      title: '类别',
      dataIndex: 'category',
      width: 100,
      render: (v) => (v ? <Tag color={CATEGORY_COLOR[v] || 'default'}>{v}</Tag> : '-'),
    },
    { title: '网段', dataIndex: 'prefix', width: 140, render: (v) => v || '-' },
    { title: 'CIDR', dataIndex: 'cidr', width: 160, render: (v) => v || '-' },
    { title: '网关', dataIndex: 'gateway', width: 140, render: (v) => v || '-' },
    { title: 'VLAN', dataIndex: 'vlan', width: 90, render: (v) => v || '-' },
    { title: '用途', dataIndex: 'purpose', width: 160, render: (v) => v || '-' },
    {
      title: 'IP 数',
      key: 'count',
      width: 160,
      render: (_, r) => (
        <span>
          {r.total}{' '}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            （占 {r.used} / 空 {r.free}）
          </Typography.Text>
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_, rec) => (
        <Space size={2}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(rec)}>
            编辑
          </Button>
          <Popconfirm
            title={`确认删除网段「${rec.name}」？`}
            description="该网段下若还有 IP，系统会拒绝删除并说明原因。"
            onConfirm={() => doDelete(rec)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Modal
        title="网段管理"
        open={open}
        onCancel={onClose}
        footer={<Button onClick={onClose}>关闭</Button>}
        width={1000}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          在这里定义各网段的名称与类别（专网 / 外网 / 内网），并可填写网段、CIDR、网关、VLAN 与用途。
          重命名网段会自动同步到该网段下的全部 IP 记录；网段下还有 IP 时不允许删除。
          「未定义」表示该网段只从 IP 数据中读到了名字，还没有定义记录。
        </Typography.Paragraph>

        <div className="cmdb-toolbar">
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增网段
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Typography.Text type="secondary">共 {list.length} 个网段</Typography.Text>
        </div>

        <Table
          rowKey={(r) => r.id || `derived-${r.name}`}
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 'max-content' }}
          pagination={false}
          locale={{ emptyText: '暂无网段，点击「新增网段」开始定义' }}
        />
      </Modal>

      <Modal
        title={editing ? `编辑网段「${editing.name}」` : '新增网段'}
        open={formOpen}
        onOk={submit}
        onCancel={() => setFormOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="网段名称"
            rules={[{ required: true, message: '网段名称不能为空' }]}
          >
            <Input placeholder="如 专网9段 / 内网办公段" allowClear />
          </Form.Item>
          <Form.Item name="category" label="类别">
            {/* 用 AutoComplete：既可选预设的专网 / 外网 / 内网，也可直接输入自定义类别 */}
            <AutoComplete
              placeholder="专网 / 外网 / 内网，也可自行填写"
              options={categories.map((c) => ({ value: c }))}
              filterOption={(input, option) => String(option.value).includes(input)}
            />
          </Form.Item>
          <Form.Item name="prefix" label="网段（前三段）">
            <Input placeholder="如 138.64.9" allowClear />
          </Form.Item>
          <Form.Item name="cidr" label="CIDR">
            <Input placeholder="如 138.64.9.0/24" allowClear />
          </Form.Item>
          <Form.Item name="gateway" label="网关">
            <Input placeholder="如 138.64.9.1" allowClear />
          </Form.Item>
          <Form.Item name="vlan" label="VLAN">
            <Input placeholder="如 2535" allowClear />
          </Form.Item>
          <Form.Item name="purpose" label="用途">
            <Input placeholder="如 速裁 / 刑一 终端" allowClear />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
