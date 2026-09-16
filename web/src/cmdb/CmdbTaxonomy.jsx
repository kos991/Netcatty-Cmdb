import React, { useCallback, useEffect, useState } from 'react'
import {
  Modal,
  Tabs,
  Table,
  Button,
  Space,
  Form,
  Input,
  InputNumber,
  Select,
  Popconfirm,
  message,
  Typography,
  Tag,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { cmdbApi } from './cmdbApi'

const KINDS = [
  { key: 'orgs', label: '组织', unit: '组织' },
  { key: 'groups', label: '分组', unit: '分组' },
  { key: 'categories', label: '类型', unit: '设备分类' },
]

// 收集某节点的全部后代 ID（用于「上级」下拉排除自身与子孙，避免成环）
function collectDescendants(nodes, id) {
  const out = []
  const walk = (pid) => {
    nodes
      .filter((n) => n.parent_id === pid)
      .forEach((n) => {
        out.push(n.id)
        walk(n.id)
      })
  }
  walk(id)
  return out
}

export default function CmdbTaxonomy({ open, kind = 'orgs', presetParent = null, autoCreate = false, initialEdit = null, onClose, onChanged }) {
  const [activeKind, setActiveKind] = useState(kind)
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const unit = (KINDS.find((k) => k.key === activeKind) || {}).unit || '节点'

  const load = useCallback(
    async (k = activeKind) => {
      setLoading(true)
      try {
        const res = await cmdbApi.listTaxonomy(k)
        setNodes(res.list || [])
      } catch (e) {
        message.error('加载分类失败：' + e.message)
        setNodes([])
      } finally {
        setLoading(false)
      }
    },
    [activeKind],
  )

  useEffect(() => {
    if (open) {
      setActiveKind(kind)
      load(kind)
    }
    // 只跟随弹窗开关与外部传入的 kind。
    // 不能把 load 放进依赖：load 依赖 activeKind，一旦放进去，
    // 用户切到「分组 / 类型」页签后本副作用会立刻把 activeKind 重置回 kind，页签实际点不动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind])

  // 从侧栏「+」进入时直接弹出新增表单并预置上级；从侧栏「✎」进入时直接弹出编辑表单
  useEffect(() => {
    if (!open) return
    if (initialEdit) {
      setEditing(initialEdit)
      form.setFieldsValue({
        name: initialEdit.name,
        parent_id: initialEdit.parent_id || 0,
        sort_order: initialEdit.sort_order || 0,
      })
      setFormOpen(true)
      return
    }
    if (autoCreate) {
      setEditing(null)
      form.resetFields()
      form.setFieldsValue({ parent_id: presetParent || 0, sort_order: 0 })
      setFormOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoCreate, presetParent, initialEdit])

  const refreshAll = () => {
    load(activeKind)
    onChanged && onChanged()
  }

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ parent_id: 0, sort_order: 0 })
    setFormOpen(true)
  }

  const openEdit = (rec) => {
    setEditing(rec)
    form.setFieldsValue({
      name: rec.name,
      parent_id: rec.parent_id || 0,
      sort_order: rec.sort_order || 0,
    })
    setFormOpen(true)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      if (editing) {
        await cmdbApi.updateTaxonomy(activeKind, editing.id, values)
        message.success('已保存')
      } else {
        await cmdbApi.createTaxonomy(activeKind, values)
        message.success(`已新增${unit}`)
      }
      setFormOpen(false)
      refreshAll()
    } catch (e) {
      if (e?.errorFields) return
      message.error('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async (rec) => {
    try {
      await cmdbApi.deleteTaxonomy(activeKind, rec.id)
      message.success('已删除')
      refreshAll()
    } catch (e) {
      message.error(e.message)
    }
  }

  const parentOptions = () => {
    const exclude = editing ? [editing.id, ...collectDescendants(nodes, editing.id)] : []
    return [
      { value: 0, label: '（顶级）' },
      ...nodes
        .filter((n) => !exclude.includes(n.id))
        .map((n) => ({ value: n.id, label: n.name })),
    ]
  }

  const nameOf = (id) => {
    if (!id) return '（顶级）'
    const hit = nodes.find((n) => n.id === id)
    return hit ? hit.name : `#${id}`
  }

  const columns = [
    { title: '名称', dataIndex: 'name', width: 220 },
    { title: '上级', dataIndex: 'parent_id', width: 180, render: (v) => nameOf(v) },
    { title: '排序', dataIndex: 'sort_order', width: 80 },
    {
      title: '子节点',
      dataIndex: 'child_count',
      width: 90,
      render: (v) => (v > 0 ? <Tag>{v}</Tag> : '0'),
    },
    {
      title: '被引用资产',
      dataIndex: 'asset_count',
      width: 110,
      render: (v) => (v > 0 ? <Tag color="blue">{v}</Tag> : '0'),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, rec) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(rec)}>
            编辑
          </Button>
          <Popconfirm
            title={`确认删除该${unit}？`}
            description="有子节点或已被资产引用时会拒绝删除。"
            onConfirm={() => doDelete(rec)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const panel = (
    <>
      <div className="cmdb-toolbar">
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增{unit}
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => load(activeKind)}>
          刷新
        </Button>
        <Typography.Text type="secondary">
          共 {nodes.length} 个{unit}
        </Typography.Text>
      </div>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={nodes}
        scroll={{ x: 'max-content' }}
        pagination={false}
        locale={{ emptyText: `暂无${unit}，点击「新增${unit}」开始维护` }}
      />
    </>
  )

  return (
    <>
      <Modal
        title="分类管理"
        open={open}
        onCancel={onClose}
        footer={<Button onClick={onClose}>关闭</Button>}
        width={880}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          维护「组织 / 分组 / 类型」三个维度，它们会直接出现在左侧筛选面板和资产归属中。
          删除时若有子节点或已被资产引用，系统会拒绝并说明原因。
        </Typography.Paragraph>
        <Tabs
          activeKey={activeKind}
          onChange={(k) => {
            setActiveKind(k)
            load(k)
          }}
          items={KINDS.map((k) => ({ key: k.key, label: k.label, children: panel }))}
        />
      </Modal>

      <Modal
        title={editing ? `编辑${unit}` : `新增${unit}`}
        open={formOpen}
        onOk={submit}
        onCancel={() => setFormOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: `请输入${unit}名称` }]}
          >
            <Input placeholder={`如 ${unit}名称`} allowClear />
          </Form.Item>
          <Form.Item name="parent_id" label="上级">
            <Select options={parentOptions()} />
          </Form.Item>
          <Form.Item name="sort_order" label="排序（小的排前面）">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
