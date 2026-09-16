import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Card,
  Row,
  Col,
  Progress,
  Segmented,
  Input,
  Select,
  Button,
  Table,
  Drawer,
  Form,
  Descriptions,
  Tag,
  Tooltip,
  message,
  Modal,
  Space,
  Typography,
  Empty,
  Spin,
  AutoComplete,
} from 'antd'
import {
  ReloadOutlined,
  DownloadOutlined,
  PlusOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  ClusterOutlined,
} from '@ant-design/icons'
import { api } from './api'
import IPSubnetManager from './IPSubnetManager'

const { Text } = Typography

// 末位数值：用于矩阵定位与排序
function lastOctet(ip) {
  const i = String(ip).lastIndexOf('.')
  return i < 0 ? NaN : Number(String(ip).slice(i + 1))
}

function prefixOf(ip) {
  const i = String(ip).lastIndexOf('.')
  return i < 0 ? '' : String(ip).slice(0, i)
}

const STATUS_ALL = '全部'

// 网段类别配色（专网 / 外网 / 内网，也可自定义）
const CATEGORY_COLOR = { 专网: 'blue', 外网: 'orange', 内网: 'green' }

export default function IPManager({ meta, focusTarget, onNavigate }) {
  const [summary, setSummary] = useState(null)
  const [subnet, setSubnet] = useState('')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)

  const [status, setStatus] = useState(STATUS_ALL)
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [view, setView] = useState('grid')

  const [listPage, setListPage] = useState(1)
  const [listPageSize, setListPageSize] = useState(50)

  const [drawer, setDrawer] = useState({ open: false, entry: null })
  const [subnetMgrOpen, setSubnetMgrOpen] = useState(false)
  const [formMode, setFormMode] = useState('allocate') // allocate | edit | create
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  // ---- 网段汇总 ----
  const loadSummary = useCallback(async () => {
    try {
      const s = await api.getIPPoolSummary()
      setSummary(s)
      setSubnet((prev) => prev || (s.subnets && s.subnets[0] ? s.subnets[0].subnet : ''))
    } catch (e) {
      message.error('加载网段汇总失败：' + e.message)
    }
  }, [])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  // ---- 当前网段全部 IP（矩阵需要整段数据，253 条量级）----
  const loadEntries = useCallback(async (sn) => {
    if (!sn) return
    setLoading(true)
    try {
      const res = await api.getIPPool({ subnet: sn, page: 1, page_size: 500 })
      setEntries(res.list || [])
    } catch (e) {
      message.error('加载 IP 列表失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEntries(subnet)
  }, [subnet, loadEntries])

  useEffect(() => {
    const targetSubnet = focusTarget?.data?.网段 || focusTarget?.data?.subnet || focusTarget?.subtitle
    if (targetSubnet && summary?.subnets?.some((item) => item.subnet === targetSubnet)) setSubnet(targetSubnet)
  }, [focusTarget, summary])

  // 全局查询命中 IP 后，切换到对应网段并打开该地址详情。
  useEffect(() => {
    if (!focusTarget || !entries.length) return
    const targetIp = focusTarget.title || focusTarget.data?.IP || focusTarget.data?.ip
    const hit = entries.find((entry) => (focusTarget.id && entry.id === focusTarget.id) || (targetIp && entry.ip === targetIp))
    if (hit) openDrawer(hit)
  }, [focusTarget, entries])

  const refreshAll = () => {
    loadSummary()
    loadEntries(subnet)
  }

  const handleExport = async () => {
    try {
      await api.exportIPPool({ subnet, status, keyword })
    } catch (e) {
      message.error('导出 IP 规划失败: ' + e.message)
    }
  }

  // ---- 筛选（矩阵与列表共用同一套条件）----
  const matches = useCallback(
    (e) => {
      if (!e) return false
      if (status !== STATUS_ALL && e.status !== status) return false
      if (keyword) {
        const kw = keyword.toLowerCase()
        const hay = [e.ip, e.account, e.department, e.room, e.remark, e.asset_code, e.asset_user]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    },
    [status, keyword],
  )

  const filtered = useMemo(() => entries.filter(matches), [entries, matches])

  const activeSummary = useMemo(() => {
    if (!summary || !summary.subnets) return null
    return summary.subnets.find((s) => s.subnet === subnet) || null
  }, [summary, subnet])

  const filteredFree = filtered.filter((e) => e.status !== '在用').length
  const filteredUsed = filtered.length - filteredFree

  // 补录 / 编辑表单里的网段选项：来自已定义的网段（含尚未录入 IP 的）
  const subnetOptions = () =>
    (summary?.subnets || []).map((s) => ({
      value: s.subnet,
      label: s.category ? `${s.subnet}（${s.category}）` : s.subnet,
    }))

  // ---- 矩阵数据 ----
  const matrixCells = useMemo(() => {
    if (!activeSummary) return []
    const byLast = {}
    entries.forEach((e) => {
      const n = lastOctet(e.ip)
      if (!Number.isNaN(n)) byLast[n] = e
    })
    const from = lastOctet(activeSummary.range_from)
    const to = lastOctet(activeSummary.range_to)
    if (Number.isNaN(from) || Number.isNaN(to)) return []
    const cells = []
    for (let i = from; i <= to; i++) cells.push({ last: i, entry: byLast[i] || null })
    return cells
  }, [entries, activeSummary])

  // ---- 操作 ----
  const openDrawer = (entry) => setDrawer({ open: true, entry })

  const openAllocate = (entry) => {
    setDrawer({ open: false, entry })
    setFormMode('allocate')
    form.resetFields()
    form.setFieldsValue({
      department: entry.department || '',
      account: entry.account || '',
      room: entry.room || '',
      remark: entry.remark || '',
    })
    setFormOpen(true)
  }

  const openEdit = (entry) => {
    setDrawer({ open: false, entry })
    setFormMode('edit')
    form.resetFields()
    form.setFieldsValue({
      subnet: entry.subnet,
      ip: entry.ip,
      department: entry.department || '',
      room: entry.room || '',
      account: entry.account || '',
      status: entry.status || '空闲',
      remark: entry.remark || '',
    })
    setFormOpen(true)
  }

  const openCreate = () => {
    setFormMode('create')
    form.resetFields()
    form.setFieldsValue({ subnet: subnet || '', status: '空闲' })
    setFormOpen(true)
  }

  const submitForm = async () => {
    try {
      const v = await form.validateFields()
      setSaving(true)
      const entry = drawer.entry
      if (formMode === 'allocate') {
        await api.allocateIP(entry.id, {
          department: v.department || '',
          account: v.account || '',
          room: v.room || '',
          remark: v.remark || '',
        })
        message.success(`已分配 ${entry.ip}`)
        setDrawer({ open: false, entry: null })
      } else if (formMode === 'edit') {
        await api.updateIPEntry(entry.id, v)
        message.success('已保存')
        setDrawer({ open: false, entry: null })
      } else {
        await api.createIPEntry(v)
        message.success(`已新增 ${v.ip}`)
      }
      setFormOpen(false)
      refreshAll()
    } catch (e) {
      if (e?.errorFields) return
      message.error('操作失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const doRelease = (entry) => {
    Modal.confirm({
      title: `确认释放 ${entry.ip}？`,
      content: entry.asset_code ? (
        <div>
          <p>
            该 IP 正被资产 <b>{entry.asset_code}</b>
            {entry.asset_user ? `（${entry.asset_user}）` : ''} 占用。
          </p>
          <p>
            释放后 IP 池会置为「空闲」并清空使用人 / 部门 / 房间，但
            <b>不会改动资产台账</b>，资产仍会保留这个 IP。若设备已撤走，请同时在资产模块里调整它的 IP。
          </p>
        </div>
      ) : (
        '释放后该 IP 会置为「空闲」，使用人 / 部门 / 房间 / 备注将被清空。'
      ),
      okText: '释放',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.releaseIP(entry.id)
          message.success(`已释放 ${entry.ip}`)
          setDrawer({ open: false, entry: null })
          refreshAll()
        } catch (e) {
          message.error(e.message)
          throw e
        }
      },
    })
  }

  // 删除：若该 IP 正被资产占用，先拒绝并说明，再由用户决定是否强制删除。
  const doDelete = (entry) => {
    const run = async (force) => {
      try {
        await api.deleteIPEntry(entry.id, force)
        message.success(force ? `已强制删除 ${entry.ip}` : '已删除')
        setDrawer({ open: false, entry: null })
        refreshAll()
      } catch (e) {
        if (!force && e.message.includes('正被资产')) {
          Modal.confirm({
            title: '该 IP 正被资产占用',
            width: 520,
            content: (
              <div>
                <p>{e.message}</p>
                <p style={{ marginBottom: 0 }}>
                  <b>强制删除</b>只会移除 IP 池里的这条记录，<b>不会改动资产</b>；
                  资产仍会保留该 IP，两边台账将不再一致。
                </p>
              </div>
            ),
            okText: '仍要强制删除',
            okType: 'danger',
            cancelText: '取消',
            onOk: () => run(true),
          })
          return
        }
        message.error(e.message)
      }
    }

    Modal.confirm({
      title: `确认删除 ${entry.ip}？`,
      content: '删除会把该条目从 IP 规划池中移除，与「释放」不同。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => run(false),
    })
  }

  // ---- 列表视图列 ----
  const columns = [
    {
      title: 'IP 地址',
      dataIndex: 'ip',
      width: 150,
      render: (v) => <span className="ip-mono">{v}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) =>
        v === '在用' ? <Tag color="error">已占用</Tag> : <Tag color="success">空闲</Tag>,
    },
    { title: '使用人 / 帐号', dataIndex: 'account', width: 140, render: (v) => v || '-' },
    { title: '归属部门', dataIndex: 'department', width: 120, render: (v) => v || '-' },
    { title: '房间', dataIndex: 'room', width: 100, render: (v) => v || '-' },
    {
      title: '占用资产',
      dataIndex: 'asset_code',
      width: 180,
      render: (v, r) =>
        v ? (
          <Tooltip title={r.asset_user ? `使用人：${r.asset_user}` : ''}>
            <Tag color="blue">{v}</Tag>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    { title: '备注', dataIndex: 'remark', render: (v) => v || '-' },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openDrawer(r)}>
            详情
          </Button>
          {r.status === '在用' ? (
            <Button type="link" size="small" danger onClick={() => doRelease(r)}>
              释放
            </Button>
          ) : (
            <Button type="link" size="small" onClick={() => openAllocate(r)}>
              分配
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div className="ip-page-v2">
      {/* ===== 网段总览 ===== */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {(summary?.subnets || []).map((s) => {
          const active = s.subnet === subnet
          return (
            <Col key={s.subnet} xs={24} sm={12} lg={8} xl={summary.subnets.length > 4 ? 4 : 6}>
              <Card
                size="small"
                hoverable
                onClick={() => {
                  setSubnet(s.subnet)
                  setListPage(1)
                }}
                className={'ip-subnet-card' + (active ? ' active' : '')}
              >
                <div className="ip-subnet-name">
                  {s.subnet}
                  {s.category ? (
                    <Tag
                      style={{ marginLeft: 6 }}
                      color={CATEGORY_COLOR[s.category] || 'default'}
                    >
                      {s.category}
                    </Tag>
                  ) : null}
                </div>
                <div className="ip-subnet-range">{s.prefix ? `${s.prefix}.x` : '未填写网段'}</div>
                <Progress
                  percent={s.usage_rate}
                  size="small"
                  strokeColor={s.usage_rate >= 80 ? '#cf1322' : s.usage_rate >= 50 ? '#d48806' : '#389e0d'}
                />
                <div className="ip-subnet-meta">
                  <span>总 {s.total}</span>
                  <span className="used">占 {s.used}</span>
                  <span className="free">空 {s.free}</span>
                </div>
              </Card>
            </Col>
          )
        })}
        {summary ? (
          <Col xs={24} sm={12} lg={8} xl={summary.subnets.length > 4 ? 4 : 6}>
            <Card size="small" className="ip-subnet-card ip-subnet-total">
              <div className="ip-subnet-name">合计</div>
              <div className="ip-subnet-range">全部网段</div>
              <Progress percent={summary.usage_rate} size="small" strokeColor="#1f4e79" />
              <div className="ip-subnet-meta">
                <span>总 {summary.total}</span>
                <span className="used">占 {summary.used}</span>
                <span className="free">空 {summary.free}</span>
              </div>
            </Card>
          </Col>
        ) : null}
      </Row>

      {/* ===== 工具栏 ===== */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={12}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { label: '方格图', value: 'grid', icon: <AppstoreOutlined /> },
              { label: '列表', value: 'list', icon: <UnorderedListOutlined /> },
            ]}
          />
          <Select
            value={status}
            onChange={(v) => {
              setStatus(v)
              setListPage(1)
            }}
            style={{ width: 130 }}
            options={[
              { value: STATUS_ALL, label: '全部状态' },
              { value: '空闲', label: '仅空闲' },
              { value: '在用', label: '仅已占用' },
            ]}
          />
          <Input.Search
            allowClear
            style={{ width: 260 }}
            placeholder="搜索 IP / 使用人 / 部门 / 房间 / 资产编号"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onSearch={(v) => {
              setKeyword(v.trim())
              setListPage(1)
            }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            补录 IP
          </Button>
          <Button icon={<ClusterOutlined />} onClick={() => setSubnetMgrOpen(true)}>
            网段管理
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={handleExport}
          >
            导出
          </Button>
          <Button icon={<ReloadOutlined />} onClick={refreshAll}>
            刷新
          </Button>
          <Text type="secondary">
            当前筛选 <b>{filtered.length}</b> 条（空闲 {filteredFree} / 占用 {filteredUsed}）
          </Text>
        </Space>
      </Card>

      {/* ===== 主体 ===== */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      ) : !activeSummary ? (
        <Empty description="暂无网段数据，请先在「网段管理」中定义网段" />
      ) : activeSummary.total === 0 ? (
        <Card size="small">
          <Empty
            description={`网段「${subnet}」已定义但尚未录入任何 IP，可用「补录 IP」添加，或在「网段管理」中继续完善定义`}
          />
        </Card>
      ) : view === 'grid' ? (
        <Card
          size="small"
          title={
            <Space>
              <span>{subnet} 段地址分布</span>
              <Text type="secondary" style={{ fontWeight: 'normal' }}>
                {activeSummary.range_from} ~ {activeSummary.range_to}
              </Text>
            </Space>
          }
          extra={
            <Space size={12}>
              <span className="ip-legend">
                <i className="ip-legend-dot free" />
                空闲
              </span>
              <span className="ip-legend">
                <i className="ip-legend-dot used" />
                已占用
              </span>
              <Text type="secondary">点击方格查看详情 / 分配</Text>
            </Space>
          }
        >
          <div className="ip-matrix">
            {matrixCells.map((c) => {
              const e = c.entry
              if (!e) {
                return (
                  <div key={c.last} className="ip-cell empty" title={`${activeSummary.prefix}.${c.last} 无记录`}>
                    {c.last}
                  </div>
                )
              }
              const hit = matches(e)
              const title = (
                <div>
                  <div>
                    <b>
                      {e.ip}
                    </b>
                  </div>
                  <div>状态：{e.status === '在用' ? '已占用' : '空闲'}</div>
                  {e.account ? <div>使用人：{e.account}</div> : null}
                  {e.department ? <div>部门：{e.department}</div> : null}
                  {e.room ? <div>房间：{e.room}</div> : null}
                  {e.asset_code ? <div>占用资产：{e.asset_code}</div> : null}
                  {e.remark ? <div>备注：{e.remark}</div> : null}
                </div>
              )
              return (
                <Tooltip key={c.last} title={title} mouseEnterDelay={0.15}>
                  <div
                    className={
                      'ip-cell ' +
                      (e.status === '在用' ? 'used' : 'free') +
                      (hit ? '' : ' dimmed')
                    }
                    onClick={() => (e.status === '在用' ? openDrawer(e) : openAllocate(e))}
                  >
                    {c.last}
                  </div>
                </Tooltip>
              )
            })}
          </div>
        </Card>
      ) : (
        <div className="table-wrap">
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={filtered}
            scroll={{ x: 'max-content' }}
            pagination={{
              current: listPage,
              pageSize: listPageSize,
              total: filtered.length,
              showSizeChanger: true,
              pageSizeOptions: [50, 100, 200],
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p, ps) => {
                setListPage(p)
                setListPageSize(ps)
              },
            }}
          />
        </div>
      )}

      {/* ===== IP 详情抽屉 ===== */}
      <Drawer
        title={drawer.entry ? `${drawer.entry.ip}` : 'IP 详情'}
        width={460}
        open={drawer.open}
        onClose={() => setDrawer({ open: false, entry: null })}
        extra={
          drawer.entry ? (
            <Space>
              {drawer.entry.status === '在用' ? (
                <>
                  <Button size="small" onClick={() => openEdit(drawer.entry)}>
                    编辑
                  </Button>
                  <Button size="small" danger onClick={() => doRelease(drawer.entry)}>
                    释放
                  </Button>
                </>
              ) : (
                <Button size="small" type="primary" onClick={() => openAllocate(drawer.entry)}>
                  分配
                </Button>
              )}
              <Button size="small" danger type="text" onClick={() => doDelete(drawer.entry)}>
                删除
              </Button>
            </Space>
          ) : null
        }
      >
        {drawer.entry ? (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="IP 地址">
              <span className="ip-mono">{drawer.entry.ip}</span>
            </Descriptions.Item>
            <Descriptions.Item label="网段">{drawer.entry.subnet}</Descriptions.Item>
            <Descriptions.Item label="状态">
              {drawer.entry.status === '在用' ? (
                <Tag color="error">已占用</Tag>
              ) : (
                <Tag color="success">空闲</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="使用人 / 帐号">
              {drawer.entry.account || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="归属部门">{drawer.entry.department || '-'}</Descriptions.Item>
            <Descriptions.Item label="房间">{drawer.entry.room || '-'}</Descriptions.Item>
            <Descriptions.Item label="占用资产">
              {drawer.entry.asset_code ? <Button type="link" onClick={async () => {
                try {
                  const response = await api.getAssets({ keyword: drawer.entry.asset_code, page: 1, page_size: 500 })
                  const asset = response.list?.find((item) => item.asset_code === drawer.entry.asset_code)
                  if (!asset) throw new Error('未找到关联终端资产')
                  onNavigate?.({ tableKey: 'assets', id: asset.id })
                } catch (e) { message.error('加载关联资产失败：' + e.message) }
              }}>{drawer.entry.asset_code}</Button> : '未关联资产'}
            </Descriptions.Item>
            <Descriptions.Item label="备注">{drawer.entry.remark || '-'}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>

      {/* ===== 分配 / 编辑 / 补录 表单 ===== */}
      <Modal
        title={formMode === 'allocate' ? '分配 IP' : formMode === 'edit' ? '编辑 IP 条目' : '补录 IP'}
        open={formOpen}
        onOk={submitForm}
        onCancel={() => setFormOpen(false)}
        confirmLoading={saving}
        okText={formMode === 'allocate' ? '确认分配' : '保存'}
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {formMode === 'create' ? (
            <>
              <Form.Item name="subnet" label="网段" rules={[{ required: true, message: '请选择或填写网段' }]}>
                <AutoComplete
                  placeholder="从已定义网段中选择，或直接输入新名称"
                  options={subnetOptions()}
                  filterOption={(input, option) => String(option.value).includes(input)}
                />
              </Form.Item>
              <Form.Item
                name="ip"
                label="IP 地址"
                rules={[
                  { required: true, message: '请填写 IP 地址' },
                  {
                    pattern: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
                    message: 'IP 格式不正确，例如 138.64.9.200',
                  },
                ]}
              >
                <Input placeholder="138.64.9.200" />
              </Form.Item>
            </>
          ) : null}

          {formMode === 'edit' ? (
            <>
              <Form.Item name="subnet" label="网段" rules={[{ required: true, message: '请选择或填写网段' }]}>
                <AutoComplete
                  options={subnetOptions()}
                  filterOption={(input, option) => String(option.value).includes(input)}
                />
              </Form.Item>
              <Form.Item name="ip" label="IP 地址" rules={[{ required: true, message: '请填写 IP 地址' }]}>
                <Input />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select
                  options={[
                    { value: '空闲', label: '空闲' },
                    { value: '在用', label: '在用' },
                  ]}
                />
              </Form.Item>
            </>
          ) : null}

          <Form.Item
            name="account"
            label="使用人 / 帐号"
            rules={formMode === 'allocate' ? [{ required: true, message: '请填写使用人或帐号' }] : []}
          >
            <Input placeholder="如 张三 / 诉服达1" allowClear />
          </Form.Item>
          <Form.Item name="department" label="归属部门">
            <Input placeholder="如 立案庭" allowClear />
          </Form.Item>
          <Form.Item name="room" label="房间 / 位置">
            <Input placeholder="如 302" allowClear />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="用途说明等" />
          </Form.Item>
        </Form>
      </Modal>

      <IPSubnetManager
        open={subnetMgrOpen}
        onClose={() => setSubnetMgrOpen(false)}
        onChanged={refreshAll}
      />
    </div>
  )
}
