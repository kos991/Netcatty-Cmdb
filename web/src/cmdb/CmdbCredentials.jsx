import React, { useCallback, useEffect, useState } from 'react'
import {
  Table,
  Button,
  Input,
  Modal,
  Form,
  Select,
  Space,
  Popconfirm,
  message,
  Typography,
  Alert,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { cmdbApi } from './cmdbApi'

// 实测类型白名单
const CRED_TYPES = ['SSH', 'Telnet', 'SNMPv2c', 'SNMPv3', 'API Token', 'RDP (远程桌面)', 'IPMI (带外)']
const PAGE_SIZES = ['10', '20', '50', '100']

export default function CmdbCredentials() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [credType, setCredType] = useState('')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assets, setAssets] = useState([])
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await cmdbApi.listCredentials({ page, page_size: pageSize, cred_type: credType, keyword })
      setRows(res.list || [])
      setTotal(res.total || 0)
    } catch (e) {
      message.error('加载凭证失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, credType, keyword])

  useEffect(() => {
    load()
  }, [load])

  // 关联资产下拉：取资源列表的前 500 条
  useEffect(() => {
    cmdbApi
      .listAssets({ page: 1, page_size: 500 })
      .then((r) => setAssets(r.list || []))
      .catch(() => setAssets([]))
  }, [])

  const openAdd = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (rec) => {
    setEditing(rec)
    form.setFieldsValue({ ...rec, asset_id: rec.asset_id || undefined })
    setModalOpen(true)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const payload = { ...values, asset_id: values.asset_id || 0 }
      if (editing) {
        await cmdbApi.updateCredential(editing.id, payload)
        message.success('已保存')
      } else {
        await cmdbApi.createCredential(payload)
        message.success('已新增凭证')
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

  const columns = [
    {
      title: '序号',
      key: 'index',
      width: 80,
      render: (_, __, i) => (page - 1) * pageSize + i + 1,
    },
    { title: '名称', dataIndex: 'name', width: 200 },
    {
      title: '类型',
      dataIndex: 'cred_type',
      width: 140,
      render: (v) => v || '-',
    },
    { title: '描述', dataIndex: 'description', width: 240, render: (v) => v || '-' },
    { title: '关联资产', dataIndex: 'asset_name', width: 180, render: (v) => v || '-' },
    { title: '更新时间', dataIndex: 'updated_at', width: 170, render: (v) => v || '-' },
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
            title="确认删除该凭证？"
            onConfirm={async () => {
              try {
                await cmdbApi.deleteCredential(rec.id)
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

  return (
    <div>
      <Alert
        style={{ marginBottom: 12 }}
        type="info"
        showIcon
        message="本模块只登记凭证的名称、类型、描述与关联资产，不存储明文口令。"
      />

      <div className="cmdb-toolbar">
        <Select
          allowClear
          style={{ width: 170 }}
          placeholder="全部类型"
          value={credType || undefined}
          onChange={(v) => {
            setCredType(v || '')
            setPage(1)
          }}
          options={CRED_TYPES.map((t) => ({ value: t, label: t }))}
        />
        <Input.Search
          allowClear
          placeholder="搜索名称或描述"
          style={{ width: 260 }}
          onSearch={(v) => {
            setPage(1)
            setKeyword(v.trim())
          }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          新增凭证
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
        locale={{ emptyText: '暂无凭证数据' }}
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

      <Modal
        title={editing ? '编辑凭证' : '新增凭证'}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '凭证名称不能为空' }]}>
            <Input placeholder="如 核心交换机 SSH 只读" allowClear />
          </Form.Item>
          <Form.Item name="cred_type" label="类型">
            <Select
              allowClear
              placeholder="请选择类型"
              options={CRED_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="用途、权限范围等" />
          </Form.Item>
          <Form.Item name="asset_id" label="关联资产">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="可不关联"
              options={assets.map((a) => ({ value: a.id, label: `${a.name}（${a.asset_code || '-'}）` }))}
            />
          </Form.Item>
        </Form>
        <Typography.Text type="secondary">出于安全考虑，本模块不接收、不存储口令明文。</Typography.Text>
      </Modal>
    </div>
  )
}
