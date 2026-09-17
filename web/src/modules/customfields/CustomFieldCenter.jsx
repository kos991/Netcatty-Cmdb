import React, { useEffect, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Input,
  Select,
  Switch,
  Tag,
  Space,
  Modal,
  Form,
  Row,
  Col,
  message,
  Popconfirm,
  Typography,
  Alert,
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  SlidersOutlined,
} from '@ant-design/icons'
import { cmdbApi } from '../../cmdb/cmdbApi'

const { Text } = Typography

const FIELD_TYPES = [
  { value: 'text', label: '单行文本 (Text)' },
  { value: 'number', label: '数值 (Number)' },
  { value: 'select', label: '下拉单选 (Select)' },
  { value: 'date', label: '日期 (Date)' },
  { value: 'boolean', label: '布尔开关 (Boolean)' },
]

const ASSET_CLASSES = [
  { value: 'all', label: '全部资产类型通用' },
  { value: 'physical', label: '仅基础设施' },
  { value: 'virtual', label: '仅虚拟机' },
  { value: 'desktop', label: '仅终端资产' },
  { value: 'network', label: '仅网络与安全设备' },
]

export default function CustomFieldCenter({ embedded = false }) {
  const [loading, setLoading] = useState(false)
  const [fields, setFields] = useState([])
  const [modalVisible, setModalVisible] = useState(false)
  const [editingField, setEditingField] = useState(null)
  const [fieldType, setFieldType] = useState('text')
  const [options, setOptions] = useState([])
  const [newOptionInput, setNewOptionInput] = useState('')
  const [form] = Form.useForm()

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await cmdbApi.listCustomFields()
      setFields(res.list || [])
    } catch (err) {
      message.error(`加载自定义字段失败: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleOpenModal = (record = null) => {
    setEditingField(record)
    if (record) {
      setFieldType(record.field_type)
      setOptions(record.options || [])
      form.setFieldsValue({
        field_key: record.field_key,
        field_name: record.field_name,
        field_type: record.field_type,
        asset_class: record.asset_class || 'all',
        required: record.required === 1,
        show_in_list: record.show_in_list === 1,
        export_excel: record.export_excel === 1,
      })
    } else {
      setFieldType('text')
      setOptions([])
      form.resetFields()
      form.setFieldsValue({
        field_type: 'text',
        asset_class: 'all',
        required: false,
        show_in_list: true,
        export_excel: true,
      })
    }
    setModalVisible(true)
  }

  const handleAddOption = () => {
    if (!newOptionInput.trim()) return
    if (options.includes(newOptionInput.trim())) {
      message.warning('该选项已存在')
      return
    }
    setOptions([...options, newOptionInput.trim()])
    setNewOptionInput('')
  }

  const handleRemoveOption = (opt) => {
    setOptions(options.filter((o) => o !== opt))
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const payload = {
        ...values,
        id: editingField?.id,
        required: values.required ? 1 : 0,
        show_in_list: values.show_in_list ? 1 : 0,
        export_excel: values.export_excel ? 1 : 0,
        options: fieldType === 'select' ? options : [],
      }

      if (fieldType === 'select' && options.length === 0) {
        message.warning('下拉单选字段必须至少添加一个候选项')
        return
      }

      await cmdbApi.saveCustomField(payload)
      message.success(editingField ? '更新字段配置成功' : '新增自定义字段成功')
      setModalVisible(false)
      loadData()
    } catch (err) {
      if (err.errorFields) return
      message.error(`保存失败: ${err.message}`)
    }
  }

  const handleDelete = async (id) => {
    try {
      await cmdbApi.deleteCustomField(id)
      message.success('已删除自定义字段')
      loadData()
    } catch (err) {
      message.error(`删除失败: ${err.message}`)
    }
  }

  const columns = [
    {
      title: '字段标识 (Key)',
      dataIndex: 'field_key',
      key: 'field_key',
      render: (t) => <code>{t}</code>,
    },
    {
      title: '显示名称',
      dataIndex: 'field_name',
      key: 'field_name',
      render: (t) => <Text strong>{t}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'field_type',
      key: 'field_type',
      render: (t) => {
        const item = FIELD_TYPES.find((f) => f.value === t)
        return <Tag color="blue">{item ? item.label : t}</Tag>
      },
    },
    {
      title: '适用范围',
      dataIndex: 'asset_class',
      key: 'asset_class',
      render: (c) => {
        const item = ASSET_CLASSES.find((a) => a.value === c)
        return <Tag color="cyan">{item ? item.label : '全部通用'}</Tag>
      },
    },
    {
      title: '下拉候选项',
      dataIndex: 'options',
      key: 'options',
      render: (opts) =>
        opts && opts.length > 0 ? (
          <Space size={2} wrap>
            {opts.map((o) => (
              <Tag key={o}>{o}</Tag>
            ))}
          </Space>
        ) : (
          <span style={{ color: '#bfbfbf' }}>-</span>
        ),
    },
    {
      title: '是否必填',
      dataIndex: 'required',
      key: 'required',
      render: (v) => (
        <Tag color={v === 1 ? 'red' : 'default'}>{v === 1 ? '必填' : '选填'}</Tag>
      ),
    },
    {
      title: '列表列显示',
      dataIndex: 'show_in_list',
      key: 'show_in_list',
      render: (v) => (
        <Tag color={v === 1 ? 'green' : 'default'}>{v === 1 ? '显示' : '隐藏'}</Tag>
      ),
    },
    {
      title: '导出 Excel 列',
      dataIndex: 'export_excel',
      key: 'export_excel',
      render: (v) => (
        <Tag color={v === 1 ? 'purple' : 'default'}>{v === 1 ? '导出' : '不导出'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_, r) => (
        <Space size="small">
          <Button
            type="text"
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleOpenModal(r)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该自定义字段？"
            description="删除后将不再在资产表单中展示，历史录入数据仍保留在 JSON 中。"
            onConfirm={() => handleDelete(r.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={embedded ? undefined : { padding: '16px 20px', background: '#f8fafc', minHeight: 'calc(100vh - 64px)' }}>
      {!embedded && <Alert
        type="info"
        showIcon
        message="无代码动态自定义字段配置"
        description="您可以根据单位特定管理需求（如安全等保级别、合同编号、质保服务商等），在此自由新增和扩展资产字段。配置后，资产录入表单、资产详情抽屉和资产大表格将自动动态生效。"
        style={{ marginBottom: 16 }}
      />}

      <Card
        title={
          <Space>
            <SlidersOutlined />
            <span>自定义扩展属性列表 ({fields.length})</span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadData}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => handleOpenModal()}
            >
              新增自定义字段
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          dataSource={fields}
          columns={columns}
          pagination={false}
          size="middle"
        />
      </Card>

      <Modal
        title={editingField ? '编辑自定义字段' : '新增自定义字段'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="field_key"
                label="字段英文标识 (Key)"
                rules={[
                  { required: true, message: '请输入英文标识' },
                  { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: '仅支持字母开头，可包含字母数字下划线' },
                ]}
              >
                <Input
                  placeholder="例如：env_type, contract_no"
                  disabled={!!editingField}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="field_name"
                label="字段显示名称"
                rules={[{ required: true, message: '请输入显示名称' }]}
              >
                <Input placeholder="例如：运行环境、合同编号" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="field_type"
                label="字段数据类型"
                rules={[{ required: true }]}
              >
                <Select
                  options={FIELD_TYPES}
                  onChange={(val) => setFieldType(val)}
                  disabled={!!editingField}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="asset_class"
                label="适用资产大类"
                rules={[{ required: true }]}
              >
                <Select options={ASSET_CLASSES} />
              </Form.Item>
            </Col>
          </Row>

          {fieldType === 'select' && (
            <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 6 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                下拉选项列表 (Options)
              </Text>
              <Space style={{ marginBottom: 8 }}>
                <Input
                  placeholder="输入选项名称"
                  value={newOptionInput}
                  onChange={(e) => setNewOptionInput(e.target.value)}
                  onPressEnter={handleAddOption}
                />
                <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddOption}>
                  添加选项
                </Button>
              </Space>
              <div>
                {options.map((opt) => (
                  <Tag
                    key={opt}
                    closable
                    onClose={() => handleRemoveOption(opt)}
                    style={{ marginBottom: 4 }}
                  >
                    {opt}
                  </Tag>
                ))}
              </div>
            </div>
          )}

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="required" label="必填属性" valuePropName="checked">
                <Switch checkedChildren="必填" unCheckedChildren="选填" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="show_in_list" label="列表默认显示" valuePropName="checked">
                <Switch checkedChildren="显示" unCheckedChildren="隐藏" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="export_excel" label="导出独立列" valuePropName="checked">
                <Switch checkedChildren="导出" unCheckedChildren="不导" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
