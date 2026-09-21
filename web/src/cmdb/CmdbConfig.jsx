import React, { useCallback, useEffect, useState } from 'react'
import {
  Table,
  Button,
  Input,
  Modal,
  Form,
  InputNumber,
  Space,
  Popconfirm,
  message,
  Tabs,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined, ImportOutlined } from '@ant-design/icons'
import { cmdbApi } from './cmdbApi'
import ConfigCatalogPane from './ConfigCatalogPane'
import CustomFieldCenter from '../modules/customfields/CustomFieldCenter'

const PAGE_SIZES = ['10', '20', '50', '100']

// 批量导入格式：厂商,型号,高度(U),额定功耗(W),最大功耗(W),重量(KG),深度(mm)
function parseImportText(text) {
  const rows = []
  const errors = []
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .forEach((line, idx) => {
      if (!line) return
      const parts = line.split(/[,，\t]/).map((s) => s.trim())
      if (parts.length < 2 || !parts[1]) {
        errors.push(`第 ${idx + 1} 行：型号不能为空`)
        return
      }
      const num = (i) => {
        const v = Number(parts[i])
        return Number.isFinite(v) ? v : 0
      }
      rows.push({
        vendor: parts[0] || '',
        model: parts[1],
        height_u: num(2) || 1,
        rated_power_w: num(3),
        max_power_w: num(4),
        weight_kg: num(5),
        depth_mm: num(6),
      })
    })
  return { rows, errors }
}

export default function CmdbConfig() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [formSeed, setFormSeed] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await cmdbApi.listModels({ page, page_size: pageSize, keyword })
      setRows(res.list || [])
      setTotal(res.total || 0)
    } catch (e) {
      message.error('加载设备模型失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, keyword])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!modalOpen || !formSeed) return
    form.resetFields()
    form.setFieldsValue(formSeed)
  }, [form, formSeed, modalOpen])

  const openAdd = () => {
    setEditing(null)
    setFormSeed({ height_u: 1 })
    setModalOpen(true)
  }

  const openEdit = (rec) => {
    setEditing(rec)
    setFormSeed(rec)
    setModalOpen(true)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      if (editing) {
        await cmdbApi.updateModel(editing.id, values)
        message.success('已保存')
      } else {
        await cmdbApi.createModel(values)
        message.success('已新增模型')
      }
      setModalOpen(false)
      load()
    } catch (e) {
      if (e?.errorFields) return
      message.error('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const doImport = async () => {
    const { rows: parsed, errors } = parseImportText(importText)
    if (parsed.length === 0) {
      message.error(errors.length ? errors[0] : '没有可导入的数据')
      return
    }
    setSaving(true)
    let ok = 0
    const failed = []
    for (const item of parsed) {
      try {
        await cmdbApi.createModel(item)
        ok++
      } catch (e) {
        failed.push(`${item.vendor} ${item.model}：${e.message}`)
      }
    }
    setSaving(false)
    setImportOpen(false)
    setImportText('')
    load()
    if (failed.length === 0) {
      message.success(`批量导入完成，成功 ${ok} 条`)
    } else {
      Modal.info({
        title: `批量导入完成：成功 ${ok} 条，失败 ${failed.length} 条`,
        content: (
          <div style={{ maxHeight: 240, overflow: 'auto' }}>
            {failed.map((f) => (
              <div key={f}>{f}</div>
            ))}
          </div>
        ),
      })
    }
  }

  const columns = [
    { title: '厂商', dataIndex: 'vendor', width: 140, render: (v) => v || '-' },
    { title: '型号', dataIndex: 'model', width: 180, render: (v) => v || '-' },
    { title: '高度(U)', dataIndex: 'height_u', width: 100 },
    { title: '额定功耗(W)', dataIndex: 'rated_power_w', width: 120 },
    { title: '最大功耗(W)', dataIndex: 'max_power_w', width: 120 },
    { title: '重量(KG)', dataIndex: 'weight_kg', width: 110 },
    { title: '深度', dataIndex: 'depth_mm', width: 100 },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_, rec) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(rec)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该模型？"
            onConfirm={async () => {
              try {
                await cmdbApi.deleteModel(rec.id)
                message.success('已删除')
                load()
              } catch (e) {
                message.error('删除失败：' + e.message)
              }
            }}
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

  const modelLibrary = (
    <>
      <div className="cmdb-toolbar">
        <Input.Search
          allowClear
          placeholder="搜索厂商或型号"
          style={{ width: 260 }}
          onSearch={(v) => {
            setPage(1)
            setKeyword(v.trim())
          }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          新增模型
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
          批量导入
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
      </div>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES,
          showTotal: (t) => `共 ${t} 条记录`,
          onChange: (p, ps) => {
            setPage(p)
            if (ps && ps !== pageSize) setPageSize(ps)
          },
        }}
      />
      {total === 0 && !loading ? (
        <Typography.Text type="secondary">暂无设备模型数据</Typography.Text>
      ) : null}
    </>
  )

  return (
    <div className="cmdb-config-center">
      <div className="cmdb-page-heading"><h2>配置中心</h2></div>
      <Tabs
        items={[
          { key: 'device-types', label: '设备类型', children: <ConfigCatalogPane kind="device-types" /> },
          { key: 'software', label: '软件目录', children: <ConfigCatalogPane kind="software" /> },
          { key: 'locations', label: '位置目录', children: <ConfigCatalogPane kind="locations" /> },
          { key: 'statuses', label: '状态配置', children: <ConfigCatalogPane kind="statuses" /> },
          { key: 'models', label: '厂商与型号', children: modelLibrary },
          { key: 'custom-fields', label: '自定义字段', children: <CustomFieldCenter embedded /> },
        ]}
      />

      <Modal
        title={editing ? '编辑设备模型' : '新增设备模型'}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="vendor" label="厂商">
            <Input placeholder="如 浪潮" allowClear />
          </Form.Item>
          <Form.Item name="model" label="型号" rules={[{ required: true, message: '型号不能为空' }]}>
            <Input placeholder="如 NF5280M6" allowClear />
          </Form.Item>
          <Form.Item name="height_u" label="高度(U)">
            <InputNumber min={1} max={60} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="rated_power_w" label="额定功耗(W)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="max_power_w" label="最大功耗(W)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="weight_kg" label="重量(KG)">
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="depth_mm" label="深度(mm)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量导入设备模型"
        open={importOpen}
        onOk={doImport}
        onCancel={() => setImportOpen(false)}
        confirmLoading={saving}
        okText="开始导入"
        cancelText="取消"
        width={640}
      >
        <Typography.Paragraph type="secondary">
          每行一条，用逗号分隔：厂商,型号,高度(U),额定功耗(W),最大功耗(W),重量(KG),深度(mm)。
          型号必填，数字留空按 0 处理。
        </Typography.Paragraph>
        <Input.TextArea
          rows={10}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={'浪潮,NF5280M6,2,800,1200,25,750\n华为,2288H V5,2,750,1100,23,748'}
        />
      </Modal>
    </div>
  )
}
