import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { cmdbApi } from './cmdbApi'

const TYPE_LABELS = { organization: '组织', department: '部门', group: '分组' }

function flattenTree(nodes, parentName = '', out = []) {
  for (const node of nodes || []) {
    out.push({ ...node, parentName })
    flattenTree(node.children, node.name, out)
  }
  return out
}

export default function OrgTreeConfig() {
  const [tree, setTree] = useState([])
  const [expandedRowKeys, setExpandedRowKeys] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [formSeed, setFormSeed] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const flatNodes = useMemo(() => flattenTree(tree), [tree])
  const nodeNameByID = useMemo(() => new Map(flatNodes.map((node) => [node.id, node.name])), [flatNodes])
  const nodeType = Form.useWatch('node_type', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await cmdbApi.getOrgTree()
      const nextTree = response.list || []
      setTree(nextTree)
      setExpandedRowKeys(flattenTree(nextTree).filter((node) => node.children?.length).map((node) => node.id))
    } catch (error) {
      message.error(`加载组织架构失败：${error.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!modalOpen || !formSeed) return
    form.resetFields()
    const { parent_id: parentID, ...mountedValues } = formSeed
    form.setFieldsValue(mountedValues)
    if (mountedValues.node_type === 'organization') form.setFieldValue('parent_id', parentID)
  }, [form, formSeed, modalOpen])

  useEffect(() => {
    if (!modalOpen || !formSeed || nodeType !== formSeed.node_type || nodeType === 'organization') return
    form.setFieldValue('parent_id', formSeed.parent_id)
  }, [form, formSeed, modalOpen, nodeType])

  const openForm = (record = null, defaults = {}) => {
    setEditing(record)
    setFormSeed(record ? {
      name: record.name,
      node_type: record.node_type,
      parent_id: record.parent_id,
      sort_order: record.sort_order,
    } : { node_type: 'organization', parent_id: 0, sort_order: 0, ...defaults })
    setModalOpen(true)
  }

  const parentOptions = useMemo(() => {
    if (nodeType === 'organization') return []
    const parentType = nodeType === 'group' ? 'department' : 'organization'
    return flatNodes
      .filter((node) => node.node_type === parentType && node.id !== editing?.id)
      .map((node) => ({ value: node.id, label: node.name }))
  }, [editing?.id, flatNodes, nodeType])

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const payload = { ...values, parent_id: values.node_type === 'organization' ? 0 : values.parent_id }
      if (editing) await cmdbApi.updateConfig('org-nodes', editing.id, payload)
      else await cmdbApi.createConfig('org-nodes', payload)
      message.success(editing ? '组织节点已更新' : '组织节点已新增')
      window.dispatchEvent(new CustomEvent('cmdb:directory-changed', { detail: { kind: 'org-nodes' } }))
      setModalOpen(false)
      load()
    } catch (error) {
      if (!error?.errorFields) message.error(`保存失败：${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (record) => {
    try {
      await cmdbApi.deleteConfig('org-nodes', record.id)
      message.success('组织节点已删除')
      window.dispatchEvent(new CustomEvent('cmdb:directory-changed', { detail: { kind: 'org-nodes' } }))
      load()
    } catch (error) {
      message.error(`删除失败：${error.message}`)
    }
  }

  const columns = [
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (name, record) => <Space><span>{name}</span><Tag>{TYPE_LABELS[record.node_type]}</Tag></Space>,
    },
    { title: '上级', key: 'parent', width: 180, render: (_, record) => nodeNameByID.get(record.parent_id) || '-' },
    { title: '排序', dataIndex: 'sort_order', width: 80 },
    {
      title: '操作', key: 'actions', width: 260,
      render: (_, record) => <Space size={4}>
        {record.node_type === 'organization' && <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => openForm(null, { node_type: 'department', parent_id: record.id })}>新增部门</Button>}
        {record.node_type === 'department' && <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => openForm(null, { node_type: 'group', parent_id: record.id })}>新增分组</Button>}
        <Button type="text" size="small" icon={<EditOutlined />} aria-label={`编辑${record.name}`} onClick={() => openForm(record)} />
        <Popconfirm title={`确认删除“${record.name}”？`} description="存在下级节点或人员引用时会拒绝删除。" onConfirm={() => remove(record)} okText="删除" cancelText="取消">
          <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`删除${record.name}`} />
        </Popconfirm>
      </Space>,
    },
  ]

  return <div className="cmdb-config-pane">
    <div className="cmdb-toolbar">
      <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>新增组织</Button>
      <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
      <Typography.Text type="secondary">组织、部门、分组按层级维护；人员只能选择这里已有的节点。</Typography.Text>
    </div>
    <Table
      rowKey="id"
      size="small"
      loading={loading}
      columns={columns}
      dataSource={tree}
      pagination={false}
      expandable={{ expandedRowKeys, onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]) }}
      locale={{ emptyText: '暂无组织架构，点击“新增组织”开始维护' }}
    />
    <Modal title={editing ? `编辑${TYPE_LABELS[editing.node_type]}` : `新增${TYPE_LABELS[nodeType] || '组织节点'}`} open={modalOpen} onOk={submit} onCancel={() => setModalOpen(false)} confirmLoading={saving} okText="保存" cancelText="取消" forceRender>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="node_type" label="节点类型" rules={[{ required: true }]}>
          <Select disabled={!!editing} options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} onChange={(value) => form.setFieldValue('parent_id', value === 'organization' ? 0 : undefined)} />
        </Form.Item>
        {nodeType !== 'organization' && <Form.Item name="parent_id" label="上级节点" rules={[{ required: true, message: '请选择上级节点' }]}>
          <Select showSearch optionFilterProp="label" options={parentOptions} placeholder={nodeType === 'group' ? '选择所属部门' : '选择所属组织'} />
        </Form.Item>}
        <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: '请输入节点名称' }]}><Input allowClear /></Form.Item>
        <Form.Item name="sort_order" label="排序"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
      </Form>
    </Modal>
  </div>
}
