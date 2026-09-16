// 本文件（资产盘点）已按用户要求从 CMDB 导航中移除，且未被任何文件引用，不参与 Vite 构建。
// 若需恢复，在 web/src/cmdb/CmdbLayout.jsx 的 CMDB_NAV 与 renderModule 中加回即可（同为 antd，可直接使用）。
import React, { useCallback, useEffect, useState } from 'react'
import {
  Table,
  Button,
  Input,
  Modal,
  Form,
  Select,
  DatePicker,
  InputNumber,
  Space,
  Popconfirm,
  message,
  Progress,
  Tag,
} from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { cmdbApi } from './cmdbApi'

const STATUSES = ['待执行', '执行中', '已完成', '已审核', '已关闭']
const STATUS_COLOR = {
  待执行: 'default',
  执行中: 'processing',
  已完成: 'success',
  已审核: 'cyan',
  已关闭: 'default',
}
const PAGE_SIZES = ['10', '20', '50', '100']

export default function CmdbInventory() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [status, setStatus] = useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await cmdbApi.listInventory({ page, page_size: pageSize, status, keyword })
      setRows(res.list || [])
      setTotal(res.total || 0)
    } catch (e) {
      message.error('加载盘点任务失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, status, keyword])

  useEffect(() => {
    load()
  }, [load])

  const openAdd = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ status: '待执行', progress: 0, abnormal: 0 })
    setModalOpen(true)
  }

  const openEdit = (rec) => {
    setEditing(rec)
    form.setFieldsValue({
      ...rec,
      deadline: rec.deadline ? dayjs(rec.deadline) : null,
    })
    setModalOpen(true)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const payload = {
        ...values,
        deadline: values.deadline ? values.deadline.format('YYYY-MM-DD') : '',
      }
      if (editing) {
        await cmdbApi.updateInventory(editing.id, payload)
        message.success('已保存')
      } else {
        await cmdbApi.createInventory(payload)
        message.success('已新建盘点计划')
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
    { title: '任务编号', dataIndex: 'task_no', width: 170, render: (v) => v || '-' },
    { title: '任务名称', dataIndex: 'name', width: 220 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v) => (v ? <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag> : '-'),
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 160,
      render: (v) => <Progress percent={Number(v) || 0} size="small" />,
    },
    {
      title: '异常',
      dataIndex: 'abnormal',
      width: 90,
      render: (v) => (Number(v) > 0 ? <Tag color="error">{v}</Tag> : '0'),
    },
    { title: '截止', dataIndex: 'deadline', width: 120, render: (v) => v || '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 170, render: (v) => v || '-' },
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
            title="确认删除该盘点任务？"
            onConfirm={async () => {
              try {
                await cmdbApi.deleteInventory(rec.id)
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
      <div className="cmdb-toolbar">
        <Select
          allowClear
          style={{ width: 150 }}
          placeholder="全部状态"
          value={status || undefined}
          onChange={(v) => {
            setStatus(v || '')
            setPage(1)
          }}
          options={STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <Input
          allowClear
          style={{ width: 240 }}
          placeholder="搜索任务编号或名称"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onPressEnter={() => {
            setPage(1)
            setKeyword(keywordInput.trim())
          }}
        />
        <Button
          icon={<SearchOutlined />}
          onClick={() => {
            setPage(1)
            setKeyword(keywordInput.trim())
          }}
        >
          查询
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          新建盘点计划
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
        locale={{ emptyText: '暂无盘点任务' }}
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
        title={editing ? '编辑盘点任务' : '新建盘点计划'}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '任务名称不能为空' }]}>
            <Input placeholder="如 2026 年三季度资产盘点" allowClear />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={STATUSES.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="progress" label="进度（%）">
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="abnormal" label="异常数">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="deadline" label="截止日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="盘点范围、负责人等" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
