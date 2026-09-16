import React, { useCallback, useEffect, useState } from 'react'
import {
  Table,
  Button,
  Input,
  Modal,
  Form,
  Select,
  DatePicker,
  Space,
  Popconfirm,
  message,
  Tag,
} from 'antd'
import { PlusOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { cmdbApi } from './cmdbApi'

// 全部取值来自实测证据 cmdb-workorders.json 的下拉选项
const BIZ_TYPES = ['故障处理', '服务请求', '变更操作', '日常巡检', '例行维护']
const STATUSES = ['新建', '已分配', '处理中', '已解决', '已关闭', '已取消']
const RESULTS = ['处理成功', '临时规避', '未发现异常', '未解决', '已升级处理', '需二次维护']
const PRIORITIES = ['高', '中', '低']
const PRIORITY_COLOR = { 高: 'error', 中: 'warning', 低: 'default' }
const STATUS_COLOR = {
  新建: 'default',
  已分配: 'processing',
  处理中: 'processing',
  已解决: 'success',
  已关闭: 'default',
  已取消: 'default',
}
const PAGE_SIZES = ['10', '20', '50', '100']

const DT_FMT = 'YYYY-MM-DD HH:mm'

function toCsv(columns, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = columns.map((c) => esc(c.title)).join(',')
  const body = rows
    .map((r) => columns.map((c) => esc(typeof c.exportValue === 'function' ? c.exportValue(r) : r[c.dataIndex])).join(','))
    .join('\r\n')
  return '\uFEFF' + head + '\r\n' + body
}

export default function CmdbWorkOrders() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [filters, setFilters] = useState({
    biz_type: '',
    status: '',
    result: '',
    owner: '',
    maintainer: '',
    keyword: '',
  })
  const [keywordInput, setKeywordInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await cmdbApi.listWorkOrders({ page, page_size: pageSize, ...filters })
      setRows(res.list || [])
      setTotal(res.total || 0)
    } catch (e) {
      message.error('加载工单失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filters])

  useEffect(() => {
    load()
  }, [load])

  const setFilter = (key, value) => {
    setPage(1)
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const openAdd = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ status: '新建', priority: '中' })
    setModalOpen(true)
  }

  const openEdit = (rec) => {
    setEditing(rec)
    form.setFieldsValue({
      ...rec,
      plan_time: rec.plan_time ? dayjs(rec.plan_time) : null,
      actual_time: rec.actual_time ? dayjs(rec.actual_time) : null,
    })
    setModalOpen(true)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const payload = {
        ...values,
        plan_time: values.plan_time ? values.plan_time.format(DT_FMT) : '',
        actual_time: values.actual_time ? values.actual_time.format(DT_FMT) : '',
      }
      if (editing) {
        await cmdbApi.updateWorkOrder(editing.id, { ...editing, ...payload })
        message.success('已保存')
      } else {
        await cmdbApi.createWorkOrder(payload)
        message.success('已新增工单')
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

  // 导出当前筛选条件下的全部记录（不受当前页限制）
  const exportExcel = async () => {
    try {
      const res = await cmdbApi.listWorkOrders({ page: 1, page_size: 500, ...filters })
      const list = res.list || []
      if (list.length === 0) {
        message.info('当前筛选条件下没有可导出的工单')
        return
      }
      const csv = toCsv(
        [
          { title: '工单号', dataIndex: 'order_no' },
          { title: '优先级', dataIndex: 'priority' },
          { title: '维护主题', dataIndex: 'subject' },
          { title: '维护类型', dataIndex: 'biz_type' },
          { title: '维护状态', dataIndex: 'status' },
          { title: '计划维护时间', dataIndex: 'plan_time' },
          { title: '实际时间', dataIndex: 'actual_time' },
          { title: '维护结果', dataIndex: 'result' },
          { title: '负责人', dataIndex: 'owner' },
          { title: '维护人员', dataIndex: 'maintainer' },
          { title: '备注', dataIndex: 'remark' },
        ],
        list,
      )
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `工单管理_${dayjs().format('YYYYMMDD_HHmmss')}.csv`
      a.click()
      URL.revokeObjectURL(url)
      message.success(`已导出 ${list.length} 条工单`)
    } catch (e) {
      message.error('导出失败：' + e.message)
    }
  }

  const columns = [
    { title: '工单号', dataIndex: 'order_no', width: 170, render: (v) => v || '-' },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 90,
      render: (v) => (v ? <Tag color={PRIORITY_COLOR[v] || 'default'}>{v}</Tag> : '-'),
    },
    { title: '维护主题', dataIndex: 'subject', width: 220 },
    { title: '维护类型', dataIndex: 'biz_type', width: 120, render: (v) => v || '-' },
    {
      title: '维护状态',
      dataIndex: 'status',
      width: 110,
      render: (v) => (v ? <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag> : '-'),
    },
    { title: '计划维护时间', dataIndex: 'plan_time', width: 160, render: (v) => v || '-' },
    { title: '实际时间', dataIndex: 'actual_time', width: 160, render: (v) => v || '-' },
    { title: '维护结果', dataIndex: 'result', width: 130, render: (v) => v || '-' },
    { title: '负责人', dataIndex: 'owner', width: 110, render: (v) => v || '-' },
    { title: '维护人员', dataIndex: 'maintainer', width: 110, render: (v) => v || '-' },
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
            title="确认删除该工单？"
            onConfirm={async () => {
              try {
                await cmdbApi.deleteWorkOrder(rec.id)
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
          style={{ width: 130 }}
          placeholder="所有类型"
          value={filters.biz_type || undefined}
          onChange={(v) => setFilter('biz_type', v || '')}
          options={BIZ_TYPES.map((v) => ({ value: v, label: v }))}
        />
        <Select
          allowClear
          style={{ width: 130 }}
          placeholder="所有状态"
          value={filters.status || undefined}
          onChange={(v) => setFilter('status', v || '')}
          options={STATUSES.map((v) => ({ value: v, label: v }))}
        />
        <Select
          allowClear
          style={{ width: 150 }}
          placeholder="所有结果"
          value={filters.result || undefined}
          onChange={(v) => setFilter('result', v || '')}
          options={RESULTS.map((v) => ({ value: v, label: v }))}
        />
        <Input
          allowClear
          style={{ width: 130 }}
          placeholder="负责人"
          value={filters.owner}
          onChange={(e) => setFilter('owner', e.target.value)}
        />
        <Input
          allowClear
          style={{ width: 130 }}
          placeholder="维护人员"
          value={filters.maintainer}
          onChange={(e) => setFilter('maintainer', e.target.value)}
        />
        <Input
          allowClear
          style={{ width: 200 }}
          placeholder="搜索主题 / 工单号"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onPressEnter={() => setFilter('keyword', keywordInput.trim())}
        />
        <Button onClick={() => setFilter('keyword', keywordInput.trim())}>查询</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          新增工单
        </Button>
        <Button icon={<DownloadOutlined />} onClick={exportExcel}>
          导出Excel
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
        locale={{ emptyText: '暂无工单记录' }}
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
        title={editing ? '编辑工单' : '新增工单'}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="subject" label="维护主题" rules={[{ required: true, message: '维护主题不能为空' }]}>
            <Input placeholder="如 更换 302 室云桌面盒子" allowClear />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <Select options={PRIORITIES.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="biz_type" label="维护类型">
            <Select allowClear options={BIZ_TYPES.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="status" label="维护状态">
            <Select options={STATUSES.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="plan_time" label="计划维护时间">
            <DatePicker showTime format={DT_FMT} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="actual_time" label="实际时间">
            <DatePicker showTime format={DT_FMT} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="result" label="维护结果">
            <Select allowClear options={RESULTS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="owner" label="负责人">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="maintainer" label="维护人员">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
