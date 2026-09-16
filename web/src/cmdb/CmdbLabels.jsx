import React, { useCallback, useEffect, useState } from 'react'
import {
  Table,
  Button,
  Input,
  Modal,
  Space,
  Popconfirm,
  message,
  Tag,
  Tabs,
  Descriptions,
  Typography,
  Form,
} from 'antd'
import {
  ReloadOutlined,
  BarcodeOutlined,
  SettingOutlined,
  PrinterOutlined,
  ToolOutlined,
  QrcodeOutlined,
} from '@ant-design/icons'
import { cmdbApi } from './cmdbApi'

const TABS = ['全部', '使用中', '孤儿', '已归档']
const STATUS_COLOR = { 使用中: 'success', 孤儿: 'warning', 已归档: 'default' }
const PAGE_SIZES = ['10', '20', '50', '100']

export default function CmdbLabels() {
  const [tab, setTab] = useState('全部')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [orphanCount, setOrphanCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])

  const [scanOpen, setScanOpen] = useState(false)
  const [scanValue, setScanValue] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [printed, setPrinted] = useState([])
  const [busy, setBusy] = useState(false)
  const [ruleForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await cmdbApi.listLabels({ tab, keyword, page, page_size: pageSize })
      setRows(res.list || [])
      setTotal(res.total || 0)
      setOrphanCount(res.orphan_count || 0)
    } catch (e) {
      message.error('加载编码失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [tab, keyword, page, pageSize])

  useEffect(() => {
    load()
  }, [load])

  const afterMutate = () => {
    setSelectedIds([])
    load()
  }

  const doGenerate = async () => {
    setBusy(true)
    try {
      const res = await cmdbApi.generateLabels()
      if (res.generated === 0) {
        message.info('所有资产都已有编码，无需生成')
      } else {
        message.success(`已为 ${res.generated} 条资产生成编码`)
      }
      afterMutate()
    } catch (e) {
      message.error('生成编码失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const doRepair = async () => {
    setBusy(true)
    try {
      const res = await cmdbApi.repairLabels()
      message.success(`已处理 ${res.handled} 条孤儿编码（可关联的已回填，无法关联的转为已归档）`)
      afterMutate()
    } catch (e) {
      message.error('修复孤儿编码失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const doPrint = async () => {
    if (selectedIds.length === 0) {
      message.info('请先勾选要打印的编码')
      return
    }
    setBusy(true)
    try {
      const res = await cmdbApi.printLabels(selectedIds)
      message.success(`已记录打印 ${res.printed} 条，批次 ${res.batch}`)
      afterMutate()
    } catch (e) {
      message.error('批量打印失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const openRule = async () => {
    try {
      const r = await cmdbApi.getLabelRule()
      ruleForm.setFieldsValue({ prefix: r.prefix })
    } catch (_) {
      ruleForm.setFieldsValue({ prefix: 'ZC' })
    }
    setRuleOpen(true)
  }

  const saveRule = async () => {
    try {
      const values = await ruleForm.validateFields()
      await cmdbApi.saveLabelRule(values.prefix)
      message.success('编码规则已保存')
      setRuleOpen(false)
    } catch (e) {
      if (e?.errorFields) return
      message.error('保存规则失败：' + e.message)
    }
  }

  const openAudit = async () => {
    setAuditOpen(true)
    try {
      const res = await cmdbApi.listPrintedLabels()
      setPrinted(res.list || [])
    } catch (e) {
      message.error('加载打印审计失败：' + e.message)
      setPrinted([])
    }
  }

  const doScan = async () => {
    const code = scanValue.trim()
    if (!code) {
      message.info('请输入或扫描编码')
      return
    }
    setBusy(true)
    try {
      const res = await cmdbApi.listLabels({ tab: '全部', keyword: code, page: 1, page_size: 1 })
      const hit = (res.list || [])[0]
      if (!hit) {
        setScanResult(null)
        message.warning(`未找到编码 ${code} 对应的资产`)
      } else {
        setScanResult(hit)
      }
    } catch (e) {
      message.error('编码定位失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    { title: '编码', dataIndex: 'code', width: 170, sorter: false },
    { title: '资产名称', dataIndex: 'asset_name', width: 180, render: (v) => v || '-' },
    { title: 'SN', dataIndex: 'sn', width: 160, render: (v) => v || '-' },
    { title: '所属部门', dataIndex: 'department', width: 130, render: (v) => v || '-' },
    { title: '负责人', dataIndex: 'owner', width: 110, render: (v) => v || '-' },
    { title: '资产编号', dataIndex: 'asset_code', width: 170, render: (v) => v || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v) => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v) => v || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, rec) => (
        <Space size={4}>
          {rec.status === '已归档' ? (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                try {
                  await cmdbApi.setLabelStatus(rec.id, '使用中')
                  message.success('已恢复为使用中')
                  afterMutate()
                } catch (e) {
                  message.error('操作失败：' + e.message)
                }
              }}
            >
              恢复
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                try {
                  await cmdbApi.setLabelStatus(rec.id, '已归档')
                  message.success('已归档')
                  afterMutate()
                } catch (e) {
                  message.error('操作失败：' + e.message)
                }
              }}
            >
              归档
            </Button>
          )}
          <Popconfirm
            title="确认删除该编码记录？"
            onConfirm={async () => {
              try {
                await cmdbApi.deleteLabel(rec.id)
                message.success('已删除')
                afterMutate()
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

  const content = (
    <>
      <div className="cmdb-toolbar">
        <Button type="primary" icon={<BarcodeOutlined />} loading={busy} onClick={doGenerate}>
          批量生成编码
        </Button>
        <Button icon={<QrcodeOutlined />} onClick={() => { setScanValue(''); setScanResult(null); setScanOpen(true) }}>
          扫码 / 编码定位
        </Button>
        <Button icon={<SettingOutlined />} onClick={openRule}>
          编码规则设置
        </Button>
        <Button icon={<PrinterOutlined />} onClick={openAudit}>
          打印审计
        </Button>
        <Button icon={<ToolOutlined />} loading={busy} onClick={doRepair}>
          修复孤儿编码{orphanCount > 0 ? `（${orphanCount}）` : ''}
        </Button>
        <Button icon={<PrinterOutlined />} loading={busy} onClick={doPrint}>
          批量打印（{selectedIds.length}）
        </Button>
        <Input.Search
          allowClear
          placeholder="搜索编码 / 资产名称 / SN"
          style={{ width: 260 }}
          onSearch={(v) => {
            setPage(1)
            setKeyword(v.trim())
          }}
        />
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
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys),
        }}
        locale={{ emptyText: '暂无编码记录，请先对设备/机柜/端口等实体生成编码' }}
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
    </>
  )

  return (
    <div>
      <Tabs
        activeKey={tab}
        onChange={(k) => {
          setTab(k)
          setPage(1)
          setSelectedIds([])
        }}
        items={TABS.map((t) => ({
          key: t,
          label: t === '孤儿' && orphanCount > 0 ? `${t}（${orphanCount}）` : t,
          children: content,
        }))}
      />

      <Modal
        title="扫码 / 编码定位"
        open={scanOpen}
        onOk={doScan}
        onCancel={() => setScanOpen(false)}
        confirmLoading={busy}
        okText="定位"
        cancelText="关闭"
      >
        <Input
          autoFocus
          placeholder="扫描或输入编码后回车"
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          onPressEnter={doScan}
        />
        {scanResult ? (
          <Descriptions column={1} size="small" bordered style={{ marginTop: 12 }}>
            <Descriptions.Item label="编码">{scanResult.code}</Descriptions.Item>
            <Descriptions.Item label="资产名称">{scanResult.asset_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="资产编号">{scanResult.asset_code || '-'}</Descriptions.Item>
            <Descriptions.Item label="SN">{scanResult.sn || '-'}</Descriptions.Item>
            <Descriptions.Item label="所属部门">{scanResult.department || '-'}</Descriptions.Item>
            <Descriptions.Item label="负责人">{scanResult.owner || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">{scanResult.status}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>

      <Modal
        title="编码规则设置"
        open={ruleOpen}
        onOk={saveRule}
        onCancel={() => setRuleOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary">
          生成规则：资产已有「资产编号」时直接采用该编号；没有编号时使用「前缀-资产ID」生成。
        </Typography.Paragraph>
        <Form form={ruleForm} layout="vertical">
          <Form.Item
            name="prefix"
            label="编码前缀"
            rules={[{ required: true, message: '前缀不能为空' }]}
          >
            <Input placeholder="如 ZC" allowClear />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="打印审计（已记录打印的编码）"
        open={auditOpen}
        onCancel={() => setAuditOpen(false)}
        footer={<Button onClick={() => setAuditOpen(false)}>关闭</Button>}
        width={760}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={printed}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: '暂无打印记录' }}
          columns={[
            { title: '编码', dataIndex: 'code', width: 170 },
            { title: '资产名称', dataIndex: 'asset_name', render: (v) => v || '-' },
            { title: '打印批次', dataIndex: 'print_batch', width: 160, render: (v) => v || '-' },
            { title: '创建时间', dataIndex: 'created_at', width: 170, render: (v) => v || '-' },
          ]}
        />
      </Modal>
    </div>
  )
}
