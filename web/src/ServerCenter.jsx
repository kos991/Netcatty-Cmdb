import React, { useEffect, useState } from 'react'
import {
  Table,
  Card,
  Input,
  Select,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Row,
  Col,
  message,
  Typography,
  Popconfirm,
  Drawer,
  Tabs,
  Alert,
  Badge,
  Descriptions,
  Divider,
  Tooltip,
  Upload,
} from 'antd'
import {
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DesktopOutlined,
  AppstoreOutlined,
  LinkOutlined,
  CopyOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  DatabaseOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { api } from './api'
import { hasNativeCmdbImportBridge } from './cmdbTransport'

const { Option } = Select
const { Text, Title, Paragraph } = Typography

export default function ServerCenter({ meta, focusTarget, section }) {
  const nativeImport = hasNativeCmdbImportBridge()
  const [activeTab, setActiveTab] = useState(section || 'servers')
  const [appDetail, setAppDetail] = useState(null)
  const [appDetailError, setAppDetailError] = useState('')
  const [appError, setAppError] = useState('')
  const [serverChoices, setServerChoices] = useState([])
  const [servers, setServers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 搜索过滤
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('全部')
  const [locationFilter, setLocationFilter] = useState('全部')
  const [serverView, setServerView] = useState('list')
  const [locationOptions, setLocationOptions] = useState([])

  // 全院应用总览
  const [allApps, setAllApps] = useState([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [appKeyword, setAppKeyword] = useState('')
  const [appTypeFilter, setAppTypeFilter] = useState('全部')
  const [appTotal, setAppTotal] = useState(0)
  const [appPage, setAppPage] = useState(1)
  const [appPageSize, setAppPageSize] = useState(20)

  // 服务器新增/编辑 Modal
  const [serverModalVisible, setServerModalVisible] = useState(false)
  const [editingServer, setEditingServer] = useState(null)
  const [serverForm] = Form.useForm()

  // 某服务器应用抽屉 Drawer
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [selectedServer, setSelectedServer] = useState(null)
  const [serverApps, setServerApps] = useState([])
  const [drawerLoading, setDrawerLoading] = useState(false)

  // 应用新增/编辑 Modal
  const [appModalVisible, setAppModalVisible] = useState(false)
  const [editingApp, setEditingApp] = useState(null)
  const [appForm] = Form.useForm()
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState(null)
  const [importLoading, setImportLoading] = useState(false)

  const previewSangforImport = async (file) => {
    setImportLoading(true)
    try {
      const result = await api.importSangfor(file)
      if (result.cancelled) return false
      setImportFile(file || null)
      setImportPreview(result)
      setImportModalOpen(true)
    } catch (e) {
      message.error(e.message)
    } finally {
      setImportLoading(false)
    }
    return false
  }

  const commitSangforImport = async () => {
    if (!importFile && !importPreview?.token) return
    setImportLoading(true)
    try {
      const result = await api.importSangfor(importFile, true, importPreview?.token)
      message.success(`导入完成：服务器新增 ${result.servers_created}，应用新增 ${result.apps_created}`)
      setImportModalOpen(false)
      setImportFile(null)
      setImportPreview(null)
      loadServers(1, pageSize)
    } catch (e) {
      message.error(e.message)
    } finally {
      setImportLoading(false)
    }
  }

  const loadServers = async (p = page, ps = pageSize) => {
    setLoading(true)
    try {
      const data = await api.getServers({
        keyword,
        location: locationFilter === '全部' ? '' : locationFilter,
        status: statusFilter === '全部' ? '' : statusFilter,
        page: p,
        page_size: ps,
      })
      setServers(data.list || [])
      setTotal(data.total || 0)
      setPage(p)
      setPageSize(ps)
    } catch (e) {
      message.error('加载服务器失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadAllApps = async (p = appPage, ps = appPageSize, filters = {}) => {
    setAppsLoading(true)
    try {
      const data = await api.getAllApps({
        keyword: appKeyword,
        app_type: appTypeFilter === '全部' ? '' : appTypeFilter,
        page: p,
        page_size: ps,
        ...filters,
      })
      setAllApps(data.list || [])
      setAppTotal(data.total || 0)
      setAppPage(p)
      setAppPageSize(ps)
      setAppError('')
    } catch (e) {
      setAppError(e.message)
    } finally {
      setAppsLoading(false)
    }
  }

  const loadLocationOptions = async () => {
    try {
      const data = await api.getServers({ page: 1, page_size: 500 })
      setLocationOptions(Array.from(new Set((data.list || []).map((item) => item.location).filter(Boolean))))
    } catch (e) {
      message.error('加载机房位置失败: ' + e.message)
    }
  }

  useEffect(() => {
    if (activeTab === 'servers') {
      loadServers(1, pageSize)
      loadLocationOptions()
    } else {
      loadAllApps(1, appPageSize)
    }
  }, [activeTab, statusFilter, locationFilter, appTypeFilter])

  const openSearchApp = async () => {
    if (focusTarget?.tableKey !== 'server_apps') return
    setAppDetail({ id: focusTarget.id })
    setAppDetailError('')
    try {
      let current = 1
      let response
      do {
        response = await api.getAllApps({ keyword: focusTarget.title || '', page: current, page_size: 500 })
        const match = response.list?.find((item) => item.id === focusTarget.id)
        if (match) { setAppDetail(match); return }
      } while (response.list?.length && current++ * 500 < response.total)
      throw new Error('未找到该业务系统')
    } catch (e) { setAppDetailError(e.message) }
  }
  useEffect(() => {
    if (focusTarget?.tableKey === 'servers') openLinkedServer(focusTarget.id)
    else openSearchApp()
  }, [focusTarget])

  const loadServerChoices = async (query = '') => {
    try { const res = await api.getServers({ keyword: query, page: 1, page_size: 500 }); setServerChoices(res.list || []) }
    catch (e) { message.error('加载承载服务器失败：' + e.message) }
  }

  const openLinkedServer = async (id) => {
    try { const response = await api.getServer(id); await openAppDrawer(response.server || response) }
    catch (e) { message.error('加载承载服务器失败：' + e.message) }
  }

  // 打开服务器抽屉
  const openAppDrawer = async (srv) => {
    setSelectedServer(srv)
    setDrawerVisible(true)
    setDrawerLoading(true)
    try {
      const apps = await api.getServerApps(srv.id)
      setServerApps(apps || [])
    } catch (e) {
      message.error('加载服务器应用失败: ' + e.message)
    } finally {
      setDrawerLoading(false)
    }
  }

  // 复制文字
  const copyText = (text, label) => {
    if (!text) return
    navigator.clipboard.writeText(text).then(
      () => message.success(`已复制${label}: ` + text),
      () => message.error('复制失败')
    )
  }

  // 保存服务器
  const handleSaveServer = async () => {
    try {
      const values = await serverForm.validateFields()
      if (editingServer) {
        await api.updateServer(editingServer.id, values)
        message.success('服务器更新成功')
      } else {
        await api.createServer(values)
        message.success('服务器建档入库成功')
      }
      setServerModalVisible(false)
      loadServers()
    } catch (e) {
      if (e.message) message.error(e.message)
    }
  }

  // 删除服务器
  const handleDeleteServer = async (id) => {
    try {
      await api.deleteServer(id)
      message.success('删除成功')
      loadServers()
    } catch (e) {
      message.error('删除失败: ' + e.message)
    }
  }

  // 保存业务系统
  const handleSaveApp = async () => {
    try {
      const values = await appForm.validateFields()
      if (editingApp) {
        await api.updateApp(editingApp.id, values)
        message.success('业务系统更新成功')
      } else {
        await api.createServerApp(values.server_id || selectedServer?.id, values)
        message.success('应用添加成功')
      }
      setAppModalVisible(false)
      if (editingApp && appDetail?.id === editingApp.id) setAppDetail((previous) => ({ ...previous, ...values }))
      if (selectedServer) {
        const apps = await api.getServerApps(selectedServer.id)
        setServerApps(apps || [])
        loadServers()
      }
      if (activeTab === 'apps') {
        loadAllApps()
      }
    } catch (e) {
      if (e.message) message.error(e.message)
    }
  }

  // 删除业务系统
  const handleDeleteApp = async (id) => {
    try {
      await api.deleteApp(id)
      message.success('应用已删除')
      if (appDetail?.id === id) setAppDetail(null)
      if (selectedServer) {
        const apps = await api.getServerApps(selectedServer.id)
        setServerApps(apps || [])
        loadServers()
      }
      if (activeTab === 'apps') {
        loadAllApps()
      }
    } catch (e) {
      message.error('删除失败: ' + e.message)
    }
  }

  const serverColumns = [
    {
      title: '设备/主机名',
      key: 'device_name',
      width: 220,
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600, color: '#1677ff' }}>
            <DesktopOutlined style={{ marginRight: 6 }} />
            {r.device_name}
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            型号: {r.brand_model || '通用机架式'}
          </div>
          {r.asset_code && (
            <div style={{ fontSize: 11, color: '#aaa' }}>
              资产码: {r.asset_code}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '机房及U位',
      key: 'location',
      width: 170,
      render: (_, r) => (
        <div>
          <div><Tag color="blue">{r.location || '核心机房'}</Tag></div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
            {r.rack_unit || '机柜未分配'}
          </div>
        </div>
      ),
    },
    {
      title: '带外管理地址 (BMC)',
      key: 'mgmt_ip',
      width: 200,
      render: (_, r) => {
        if (!r.mgmt_ip && !r.mgmt_url) {
          return <span style={{ color: '#ccc' }}>未配置带外IP</span>
        }
        return (
          <div>
            <Space orientation="vertical" size={2}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag color="purple" style={{ fontFamily: 'monospace' }}>
                  {r.mgmt_ip || 'BMC IP'}
                </Tag>
                {r.mgmt_ip && (
                  <Tooltip title="复制带外IP">
                    <CopyOutlined
                      style={{ cursor: 'pointer', color: '#888', fontSize: 12 }}
                      onClick={() => copyText(r.mgmt_ip, '带外IP')}
                    />
                  </Tooltip>
                )}
              </div>
              {r.mgmt_url && (
                <a
                  href={r.mgmt_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <LinkOutlined /> 打开管理控制台
                </a>
              )}
            </Space>
          </div>
        )
      },
    },
    {
      title: '业务IP / 操作系统',
      key: 'biz_ip',
      width: 180,
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 500, fontFamily: 'monospace' }}>
            {r.biz_ip || '-'}
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>
            {r.os_type || 'Linux / 未知'}
          </div>
        </div>
      ),
    },
    {
      title: '硬件配置',
      key: 'specs',
      width: 200,
      render: (_, r) => (
        <div style={{ fontSize: 12 }}>
          <div>CPU: {r.cpu_info || '-'}</div>
          <div>内存: {r.memory_info || '-'}</div>
          <div style={{ color: '#888' }}>存储: {r.disk_info || '-'}</div>
        </div>
      ),
    },
    {
      title: '承载业务系统 / 中间件',
      key: 'apps',
      width: 260,
      render: (_, r) => {
        const apps = r.apps || []
        if (apps.length === 0) {
          return (
            <Button
              type="dashed"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => openAppDrawer(r)}
            >
              配置应用
            </Button>
          )
        }
        return (
          <div>
            <Space wrap size={[4, 4]}>
              {apps.map((app) => (
                <Tag
                  key={app.id}
                  color={
                    app.app_type === '中间件服务'
                      ? 'geekblue'
                      : app.app_type === '数据库服务'
                      ? 'volcano'
                      : 'green'
                  }
                  style={{ cursor: 'pointer' }}
                  onClick={() => openAppDrawer(r)}
                >
                  {app.app_name}
                </Tag>
              ))}
            </Space>
            <div style={{ marginTop: 4 }}>
              <Button
                type="link"
                size="small"
                style={{ padding: 0, fontSize: 12 }}
                onClick={() => openAppDrawer(r)}
              >
                共 {apps.length} 个应用/服务 (点击管理) &gt;
              </Button>
            </div>
          </div>
        )
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_, r) => {
        const isRun = r.status === '运行中'
        return <Badge status={isRun ? 'success' : 'default'} text={r.status || '未知'} />
      },
    },
    {
      title: '责任人',
      dataIndex: 'admin_user',
      key: 'admin_user',
      width: 130,
      render: (v) => v || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_, r) => (
        <Space size={8}>
          <Tooltip title="应用管理">
            <Button
              size="small"
              type="primary"
              ghost
              icon={<AppstoreOutlined />}
              onClick={() => openAppDrawer(r)}
            >
              应用
            </Button>
          </Tooltip>
          <Tooltip title="编辑服务器">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditingServer(r)
                serverForm.setFieldsValue(r)
                setServerModalVisible(true)
              }}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除该服务器？"
            description="删除后，其名下关联的业务系统也将一并移除。"
            onConfirm={() => handleDeleteServer(r.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const appColumns = [
    {
      title: '系统/应用名称',
      dataIndex: 'app_name',
      key: 'app_name',
      width: 220,
      render: (v, r) => (
        <div>
          <Button type="link" style={{ padding: 0 }} onClick={() => { setAppDetailError(''); setAppDetail(r) }}>{v}</Button>
          <div style={{ fontSize: 12, color: '#888' }}>
            {r.middleware && <span>技术栈: {r.middleware}</span>}
          </div>
        </div>
      ),
    },
    {
      title: '应用类型',
      dataIndex: 'app_type',
      key: 'app_type',
      width: 120,
      render: (v) => {
        let color = 'blue'
        if (v === '中间件服务') color = 'geekblue'
        if (v === '数据库服务') color = 'volcano'
        if (v === '基础支撑') color = 'default'
        return <Tag color={color}>{v || '业务应用'}</Tag>
      },
    },
    {
      title: '承载服务器',
      key: 'server_info',
      width: 200,
      render: (_, r) => (
        <div>
          <Button type="link" style={{ padding: 0 }} onClick={() => openLinkedServer(r.server_id)}>
            {r.server_name || `服务器 #${r.server_id}`}
          </Button>
          <div style={{ fontSize: 12, color: '#666', fontFamily: 'monospace' }}>
            {r.server_biz_ip}
          </div>
        </div>
      ),
    },
    {
      title: '监听端口',
      dataIndex: 'port',
      key: 'port',
      width: 130,
      render: (v) => <Tag style={{ fontFamily: 'monospace' }}>{v || '未标明'}</Tag>,
    },
    {
      title: '访问 / 控制台 URL',
      dataIndex: 'access_url',
      key: 'access_url',
      width: 260,
      render: (v) => {
        if (!v) return '-'
        const isLink = v.startsWith('http://') || v.startsWith('https://')
        return (
          <Space>
            {isLink ? (
              <a href={v} target="_blank" rel="noreferrer">
                <LinkOutlined /> {v}
              </a>
            ) : (
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
            )}
            <Tooltip title="复制地址">
              <CopyOutlined
                style={{ cursor: 'pointer', color: '#888' }}
                onClick={() => copyText(v, '访问地址')}
              />
            </Tooltip>
          </Space>
        )
      },
    },
    {
      title: '关联数据库',
      dataIndex: 'database_info',
      key: 'database_info',
      width: 180,
      render: (v) => v || '-',
    },
    {
      title: '维护责任人',
      dataIndex: 'owner',
      key: 'owner',
      width: 120,
      render: (v) => v || '-',
    },
    {
      title: '运行状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v) => <Badge status={v === '正常运行' ? 'success' : 'error'} text={v || '未知'} />,
    },
  ]

  const locations = ['全部', ...locationOptions]
  const statusSummary = ['运行中', '维护中', '备用', '已停机'].map((status) => ({
    status,
    count: servers.filter((item) => item.status === status).length,
  }))

  return (
    <div>
      <div className="cmdb-server-content">
        {section === 'apps' && <div className="cmdb-page-heading"><h2>业务系统</h2><Space><Text type="secondary">{appTotal} 项</Text><Button type="primary" icon={<PlusOutlined />} onClick={() => {
          setSelectedServer(null); setEditingApp(null); appForm.resetFields(); appForm.setFieldsValue({ app_type: '业务应用', status: '正常运行' }); loadServerChoices(); setAppModalVisible(true)
        }}>新增系统</Button></Space></div>}
        {!section && <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'servers',
              label: (
                <span>
                  <DesktopOutlined /> 服务器台账
                </span>
              ),
            },
            {
              key: 'apps',
              label: (
                <span>
                  <AppstoreOutlined /> 全院业务系统总览
                </span>
              ),
            },
          ]}
        />}

        {activeTab === 'servers' ? (
          <div className="server-ledger-layout">
            <aside className="server-ledger-sidebar">
              <div className="server-ledger-sidebar-title">资源视图</div>
              <button className={`server-tree-item ${locationFilter === '全部' ? 'active' : ''}`} onClick={() => setLocationFilter('全部')}>
                <span>全部服务器</span><b>{total}</b>
              </button>
              <div className="server-tree-caption">按机房位置</div>
              {locations.filter((item) => item !== '全部').map((location) => (
                <button key={location} className={`server-tree-item ${locationFilter === location ? 'active' : ''}`} onClick={() => setLocationFilter(location)}>
                  <span title={location}>{location}</span><b>{servers.filter((item) => item.location === location).length}</b>
                </button>
              ))}
              <div className="server-ledger-sidebar-note">数据来自服务器台账<br />点击节点可联动筛选</div>
            </aside>
            <section className="server-ledger-main">
              <div className="server-ledger-heading">
                <div><Title level={4} style={{ margin: 0 }}>服务器台账</Title><Text type="secondary">机房 / 机柜 / 带外管理 / 承载应用</Text></div>
                <Space>
                  <Button type={serverView === 'list' ? 'primary' : 'default'} size="small" onClick={() => setServerView('list')}>清单</Button>
                  <Button type={serverView === 'rack' ? 'primary' : 'default'} size="small" onClick={() => setServerView('rack')}>机架概览</Button>
                </Space>
              </div>
              <div className="server-status-strip">
                {statusSummary.map((item) => <button key={item.status} className={`server-status-chip status-${item.status}`} onClick={() => setStatusFilter(item.status)}><span>{item.status}</span><strong>{item.count}</strong></button>)}
              </div>
            <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
              <Col xs={24} sm={8} md={6}>
                <Input
                  placeholder="搜索主机名/型号/SN/IP/管理地址..."
                  prefix={<SearchOutlined />}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onPressEnter={() => loadServers(1, pageSize)}
                  allowClear
                />
              </Col>
              <Col xs={12} sm={6} md={4}>
                <Select
                  style={{ width: '100%' }}
                  value={statusFilter}
                  onChange={setStatusFilter}
                >
                  <Option value="全部">运行状态: 全部</Option>
                  <Option value="运行中">运行中</Option>
                  <Option value="已停机">已停机</Option>
                  <Option value="维护中">维护中</Option>
                  <Option value="备用">备用</Option>
                </Select>
              </Col>
              <Col xs={24} sm={10} md={8}>
                <Space>
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    onClick={() => loadServers(1, pageSize)}
                  >
                    查询
                  </Button>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                  setKeyword('')
                  setStatusFilter('全部')
                      setLocationFilter('全部')
                      loadServers(1, pageSize)
                    }}
                  >
                    重置
                  </Button>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    style={{ background: '#52c41a' }}
                    onClick={() => {
                      setEditingServer(null)
                      serverForm.resetFields()
                      serverForm.setFieldsValue({
                        status: '运行中',
                        location: '核心机房',
                      })
                      setServerModalVisible(true)
                    }}
                    >
                    录入服务器
                  </Button>
                  {nativeImport ? (
                    <Button
                      icon={<UploadOutlined />}
                      loading={importLoading}
                      onClick={() => previewSangforImport()}
                    >
                      导入深信服 Excel
                    </Button>
                  ) : (
                    <Upload accept=".xlsx" showUploadList={false} beforeUpload={previewSangforImport}>
                      <Button icon={<UploadOutlined />} loading={importLoading}>导入深信服 Excel</Button>
                    </Upload>
                  )}
                </Space>
              </Col>
            </Row>

            {serverView === 'rack' ? (
              <div className="rack-overview">
                <div className="rack-overview-header"><span>当前页机架占用概览</span><Text type="secondary">共 {servers.length} 台</Text></div>
                <div className="rack-grid">
                  {servers.map((server) => <button key={server.id} className="rack-unit" onClick={() => openAppDrawer(server)}><span className="rack-unit-name">{server.device_name}</span><span className="rack-unit-meta">{server.location || '未分配机房'} · {server.rack_unit || 'U位未登记'}</span><span className={`rack-unit-state state-${server.status}`}>{server.status || '未知'}</span><span className="rack-unit-ip">{server.biz_ip || server.mgmt_ip || '无IP'}</span></button>)}
                </div>
                {!servers.length && <div className="rack-empty">暂无匹配服务器</div>}
                <div className="table-wrap rack-fallback-table">
                  <Table
              dataSource={servers}
              columns={serverColumns}
              rowKey="id"
              loading={loading}
              size="small"
              scroll={{ x: 1300 }}
              pagination={{
                current: page,
                pageSize: pageSize,
                total: total,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (t) => `共 ${t} 台服务器`,
                onChange: (p, ps) => loadServers(p, ps),
              }}
                  />
                </div>
              </div>
            ) : <div className="table-wrap"><Table
              dataSource={servers}
              columns={serverColumns}
              rowKey="id"
              loading={loading}
              size="small"
              scroll={{ x: 1300 }}
              pagination={{ current: page, pageSize, total, showSizeChanger: true, showQuickJumper: true, showTotal: (t) => `共 ${t} 台服务器`, onChange: (p, ps) => loadServers(p, ps) }}
            /></div>}
            </section>
          </div>
        ) : (
          <div>
            {appError && <Alert type="error" showIcon message="业务系统查询失败" description={appError} action={<Button onClick={() => loadAllApps()}>重试</Button>} />}
            <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
              <Col xs={24} sm={8} md={6}>
                <Input
                  placeholder="搜索系统名称/中间件/端口/数据库..."
                  prefix={<SearchOutlined />}
                  value={appKeyword}
                  onChange={(e) => setAppKeyword(e.target.value)}
                  onPressEnter={() => loadAllApps(1, appPageSize)}
                  allowClear
                />
              </Col>
              <Col xs={12} sm={6} md={4}>
                <Select
                  style={{ width: '100%' }}
                  value={appTypeFilter}
                  onChange={setAppTypeFilter}
                >
                  <Option value="全部">应用类型: 全部</Option>
                  <Option value="业务应用">业务应用</Option>
                  <Option value="中间件服务">中间件服务</Option>
                  <Option value="数据库服务">数据库服务</Option>
                  <Option value="基础支撑">基础支撑</Option>
                </Select>
              </Col>
              <Col xs={24} sm={10} md={8}>
                <Space>
                  <Button type="primary" icon={<SearchOutlined />} onClick={() => loadAllApps(1, appPageSize)}>
                    查询
                  </Button>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      setAppKeyword('')
                      setAppTypeFilter('全部')
                      loadAllApps(1, appPageSize, { keyword: '', app_type: '' })
                    }}
                  >
                    重置
                  </Button>
                </Space>
              </Col>
            </Row>

            <div className="table-wrap">
            <Table
              dataSource={allApps}
              columns={appColumns}
              rowKey="id"
              loading={appsLoading}
              size="small"
              scroll={{ x: 1300 }}
              pagination={{
                current: appPage,
                pageSize: appPageSize,
                total: appTotal,
                showSizeChanger: true,
                onChange: (p, ps) => loadAllApps(p, ps),
              }}
            />
            </div>
          </div>
        )}
      </div>

      <Drawer title="业务系统详情" open={!!appDetail} onClose={() => setAppDetail(null)} width={640}
        extra={appDetail?.app_name && <Space><Button onClick={() => { setEditingApp(appDetail); appForm.setFieldsValue(appDetail); loadServerChoices(); setAppModalVisible(true) }}>编辑</Button>
          <Popconfirm title="确认删除此业务系统？" onConfirm={() => handleDeleteApp(appDetail.id)}><Button danger>删除</Button></Popconfirm></Space>}>
        {appDetailError ? <Alert type="error" message={appDetailError} action={<Button onClick={openSearchApp}>重试</Button>} /> : <Descriptions column={1} bordered items={[
          ['名称', appDetail?.app_name], ['类型', appDetail?.app_type], ['状态', appDetail?.status], ['负责人', appDetail?.owner],
          ['访问地址', appDetail?.access_url], ['端口', appDetail?.port], ['中间件', appDetail?.middleware], ['数据库', appDetail?.database_info], ['备注', appDetail?.remark],
          ['承载资源', appDetail?.server_id ? <Button type="link" onClick={() => openLinkedServer(appDetail.server_id)}>{appDetail.server_name || `服务器 #${appDetail.server_id}`}</Button> : '未关联'],
        ].map(([label, value]) => ({ key: label, label, children: value || '-' }))} />}
      </Drawer>

      {/* 服务器录入 / 编辑 Modal */}
      <Modal
        title="深信服设备信息导入预览"
        open={importModalOpen}
        confirmLoading={importLoading}
        onOk={commitSangforImport}
        onCancel={() => setImportModalOpen(false)}
        okText="确认导入"
        cancelText="取消"
        width={720}
      >
        {importPreview && (
          <div>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="服务器新增">{importPreview.servers_created}</Descriptions.Item>
              <Descriptions.Item label="服务器更新">{importPreview.servers_updated}</Descriptions.Item>
              <Descriptions.Item label="应用新增">{importPreview.apps_created}</Descriptions.Item>
              <Descriptions.Item label="应用更新">{importPreview.apps_updated}</Descriptions.Item>
              <Descriptions.Item label="隐藏凭据字段">{importPreview.hidden_secrets}</Descriptions.Item>
              <Descriptions.Item label="处理规则">不导入明文账号密码</Descriptions.Item>
            </Descriptions>
            <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 12 }}>
              {(importPreview.items || []).slice(0, 80).map((item, index) => (
                <div key={`${item.kind}-${item.name}-${index}`} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                  <Tag color={item.kind === '服务器' ? 'blue' : 'purple'}>{item.kind}</Tag>
                  <span style={{ flex: 1 }}>{item.name}</span>
                  <span style={{ color: '#888' }}>{item.detail || '-'}</span>
                  <span style={{ color: item.action === '新增' ? '#52c41a' : '#1677ff' }}>{item.action}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={editingServer ? `编辑服务器: ${editingServer.device_name}` : '录入新服务器档案'}
        open={serverModalVisible}
        onOk={handleSaveServer}
        onCancel={() => setServerModalVisible(false)}
        width={750}
        destroyOnClose
      >
        <Form form={serverForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="device_name"
                label="设备名称 / 主机名"
                rules={[{ required: true, message: '请输入设备或主机名' }]}
              >
                <Input placeholder="如：zc-xbzg (业务核心主机01)" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="brand_model" label="品牌型号">
                <Input placeholder="如：浪潮 NF5280M6 / 华为 2288H V5" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="asset_code" label="资产编码">
                <Input placeholder="如：2025100003000001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="serial_number" label="出厂 SN 序列号">
                <Input placeholder="如：INSPUR-2026-X8892" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="mgmt_ip" label="带外管理地址 (BMC / iLO / iDRAC IP)">
                <Input placeholder="如：192.168.0.210" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="mgmt_url" label="带外控制台 URL">
                <Input placeholder="如：https://192.168.0.210" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="biz_ip" label="业务主IP / 网络地址">
                <Input placeholder="如：192.168.0.130/24" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="os_type" label="操作系统">
                <Input placeholder="如：Kylin Linux V10 / CentOS 7.9" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="location" label="机房位置">
                <Input placeholder="如：核心机房 / 3 层弱电间" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="rack_unit" label="机柜及U位">
                <Input placeholder="如：A02机柜 14-15U" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="cpu_info" label="CPU 配置">
                <Input placeholder="如：Gold 6248R * 2 (48核)" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="memory_info" label="内存容量">
                <Input placeholder="如：256GB DDR4 ECC" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="disk_info" label="存储及RAID">
                <Input placeholder="如：2*480G SSD + 4*2TB SAS" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="admin_user" label="责任管理员">
                <Input placeholder="如：技术处运维组 (张工)" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="运行状态">
                <Select>
                  <Option value="运行中">运行中</Option>
                  <Option value="已停机">已停机</Option>
                  <Option value="维护中">维护中</Option>
                  <Option value="备用">备用</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="warranty_date" label="维保截止日">
                <Input placeholder="如：2028-06-14" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="remark" label="备注说明">
            <Input.TextArea rows={2} placeholder="如：运行宝兰德中间件与达梦数据库等..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* 某物理机专属系统与应用抽屉 Drawer */}
      <Drawer
        title={
          selectedServer ? (
            <div>
              <span>🖥️ {selectedServer.device_name} - 承载业务系统清单</span>
              <span style={{ fontSize: 12, color: '#888', marginLeft: 12 }}>
                业务IP: {selectedServer.biz_ip || '-'}
              </span>
            </div>
          ) : (
            '业务系统清单'
          )
        }
        width={680}
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        destroyOnClose
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingApp(null)
              appForm.resetFields()
              appForm.setFieldsValue({
                app_type: '业务应用',
                status: '正常运行',
              })
              setAppModalVisible(true)
            }}
          >
            添加应用
          </Button>
        }
      >
        {selectedServer && (
          <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="机房及U位">
              {selectedServer.location} {selectedServer.rack_unit}
            </Descriptions.Item>
            <Descriptions.Item label="操作系统">
              {selectedServer.os_type || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="带外BMC">
              {selectedServer.mgmt_ip ? (
                <Space>
                  <Tag color="purple">{selectedServer.mgmt_ip}</Tag>
                  {selectedServer.mgmt_url && (
                    <a href={selectedServer.mgmt_url} target="_blank" rel="noreferrer">
                      <LinkOutlined /> 控制台
                    </a>
                  )}
                </Space>
              ) : (
                '未配置'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="硬件规格">
              {selectedServer.cpu_info} / {selectedServer.memory_info}
            </Descriptions.Item>
          </Descriptions>
        )}

        <Divider orientation="left" style={{ margin: '12px 0' }}>
          运行中的系统与应用列表 ({serverApps.length})
        </Divider>

        {serverApps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            暂未登记任何承载的应用或中间件服务，点击右上角【添加应用】进行录入
          </div>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {serverApps.map((app) => (
              <Card
                key={app.id}
                size="small"
                style={{ background: '#fafafa' }}
                title={
                  <Space>
                    <span style={{ fontWeight: 600 }}>{app.app_name}</span>
                    <Tag
                      color={
                        app.app_type === '中间件服务'
                          ? 'geekblue'
                          : app.app_type === '数据库服务'
                          ? 'volcano'
                          : 'green'
                      }
                    >
                      {app.app_type}
                    </Tag>
                    <Badge
                      status={app.status === '正常运行' ? 'success' : 'error'}
                      text={app.status}
                    />
                  </Space>
                }
                extra={
                  <Space size={4}>
                    <Button
                      size="small"
                      type="link"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditingApp(app)
                        appForm.setFieldsValue(app)
                        setAppModalVisible(true)
                      }}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="确认删除此应用？"
                      onConfirm={() => handleDeleteApp(app.id)}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                }
              >
                <Row gutter={[12, 8]} style={{ fontSize: 13 }}>
                  <Col span={12}>
                    <span style={{ color: '#888' }}>访问/控制台: </span>
                    {app.access_url ? (
                      <a href={app.access_url} target="_blank" rel="noreferrer">
                        {app.access_url}
                      </a>
                    ) : (
                      '-'
                    )}
                  </Col>
                  <Col span={12}>
                    <span style={{ color: '#888' }}>监听端口: </span>
                    <Tag style={{ fontFamily: 'monospace' }}>{app.port || '无'}</Tag>
                  </Col>
                  <Col span={12}>
                    <span style={{ color: '#888' }}>中间件/技术栈: </span>
                    {app.middleware || '-'}
                  </Col>
                  <Col span={12}>
                    <span style={{ color: '#888' }}>关联数据库: </span>
                    {app.database_info || '-'}
                  </Col>
                  <Col span={12}>
                    <span style={{ color: '#888' }}>责任人: </span>
                    {app.owner || '-'}
                  </Col>
                  <Col span={24}>
                    <span style={{ color: '#888' }}>说明: </span>
                    {app.remark || '无特殊说明'}
                  </Col>
                </Row>
              </Card>
            ))}
          </Space>
        )}
      </Drawer>

      {/* 应用录入 / 编辑 Modal */}
      <Modal
        title={editingApp ? `编辑应用: ${editingApp.app_name}` : '添加业务系统 / 中间件'}
        open={appModalVisible}
        onOk={handleSaveApp}
        onCancel={() => setAppModalVisible(false)}
        width={580}
        destroyOnClose
      >
        <Form form={appForm} layout="vertical">
          {!selectedServer && <Form.Item name="server_id" label="承载服务器" rules={[{ required: true, message: '请选择承载服务器' }]}>
            <Select showSearch filterOption={false} onSearch={loadServerChoices} options={serverChoices.map((server) => ({ value: server.id, label: `${server.device_name} ${server.biz_ip || ''}` }))} />
          </Form.Item>}
          <Form.Item
            name="app_name"
            label="应用系统名称"
            rules={[{ required: true, message: '请输入应用名称' }]}
          >
            <Input placeholder="如：BES Application Server / 统一业务系统" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="app_type" label="应用类型">
                <Select>
                  <Option value="业务应用">业务应用</Option>
                  <Option value="中间件服务">中间件服务</Option>
                  <Option value="数据库服务">数据库服务</Option>
                  <Option value="基础支撑">基础支撑</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="port" label="监听端口">
                <Input placeholder="如：18080/tcp, 1901/tcp" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="access_url" label="访问 / 管理URL">
            <Input placeholder="如：http://192.168.0.130:1901/console/" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="middleware" label="中间件 / 容器版本">
                <Input placeholder="如：BES 9.5.5.1 / Tomcat 9" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="database_info" label="关联数据库">
                <Input placeholder="如：达梦 DM8 (端口5236, 实例XCSJK)" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="owner" label="责任人 / 支持人员">
                <Input placeholder="如：技术处业务组 / 原厂支持" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="运行状态">
                <Select>
                  <Option value="正常运行">正常运行</Option>
                  <Option value="待部署">待部署</Option>
                  <Option value="停止">停止</Option>
                  <Option value="异常">异常</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="remark" label="备注说明">
            <Input.TextArea rows={2} placeholder="如：账号权限、维护注意事项等..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
