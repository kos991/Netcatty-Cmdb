import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { cmdbApi } from './cmdbApi'

const SCHEMAS = {
  'device-types': { unit: '设备类型', hierarchical: true },
  software: { unit: '软件', software: true },
  locations: { unit: '位置' },
  statuses: { unit: '状态' },
}

function collectDescendants(items, id, result = new Set()) {
  for (const item of items) {
    if (item.parent_id === id) {
      result.add(item.id)
      collectDescendants(items, item.id, result)
    }
  }
  return result
}

export default function ConfigCatalogPane({ kind }) {
  const schema = SCHEMAS[kind]
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [formSeed, setFormSeed] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await cmdbApi.listConfig(kind)
      setItems(response.list || [])
    } catch (error) {
      message.error(`加载${schema.unit}失败：${error.message}`)
    } finally {
      setLoading(false)
    }
  }, [kind, schema.unit])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!modalOpen || !formSeed) return
    form.resetFields()
    form.setFieldsValue(formSeed)
  }, [form, formSeed, modalOpen])

  const openForm = (record = null) => {
    setEditing(record)
    setFormSeed(record || { parent_id: 0, sort_order: 0 })
    setModalOpen(true)
  }

  const parentOptions = useMemo(() => {
    const excluded = editing ? collectDescendants(items, editing.id) : new Set()
    if (editing) excluded.add(editing.id)
    return [{ value: 0, label: '顶级类型' }, ...items.filter((item) => !excluded.has(item.id)).map((item) => ({ value: item.id, label: item.name }))]
  }, [editing, items])

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      if (editing) await cmdbApi.updateConfig(kind, editing.id, values)
      else await cmdbApi.createConfig(kind, values)
      message.success(editing ? `${schema.unit}已更新` : `${schema.unit}已新增`)
      window.dispatchEvent(new CustomEvent('cmdb:directory-changed', { detail: { kind } }))
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
      await cmdbApi.deleteConfig(kind, record.id)
      message.success(`${schema.unit}已删除`)
      window.dispatchEvent(new CustomEvent('cmdb:directory-changed', { detail: { kind } }))
      load()
    } catch (error) {
      message.error(`删除失败：${error.message}`)
    }
  }

  const nameOf = (id) => items.find((item) => item.id === id)?.name || '-'
  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    ...(schema.software ? [
      { title: '厂商', dataIndex: 'vendor', key: 'vendor', render: (value) => value || '-' },
      { title: '版本', dataIndex: 'version', key: 'version', render: (value) => value || '-' },
    ] : []),
    ...(schema.hierarchical ? [{ title: '上级', dataIndex: 'parent_id', key: 'parent_id', render: nameOf }] : []),
    { title: '备注', dataIndex: 'remark', key: 'remark', render: (value) => value || '-' },
    { title: '排序', dataIndex: 'sort_order', key: 'sort_order', width: 80 },
    {
      title: '操作', key: 'actions', width: 110,
      render: (_, record) => <Space size={4}>
        <Button type="text" size="small" icon={<EditOutlined />} aria-label={`编辑${record.name}`} onClick={() => openForm(record)} />
        <Popconfirm title={`确认删除“${record.name}”？`} description="已被业务数据引用时会拒绝删除。" onConfirm={() => remove(record)} okText="删除" cancelText="取消">
          <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`删除${record.name}`} />
        </Popconfirm>
      </Space>,
    },
  ]

  return <div className="cmdb-config-pane">
    <div className="cmdb-toolbar">
      <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>新增{schema.unit}</Button>
      <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
      <Typography.Text type="secondary">共 {items.length} 条</Typography.Text>
    </div>
    <Table rowKey="id" size="small" loading={loading} columns={columns} dataSource={items} pagination={false} scroll={{ x: 'max-content' }} locale={{ emptyText: `暂无${schema.unit}，点击“新增${schema.unit}”开始维护` }} />
    <Modal title={editing ? `编辑${schema.unit}` : `新增${schema.unit}`} open={modalOpen} onOk={submit} onCancel={() => setModalOpen(false)} confirmLoading={saving} okText="保存" cancelText="取消" forceRender>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: `请输入${schema.unit}名称` }]}><Input allowClear /></Form.Item>
        {schema.software && <>
          <Form.Item name="vendor" label="厂商"><Input allowClear /></Form.Item>
          <Form.Item name="version" label="版本"><Input allowClear /></Form.Item>
        </>}
        {schema.hierarchical && <Form.Item name="parent_id" label="上级类型"><Select showSearch optionFilterProp="label" options={parentOptions} /></Form.Item>}
        <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="sort_order" label="排序"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
      </Form>
    </Modal>
  </div>
}
