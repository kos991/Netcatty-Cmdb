import React, { useEffect, useState, useMemo } from 'react'
import {
  Table,
  Button,
  Input,
  Select,
  Space,
  Tag,
  Badge,
  Modal,
  Form,
  Drawer,
  Timeline,
  Card,
  Descriptions,
  Popconfirm,
  message,
  Typography,
  Tooltip,
  DatePicker,
  Radio,
  Divider,
  Pagination,
} from 'antd'
import {
  SearchOutlined,
  PlusOutlined,
  SwapOutlined,
  ToolOutlined,
  HistoryOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  CopyOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from './api'

const { Text } = Typography

export default function AssetCenter({ meta, focusTarget, onNavigate }) {
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState({})
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 筛选条件
  const [keyword, setKeyword] = useState('')
  const [dept, setDept] = useState('全部')
  const [status, setStatus] = useState('全部')
  const [secSoft, setSecSoft] = useState('全部')
  const [selectedAssetId, setSelectedAssetId] = useState(null)
  const [viewMode] = useState('table')

  // 抽屉与弹窗状态
  const [drawerAsset, setDrawerAsset] = useState(null)
  const [drawerLogs, setDrawerLogs] = useState([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [relations, setRelations] = useState({ ips: [], servers: [], apps: [] })

  // 调换人员弹窗
  const [transferModalOpen, setTransferModalOpen] = useState(false)
  const [transferTarget, setTransferTarget] = useState(null)
  const [transferForm] = Form.useForm()

  // 维修换件弹窗
  const [maintModalOpen, setMaintModalOpen] = useState(false)
  const [maintTarget, setMaintTarget] = useState(null)
  const [maintForm] = Form.useForm()

  // 新增/编辑弹窗
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [editForm] = Form.useForm()

  const loadData = async (overrides = {}) => {
    setLoading(true)
    try {
      const res = await api.getAssets({
        keyword,
        dept: dept === '全部' ? '' : dept,
        status: status === '全部' ? '' : status,
        security_software: secSoft === '全部' ? '' : secSoft,
        page,
        page_size: pageSize,
        ...overrides,
      })
      setData(res.list || [])
      setTotal(res.total || 0)
      setSummary(res.summary || {})
    } catch (e) {
      message.error('加载资产列表失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [page, pageSize, dept, status, secSoft])

  const handleSearch = () => {
    setPage(1)
    loadData({ page: 1 })
  }

  const handleReset = () => {
    setKeyword('')
    setDept('全部')
    setStatus('全部')
    setSecSoft('全部')
    setPage(1)
    loadData({ keyword: '', dept: '', status: '', security_software: '', page: 1 })
  }

  const handleExport = async () => {
    try {
      await api.exportAssets({ keyword, dept: dept === '全部' ? '' : dept, status: status === '全部' ? '' : status, security_software: secSoft === '全部' ? '' : secSoft })
    } catch (e) {
      message.error('导出资产失败: ' + e.message)
    }
  }

  // 打开历史抽屉
  const openHistory = async (record) => {
    setDrawerAsset(record)
    setDrawerLoading(true)
    try {
      const res = await api.getAsset(record.id)
      setDrawerAsset(res.asset)
      setDrawerLogs(res.logs || [])
      const relationRes = await api.getAssetRelations(record.id)
      setRelations(relationRes || { ips: [], servers: [], apps: [] })
    } catch (e) {
      message.error('获取资产履历失败: ' + e.message)
    } finally {
      setDrawerLoading(false)
    }
  }

  useEffect(() => {
    if (focusTarget?.tableKey === 'assets') {
      openHistory({ id: focusTarget.id })
    }
  }, [focusTarget])

  // 打开调换人员
  const openTransfer = (record) => {
    setTransferTarget(record)
    transferForm.resetFields()
    transferForm.setFieldsValue({
      to_department: record.department,
      to_room: record.room,
      date: dayjs(),
      operator: '资产管理员',
    })
    setTransferModalOpen(true)
  }

  const submitTransfer = async () => {
    try {
      const vals = await transferForm.validateFields()
      await api.transferUser(transferTarget.id, {
        ...vals,
        date: vals.date ? vals.date.format('YYYY-MM-DD HH:mm:ss') : '',
      })
      message.success(`成功将设备调换给 ${vals.to_user}，已自动记录履历！`)
      setTransferModalOpen(false)
      loadData()
      if (drawerAsset && drawerAsset.id === transferTarget.id) {
        openHistory(transferTarget)
      }
    } catch (e) {
      if (e?.errorFields) return
      message.error('调换失败: ' + e.message)
    }
  }

  // 打开维修换件
  const openMaintenance = (record) => {
    setMaintTarget(record)
    maintForm.resetFields()
    maintForm.setFieldsValue({
      maintenance_type: '更换云桌面盒子',
      part_type: 'box',
      old_sn: record.box_sn,
      new_status: record.status,
      mark_old_as: '故障待修入库',
      date: dayjs(),
      operator: '运维技术员',
    })
    setMaintModalOpen(true)
  }

  const submitMaintenance = async () => {
    try {
      const vals = await maintForm.validateFields()
      await api.maintenance(maintTarget.id, {
        ...vals,
        date: vals.date ? vals.date.format('YYYY-MM-DD HH:mm:ss') : '',
      })
      message.success('设备维修/换件操作已成功完成，已自动更新主表并记入历史档案！')
      setMaintModalOpen(false)
      loadData()
      if (drawerAsset && drawerAsset.id === maintTarget.id) {
        openHistory(maintTarget)
      }
    } catch (e) {
      if (e?.errorFields) return
      message.error('维修换件提交失败: ' + e.message)
    }
  }

  // 新增 / 编辑
  const openCreate = () => {
    setEditTarget(null)
    editForm.resetFields()
    editForm.setFieldsValue({
      status: '在用',
      security_software: '已安装',
      net_type: '专网',
    })
    setEditModalOpen(true)
  }

  const openEdit = (record) => {
    setEditTarget(record)
    editForm.resetFields()
    editForm.setFieldsValue(record)
    setEditModalOpen(true)
  }

  const submitEdit = async () => {
    try {
      const vals = await editForm.validateFields()
      if (editTarget) {
        await api.updateAsset(editTarget.id, vals)
        message.success('资产信息更新成功！')
      } else {
        await api.createAsset(vals)
        message.success('新设备录入成功，已建立资产档案！')
      }
      setEditModalOpen(false)
      loadData()
    } catch (e) {
      if (e?.errorFields) return
      message.error('保存失败: ' + e.message)
    }
  }

  const doDelete = async (id) => {
    try {
      await api.deleteAsset(id, { reason: '资产注销归档', operator: '资产管理员' })
      message.success('资产已注销归档')
      loadData()
    } catch (e) {
      message.error('删除失败: ' + e.message)
    }
  }

  const copyText = (text) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    message.success(`已复制: ${text}`)
  }

  // 表格列定义
  const columns = [
    {
      title: '资产编码',
      dataIndex: 'asset_code',
      key: 'asset_code',
      width: 140,
      render: (v) => v || <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '当前使用人',
      dataIndex: 'user_name',
      key: 'user_name',
      width: 110,
      render: (v) => (
        <span style={{ fontWeight: 600, color: v ? '#1677ff' : '#999' }}>
          {v || '公用 / 闲置'}
        </span>
      ),
    },
    {
      title: '部门 / 房间',
      key: 'location',
      width: 150,
      render: (_, r) => (
        <div>
          <div>{r.department ? <Tag color="blue">{r.department}</Tag> : null}</div>
          <div style={{ color: '#666', fontSize: 12 }}>{r.room || '-'}</div>
        </div>
      ),
    },
    {
      title: '盒子SN',
      dataIndex: 'box_sn',
      key: 'box_sn',
      width: 130,
      render: (v) =>
        v ? (
          <Space size={4}>
            <span style={{ fontFamily: 'monospace' }}>{v}</span>
            <Tooltip title="复制SN">
              <CopyOutlined
                style={{ cursor: 'pointer', color: '#1677ff', fontSize: 12 }}
                onClick={() => copyText(v)}
              />
            </Tooltip>
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: '显示器SN',
      dataIndex: 'display_sn',
      key: 'display_sn',
      width: 150,
      ellipsis: true,
      render: (v) =>
        v ? (
          <Space size={4}>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
            <Tooltip title="复制SN">
              <CopyOutlined
                style={{ cursor: 'pointer', color: '#1677ff', fontSize: 12 }}
                onClick={() => copyText(v)}
              />
            </Tooltip>
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: '业务IP',
      dataIndex: 'ip',
      key: 'ip',
      width: 130,
      render: (v) => (v ? <Tag color="cyan">{v}</Tag> : <span style={{ color: '#ccc' }}>-</span>),
    },
    {
      title: '安元软件',
      dataIndex: 'security_software',
      key: 'security_software',
      width: 100,
      render: (v) => {
        if (v === '已安装' || v === 'Y') {
          return <Tag color="success" icon={<CheckCircleOutlined />}>已安装</Tag>
        }
        if (v === '未安装' || v === 'N') {
          return <Tag color="error" icon={<CloseCircleOutlined />}>未安装</Tag>
        }
        return <Tag>{v || '未登记'}</Tag>
      },
    },
    {
      title: '设备状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v) => {
        let badgeStatus = 'default'
        if (v === '在用') badgeStatus = 'success'
        else if (v === '闲置') badgeStatus = 'warning'
        else if (v === '维修中') badgeStatus = 'error'
        else if (v?.includes('备用') || v?.includes('仓库')) badgeStatus = 'processing'
        return <Badge status={badgeStatus} text={v || '在用'} />
      },
    },
    {
      title: '核心操作',
      key: 'actions',
      fixed: 'right',
      width: 260,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="查看设备历史维护与流转记录">
            <Button
              type="text"
              size="small"
              icon={<HistoryOutlined />}
              style={{ color: '#722ed1' }}
              onClick={() => openHistory(r)}
            >
              履历
            </Button>
          </Tooltip>

          <Tooltip title="调换当前使用人与所在房间">
            <Button
              type="text"
              size="small"
              icon={<SwapOutlined />}
              style={{ color: '#1677ff' }}
              onClick={() => openTransfer(r)}
            >
              调换人
            </Button>
          </Tooltip>

          <Tooltip title="维修送修或更换盒子/显示器SN">
            <Button
              type="text"
              size="small"
              icon={<ToolOutlined />}
              style={{ color: '#fa8c16' }}
              onClick={() => openMaintenance(r)}
            >
              维修换件
            </Button>
          </Tooltip>

          <Tooltip title="修改属性">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(r)}
            />
          </Tooltip>

          <Popconfirm
            title="确认删除此资产档案？"
            onConfirm={() => doDelete(r.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const cmdbColumns = [
    {
      title: '资产编码',
      dataIndex: 'asset_code',
      key: 'asset_code',
      width: 150,
      render: (v, r) => (
        <Button type="link" size="small" className="cmdb-link" onClick={() => openHistory(r)}>
          {v || `资产-${r.id}`}
        </Button>
      ),
    },
    {
      title: '名称 / 当前使用人',
      key: 'owner',
      width: 190,
      render: (_, r) => (
        <div>
          <div className="cmdb-primary-text">{r.user_name || '公用 / 闲置'}</div>
          <div className="cmdb-secondary-text">{r.department || '未分配'} · {r.room || '未指定位置'}</div>
        </div>
      ),
    },
    {
      title: '设备分类',
      key: 'category',
      width: 150,
      render: () => <Tag color="blue">云桌面终端</Tag>,
    },
    {
      title: 'SN / IP',
      key: 'identity',
      width: 230,
      render: (_, r) => (
        <div className="cmdb-mono-cell">
          <div>{r.box_sn || r.display_sn || '-'}</div>
          <div className="cmdb-secondary-text">{r.ip || r.terminal_ip || '未配置 IP'}</div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v) => {
        const color = v === '在用' ? 'success' : v === '维修中' ? 'error' : v === '闲置' ? 'warning' : 'default'
        return <Tag color={color}>{v || '在用'}</Tag>
      },
    },
    {
      title: '安元软件',
      dataIndex: 'security_software',
      key: 'security_software',
      width: 110,
      render: (v) => <Tag color={v === '已安装' || v === 'Y' ? 'green' : 'default'}>{v || '未登记'}</Tag>,
    },
    {
      title: '操作',
      key: 'cmdb_actions',
      fixed: 'right',
      width: 260,
      render: (_, r) => (
        <Space size={2}>
          <Button type="link" size="small" onClick={() => openHistory(r)}>详情</Button>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" size="small" onClick={() => openTransfer(r)}>调换</Button>
          <Button type="link" size="small" onClick={() => openMaintenance(r)}>维修</Button>
          <Popconfirm title="确认注销此资产？" onConfirm={() => doDelete(r.id)} okText="注销" cancelText="取消">
            <Button type="link" size="small" danger>注销</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="cmdb-assets-page">
      <div className="cmdb-breadcrumb">资源管理 <span>/</span> 云桌面终端资产</div>
      <div className="cmdb-assets-layout">
        <main className="cmdb-assets-main">
          <div className="cmdb-page-heading">
            <div>
              <h2>终端资产</h2>
            </div>
            <Space>
              <Button icon={<DownloadOutlined />} onClick={handleExport}>批量导出</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增资产</Button>
            </Space>
          </div>

          <div className="cmdb-occupancy-panel">
            <div className="cmdb-occupancy-heading">
              <div>
                <strong>资产占用总览</strong>
                <span>当前关键词、部门和安元软件筛选下的全量统计</span>
              </div>
              <span className="cmdb-occupancy-total">共 {summary.total ?? total} 项</span>
            </div>
            <div className="cmdb-occupancy-grid">
              {[
                { key: '全部', label: '全部资产', count: summary.total ?? total, color: 'blue' },
                { key: '在用', label: '在用', count: summary['在用'] || 0, color: 'green' },
                { key: '闲置', label: '闲置', count: summary['闲置'] || 0, color: 'orange' },
                { key: '维修中', label: '维修中', count: summary['维修中'] || 0, color: 'red' },
                { key: '仓库备用', label: '仓库 / 备用', count: summary['仓库备用'] || 0, color: 'purple' },
              ].map((item) => {
                const all = summary.total ?? total
                const percent = all ? Math.round((item.count / all) * 100) : 0
                return (
                  <button
                    key={item.key}
                    className={`cmdb-occupancy-item ${status === item.key ? 'active' : ''}`}
                    onClick={() => { setStatus(item.key); setPage(1) }}
                  >
                    <span className={`cmdb-occupancy-dot ${item.color}`} />
                    <span className="cmdb-occupancy-label">{item.label}</span>
                    <strong>{item.count}</strong>
                    <span className="cmdb-occupancy-percent">{percent}%</span>
                    <span className="cmdb-occupancy-track"><i className={item.color} style={{ width: `${percent}%` }} /></span>
                  </button>
                )
              })}
            </div>
          </div>

          <Card size="small" className="cmdb-filter-card">
            <Space wrap size={10}>
          <Input.Search
            placeholder="搜索资产编码、SN、人员、IP"
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={handleSearch}
            style={{ width: 300 }}
            enterButton={<SearchOutlined />}
          />

          <span className="cmdb-filter-label">部门</span>
          <Select
            value={dept}
            onChange={(v) => {
              setDept(v)
              setPage(1)
            }}
            style={{ width: 140 }}
          >
            <Select.Option value="全部">全部部门</Select.Option>
            {meta?.departments?.map((d) => (
              <Select.Option key={d} value={d}>
                {d}
              </Select.Option>
            ))}
          </Select>

          <span className="cmdb-filter-label">状态</span>
          <Select
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            style={{ width: 120 }}
          >
            <Select.Option value="全部">全部状态</Select.Option>
            {meta?.statuses?.map((s) => (
              <Select.Option key={s} value={s}>
                {s}
              </Select.Option>
            ))}
          </Select>

          <span className="cmdb-filter-label">安元软件</span>
          <Select
            value={secSoft}
            onChange={(v) => {
              setSecSoft(v)
              setPage(1)
            }}
            style={{ width: 110 }}
          >
            <Select.Option value="全部">全部</Select.Option>
            <Select.Option value="已安装">已安装</Select.Option>
            <Select.Option value="未安装">未安装</Select.Option>
          </Select>

          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            重置
          </Button>

          <Text type="secondary" style={{ marginLeft: 8 }}>
            共 <strong style={{ color: '#1677ff' }}>{total}</strong> 项资产
          </Text>
            </Space>
          </Card>

          {viewMode === 'cards' ? (
            <div className="cmdb-card-panel">
              <div className="cmdb-card-summary">
                <span>当前筛选结果</span><strong>{total}</strong><span>项资产</span>
              </div>
              {loading ? (
                <div className="cmdb-card-loading">加载资产中...</div>
              ) : data.length === 0 ? (
                <div className="cmdb-card-loading">暂无匹配资产</div>
              ) : (
                <div className="cmdb-asset-grid">
                  {data.map((r) => {
                    const statusColor = r.status === '在用' ? 'green' : r.status === '维修中' ? 'red' : r.status === '闲置' ? 'orange' : 'default'
                    return (
                      <Card
                        key={r.id}
                        size="small"
                        hoverable
                        className={`cmdb-asset-card ${r.id === selectedAssetId ? 'selected' : ''}`}
                        onClick={() => setSelectedAssetId(r.id)}
                        title={<span className="cmdb-card-code">{r.asset_code || `资产-${r.id}`}</span>}
                        extra={<Tag color={statusColor}>{r.status || '在用'}</Tag>}
                      >
                        <div className="cmdb-card-owner">{r.user_name || '公用 / 闲置'}</div>
                        <div className="cmdb-card-location">{r.department || '未分配'} · {r.room || '未指定位置'}</div>
                        <div className="cmdb-card-fields">
                          <div><span>设备类型</span><b>云桌面终端</b></div>
                          <div><span>盒子 SN</span><b className="cmdb-card-mono">{r.box_sn || r.display_sn || '-'}</b></div>
                          <div><span>业务 IP</span><b className="cmdb-card-mono">{r.ip || r.terminal_ip || '未配置'}</b></div>
                          <div><span>安元软件</span><b>{r.security_software || '未登记'}</b></div>
                        </div>
                        <div className="cmdb-card-actions">
                          <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); openHistory(r) }}>详情</Button>
                          <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); openEdit(r) }}>编辑</Button>
                          <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); openTransfer(r) }}>调换</Button>
                          <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); openMaintenance(r) }}>维修</Button>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              )}
              <div className="cmdb-card-pagination">
                <Pagination
                  current={page}
                  pageSize={pageSize}
                  total={total}
                  showSizeChanger
                  pageSizeOptions={[20, 50, 100]}
                  showTotal={(t) => `共 ${t} 项资产`}
                  onChange={(p, ps) => { setPage(p); setPageSize(ps) }}
                />
              </div>
            </div>
          ) : (
          <div className="cmdb-table-panel table-wrap">
          <Table
        rowKey="id"
        loading={loading}
        columns={cmdbColumns}
        dataSource={data}
        size="small"
        rowClassName={(record) => record.id === selectedAssetId ? 'cmdb-selected-row' : ''}
        onRow={(record) => ({ onClick: () => setSelectedAssetId(record.id) })}
        scroll={{ x: 1160 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (t) => `共 ${t} 条设备资产`,
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
        }}
          />
          </div>
          )}
        </main>
      </div>

      {/* 1. 资产全生命周期历史履历抽屉 */}
      <Drawer
        title={
          <Space>
            <HistoryOutlined style={{ color: '#722ed1' }} />
            <span>设备全生命周期档案与维护履历</span>
          </Space>
        }
        placement="right"
        width={680}
        open={!!drawerAsset}
        onClose={() => setDrawerAsset(null)}
        destroyOnClose
      >
        {drawerAsset && (
          <div>
            <Card size="small" style={{ marginBottom: 20, background: '#fafafa' }}>
              <Descriptions size="small" column={2} title="当前设备概况">
                <Descriptions.Item label="资产编码">{drawerAsset.asset_code || '-'}</Descriptions.Item>
                <Descriptions.Item label="设备状态">
                  <Tag color={drawerAsset.status === '在用' ? 'green' : 'orange'}>
                    {drawerAsset.status}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="当前使用人">
                  <strong style={{ color: '#1677ff' }}>{drawerAsset.user_name || '公用'}</strong>
                </Descriptions.Item>
                <Descriptions.Item label="所在部门">
                  {drawerAsset.department || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="房间/法庭">{drawerAsset.room || '-'}</Descriptions.Item>
                <Descriptions.Item label="业务IP">{drawerAsset.ip || '-'}</Descriptions.Item>
                <Descriptions.Item label="云桌面盒子SN">
                  <span style={{ fontFamily: 'monospace' }}>{drawerAsset.box_sn || '-'}</span>
                </Descriptions.Item>
                <Descriptions.Item label="显示器SN">
                  <span style={{ fontFamily: 'monospace' }}>{drawerAsset.display_sn || '-'}</span>
                </Descriptions.Item>
                <Descriptions.Item label="安元软件情况">
                  {drawerAsset.security_software || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="建档时间">{drawerAsset.created_at || '-'}</Descriptions.Item>
              </Descriptions>

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <Button
                  size="small"
                  type="primary"
                  icon={<SwapOutlined />}
                  onClick={() => openTransfer(drawerAsset)}
                >
                  为这台设备调换使用人
                </Button>
                <Button
                  size="small"
                  icon={<ToolOutlined />}
                  onClick={() => openMaintenance(drawerAsset)}
                >
                  设备维修 / 更换SN
                </Button>
              </div>
            </Card>

            <Typography.Title level={5} style={{ marginBottom: 16 }}>
              📜 历史运维与调配轨迹（时间轴）
            </Typography.Title>

            <Card size="small" title="关联信息" style={{ marginBottom: 16 }}>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="关联 IP">
                  {relations.ips?.length ? relations.ips.map((item) => <Button type="link" key={item.id} onClick={() => onNavigate?.({ tableKey: 'ip_pool', id: item.id, title: item.ip, subtitle: item.subnet })}>{item.ip}（{item.status || '未标记'}）</Button>) : '未关联 IP 池记录'}
                </Descriptions.Item>
                <Descriptions.Item label="关联服务器">
                  {relations.servers?.length ? relations.servers.map((item) => <Button type="link" key={item.id} onClick={() => onNavigate?.({ tableKey: 'servers', id: item.id })}>{item.device_name}（{item.biz_ip || item.mgmt_ip || '无地址'}）</Button>) : '未关联服务器'}
                </Descriptions.Item>
                <Descriptions.Item label="关联应用">
                  {relations.apps?.length ? relations.apps.map((item) => <Button type="link" key={item.id} onClick={() => onNavigate?.({ tableKey: 'server_apps', id: item.id, title: item.app_name })}>{item.app_name}{item.port ? `:${item.port}` : ''}</Button>) : '未关联业务系统'}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {drawerLoading ? (
              <div>加载中...</div>
            ) : drawerLogs.length === 0 ? (
              <Text type="secondary">暂无流转记录</Text>
            ) : (
              <Timeline
                mode="left"
                items={drawerLogs.map((log) => {
                  let color = 'blue'
                  let icon = <HistoryOutlined />
                  if (log.log_type === '调换使用人') {
                    color = 'green'
                    icon = <SwapOutlined />
                  } else if (log.log_type === '设备维修更换') {
                    color = 'orange'
                    icon = <ToolOutlined />
                  } else if (log.log_type === '建档入库') {
                    color = 'purple'
                  } else if (log.log_type === '设备回收注销') {
                    color = 'red'
                  }

                  return {
                    color,
                    dot: icon,
                    label: log.log_time,
                    children: (
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                          <Tag color={color}>{log.log_type}</Tag>
                          {log.operator && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              经办人: {log.operator}
                            </Text>
                          )}
                        </div>

                        {log.log_type === '调换使用人' && (
                          <div style={{ marginTop: 4, background: '#f6ffed', padding: '6px 10px', borderRadius: 4, border: '1px solid #b7eb8f' }}>
                            <div>
                              人员交接：
                              <del style={{ color: '#999' }}>{log.from_user || '未指定'}</del>
                              {' ➡️ '}
                              <strong style={{ color: '#52c41a' }}>{log.to_user}</strong>
                            </div>
                            {(log.from_location || log.to_location) && (
                              <div style={{ fontSize: 12, color: '#666' }}>
                                位置变动：{log.from_location || '-'} ➡️ {log.to_location || '-'}
                              </div>
                            )}
                          </div>
                        )}

                        {log.log_type === '设备维修更换' && (
                          <div style={{ marginTop: 4, background: '#fff7e6', padding: '6px 10px', borderRadius: 4, border: '1px solid #ffd591' }}>
                            {log.old_sn && log.new_sn && (
                              <div>
                                SN 更换：<del style={{ color: '#999' }}>{log.old_sn}</del>
                                {' ➡️ '}
                                <strong style={{ color: '#fa8c16' }}>{log.new_sn}</strong>
                              </div>
                            )}
                          </div>
                        )}

                        <div style={{ marginTop: 6, color: '#333' }}>
                          {log.description}
                        </div>
                      </div>
                    ),
                  }
                })}
              />
            )}
          </div>
        )}
      </Drawer>

      {/* 2. 调换使用人弹窗 */}
      <Modal
        title={
          <Space>
            <SwapOutlined style={{ color: '#1677ff' }} />
            <span>设备交接调配 · 调换使用人</span>
          </Space>
        }
        open={transferModalOpen}
        onOk={submitTransfer}
        onCancel={() => setTransferModalOpen(false)}
        destroyOnClose
        okText="确认调配"
        cancelText="取消"
        width={560}
      >
        {transferTarget && (
          <Form form={transferForm} layout="vertical" style={{ marginTop: 16 }}>
            <Card size="small" style={{ background: '#f5f5f5', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  原使用人：<strong>{transferTarget.user_name || '公用 / 闲置'}</strong>
                </div>
                <div>
                  原位置：<strong>{transferTarget.department} {transferTarget.room}</strong>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                盒子SN: {transferTarget.box_sn} | IP: {transferTarget.ip || '未分配'}
              </div>
            </Card>

            <Form.Item
              name="to_user"
              label="新使用人 (责任人)"
              rules={[{ required: true, message: '请输入新使用人姓名' }]}
            >
              <Input placeholder="输入新使用人姓名，如：李四" />
            </Form.Item>

            <Space orientation="horizontal" style={{ width: '100%', display: 'flex' }} size={12}>
              <Form.Item
                name="to_department"
                label="调入新部门"
                style={{ flex: 1 }}
              >
                <Select placeholder="选择或输入新部门" allowClear showSearch>
                  {meta?.departments?.map((d) => (
                    <Select.Option key={d} value={d}>
                      {d}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="to_room"
                label="新房间/法庭号"
                style={{ flex: 1 }}
              >
                <Input placeholder="如：305室 或 第3法庭" />
              </Form.Item>
            </Space>

            <Form.Item
              name="new_ip"
              label="变更业务IP (留空则沿用当前IP)"
            >
              <Input placeholder={`当前IP为: ${transferTarget.ip || '无'}，需要调整请填入`} />
            </Form.Item>

            <Space orientation="horizontal" style={{ width: '100%', display: 'flex' }} size={12}>
              <Form.Item name="date" label="交接调换日期" style={{ flex: 1 }}>
                <DatePicker showTime style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="operator" label="经办人" style={{ flex: 1 }}>
                <Input placeholder="经办人姓名" />
              </Form.Item>
            </Space>

            <Form.Item name="description" label="交接调换说明 / 备注">
              <Input.TextArea
                rows={2}
                placeholder="例如：岗位调动交接、法庭设备轮换、借调使用"
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 3. 设备维修换件弹窗 */}
      <Modal
        title={
          <Space>
            <ToolOutlined style={{ color: '#fa8c16' }} />
            <span>设备维修更换 · 硬件换件与维保记录</span>
          </Space>
        }
        open={maintModalOpen}
        onOk={submitMaintenance}
        onCancel={() => setMaintModalOpen(false)}
        destroyOnClose
        okText="完成换件维修"
        cancelText="取消"
        width={600}
      >
        {maintTarget && (
          <Form form={maintForm} layout="vertical" style={{ marginTop: 16 }}>
            <Card size="small" style={{ background: '#fffbe6', marginBottom: 16, border: '1px solid #ffe58f' }}>
              <div>设备：{maintTarget.user_name} ({maintTarget.department} {maintTarget.room})</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                当前盒子SN: <strong>{maintTarget.box_sn || '无'}</strong> | 显示器SN: <strong>{maintTarget.display_sn || '无'}</strong>
              </div>
            </Card>

            <Form.Item name="part_type" label="更换部件类型" rules={[{ required: true }]}>
              <Radio.Group
                onChange={(e) => {
                  if (e.target.value === 'box') {
                    maintForm.setFieldsValue({
                      maintenance_type: '更换云桌面盒子',
                      old_sn: maintTarget.box_sn,
                    })
                  } else if (e.target.value === 'display') {
                    maintForm.setFieldsValue({
                      maintenance_type: '更换显示器',
                      old_sn: maintTarget.display_sn,
                    })
                  } else {
                    maintForm.setFieldsValue({
                      maintenance_type: '硬件故障维修',
                      old_sn: '',
                    })
                  }
                }}
              >
                <Radio.Button value="box">更换盒子</Radio.Button>
                <Radio.Button value="display">更换显示器</Radio.Button>
                <Radio.Button value="other">整机排障/维修</Radio.Button>
              </Radio.Group>
            </Form.Item>

            <Space style={{ width: '100%', display: 'flex' }} size={12}>
              <Form.Item name="old_sn" label="原设备SN" style={{ flex: 1 }}>
                <Input placeholder="原旧件 SN" readOnly style={{ background: '#f5f5f5' }} />
              </Form.Item>
              <Form.Item
                name="new_sn"
                label="新设备SN (换上件)"
                style={{ flex: 1 }}
                rules={[{ required: true, message: '请输入更换后的新SN编号' }]}
              >
                <Input placeholder="输入替换上的新 SN" />
              </Form.Item>
            </Space>

            <Space style={{ width: '100%', display: 'flex' }} size={12}>
              <Form.Item name="new_status" label="换件后资产状态" style={{ flex: 1 }}>
                <Select>
                  <Select.Option value="在用">在用</Select.Option>
                  <Select.Option value="维修中">维修中</Select.Option>
                  <Select.Option value="仓库备用">仓库备用</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="mark_old_as" label="旧设备去向联动" style={{ flex: 1 }}>
                <Select>
                  <Select.Option value="故障待修入库">自动作为故障件入库备修</Select.Option>
                  <Select.Option value="报废">直接报废</Select.Option>
                  <Select.Option value="无">不联动</Select.Option>
                </Select>
              </Form.Item>
            </Space>

            <Space style={{ width: '100%', display: 'flex' }} size={12}>
              <Form.Item name="date" label="维保日期" style={{ flex: 1 }}>
                <DatePicker showTime style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="operator" label="维修经办技术员" style={{ flex: 1 }}>
                <Input placeholder="如：IT运维技术员" />
              </Form.Item>
            </Space>

            <Form.Item name="description" label="故障原因与维保说明" rules={[{ required: true, message: '请简述维修原因' }]}>
              <Input.TextArea
                rows={2}
                placeholder="例如：原盒子电源指示灯不亮无法开机，替换为仓库备用机"
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 4. 资产属性新增 / 编辑弹窗 */}
      <Modal
        title={editTarget ? '编辑资产基本信息' : '录入新云桌面资产'}
        open={editModalOpen}
        onOk={submitEdit}
        onCancel={() => setEditModalOpen(false)}
        destroyOnClose
        okText="保存"
        cancelText="取消"
        width={650}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Space style={{ width: '100%', display: 'flex' }} size={12}>
            <Form.Item name="asset_code" label="资产编码" style={{ flex: 1 }}>
              <Input placeholder="如：202510000201xxxx" />
            </Form.Item>
            <Form.Item name="status" label="设备状态" style={{ flex: 1 }}>
              <Select>
                {meta?.statuses?.map((s) => (
                  <Select.Option key={s} value={s}>
                    {s}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Space>

          <Space style={{ width: '100%', display: 'flex' }} size={12}>
            <Form.Item name="box_sn" label="云桌面盒子SN" style={{ flex: 1 }}>
              <Input placeholder="如：71W5270xxx" />
            </Form.Item>
            <Form.Item name="display_sn" label="显示器SN" style={{ flex: 1 }}>
              <Input placeholder="如：TGME1HW270HTxxxx" />
            </Form.Item>
          </Space>

          <Space style={{ width: '100%', display: 'flex' }} size={12}>
            <Form.Item name="user_name" label="当前使用人" style={{ flex: 1 }}>
              <Input placeholder="使用人员姓名" />
            </Form.Item>
            <Form.Item name="department" label="所属部门" style={{ flex: 1 }}>
              <Select showSearch allowClear placeholder="选择部门">
                {meta?.departments?.map((d) => (
                  <Select.Option key={d} value={d}>
                    {d}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="room" label="所在房间/法庭" style={{ flex: 1 }}>
              <Input placeholder="如：305 或 第5法庭" />
            </Form.Item>
          </Space>

          <Space style={{ width: '100%', display: 'flex' }} size={12}>
            <Form.Item name="ip" label="业务/虚拟机IP" style={{ flex: 1 }}>
              <Input placeholder="如：138.64.9.50" />
            </Form.Item>
            <Form.Item name="terminal_ip" label="终端物理IP" style={{ flex: 1 }}>
              <Input placeholder="如：192.168.35.x" />
            </Form.Item>
            <Form.Item name="security_software" label="安元软件情况" style={{ flex: 1 }}>
              <Select>
                <Select.Option value="已安装">已安装</Select.Option>
                <Select.Option value="未安装">未安装</Select.Option>
                <Select.Option value="待核实">待核实</Select.Option>
              </Select>
            </Form.Item>
          </Space>

          <Form.Item name="remark" label="备注说明">
            <Input.TextArea rows={2} placeholder="其他说明备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
