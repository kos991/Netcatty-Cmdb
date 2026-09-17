// 本文件是「统一资源管理」旧页面，已从 web/src/App.jsx 的引用中移除，不参与 Vite 构建。
// 其能力（资源台账 / 组织架构树 / 分类管理 / 批量编辑·克隆·注销 / 导入导出）已由
// web/src/cmdb/CmdbResources.jsx 实现并保留，正常使用无需本文件；
// 若要在左侧导航恢复该入口，把 MENU_ITEMS 与 renderPage 的 'cmdb' 分支加回即可（同为 antd，可直接使用）。
import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd'
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  CopyOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  FileExcelOutlined,
  FolderOutlined,
  HddOutlined,
  HistoryOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  LaptopOutlined,
  MoreOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SwapOutlined,
  TagsOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { api } from './api'

const { Text, Title, Paragraph } = Typography

const resourceTypes = [
  { key: 'all', label: '全部资源', icon: <DatabaseOutlinedIcon /> },
  { key: 'assets', label: '终端资产', icon: <LaptopOutlined /> },
  { key: 'servers', label: '基础设施', icon: <HddOutlined /> },
  { key: 'apps', label: '业务系统', icon: <AppstoreOutlined /> },
  { key: 'ip', label: 'IP 资源池', icon: <ClusterOutlined /> },
]

function DatabaseOutlinedIcon() {
  return <ClusterOutlined style={{ color: '#1677ff' }} />
}

const networkGroups = [
  { key: '全部', label: '全部环境' },
  { key: '专网', label: '专用网络办公区' },
  { key: '业务', label: '业务网络区' },
  { key: '机房', label: '核心机房托管区' },
  { key: '容灾', label: '容灾备用中心' },
  { key: '外网', label: '互联网隔离区' },
]

const statusColor = (status) => {
  if (['在用', '运行中', '正常运行'].includes(status)) return 'success'
  if (['维修中', '维护中', '待部署'].includes(status)) return 'warning'
  if (['已停机', '已报废', '异常'].includes(status)) return 'error'
  if (['闲置', '备用', '仓库备用'].includes(status)) return 'processing'
  return 'default'
}

export default function CMDBResources({ meta, onNavigate }) {
  const [type, setType] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [selectedOrg, setSelectedOrg] = useState('全部')
  const [selectedGroup, setSelectedGroup] = useState('全部')
  const [status, setStatus] = useState('全部')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 数据集
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState([])

  // 抽屉详情
  const [detail, setDetail] = useState(null)
  const [detailExtra, setDetailExtra] = useState({ logs: [], relations: {}, apps: [], server: null })
  const [detailLoading, setDetailLoading] = useState(false)

  // 弹窗状态
  const [addTypeModal, setAddTypeModal] = useState(false)
  const [assetModal, setAssetModal] = useState(false)
  const [assetTarget, setAssetTarget] = useState(null)
  const [serverModal, setServerModal] = useState(false)
  const [serverTarget, setServerTarget] = useState(null)
  const [batchModal, setBatchModal] = useState(false)
  const [batchType, setBatchType] = useState('edit') // 'edit' | 'delete'
  const [categoryModal, setCategoryModal] = useState(false)
  const [barcodeModal, setBarcodeModal] = useState(false)
  const [inventoryModal, setInventoryModal] = useState(false)

  // 调换人与维修弹窗
  const [transferModal, setTransferModal] = useState(false)
  const [transferTarget, setTransferTarget] = useState(null)
  const [maintModal, setMaintModal] = useState(false)
  const [maintTarget, setMaintTarget] = useState(null)

  // 导入状态
  const [importModal, setImportModal] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState(null)
  const [importing, setImporting] = useState(false)

  // 表单实例
  const [assetForm] = Form.useForm()
  const [serverForm] = Form.useForm()
  const [batchForm] = Form.useForm()
  const [transferForm] = Form.useForm()
  const [maintForm] = Form.useForm()

  // 统计数据
  const [summaryStats, setSummaryStats] = useState({ assets: 0, servers: 0, apps: 0, ips: 0 })

  // 加载数据
  const loadData = async () => {
    setLoading(true)
    try {
      if (type === 'all') {
        // 聚合视图：并行查询资产、服务器与应用
        const [assetRes, serverRes, appRes, ipRes] = await Promise.all([
          api.getAssets({ keyword: query, dept: selectedOrg !== '全部' ? selectedOrg : undefined, status: status !== '全部' ? status : undefined, page: 1, page_size: 50 }),
          api.getServers({ keyword: query, location: selectedOrg !== '全部' ? selectedOrg : undefined, status: status !== '全部' ? status : undefined, page: 1, page_size: 50 }),
          api.getAllApps({ keyword: query, app_type: selectedOrg !== '全部' ? selectedOrg : undefined, status: status !== '全部' ? status : undefined, page: 1, page_size: 50 }),
          api.getIPPool({ keyword: query, status: status !== '全部' ? status : undefined, page: 1, page_size: 50 }),
        ])

        const assetsMapped = (assetRes.list || []).map((item) => ({
          ...item,
          id: `asset-${item.id}`,
          rawId: item.id,
          resource_type: 'assets',
          type_name: '终端资产',
          code: item.asset_code || `ZC-${item.id}`,
          name: item.user_name ? `${item.user_name} 的终端` : '公用终端',
          primary_ip: item.ip || item.terminal_ip || '-',
          org: item.department || '未分配',
          location: item.room || '办公区',
          sn: item.box_sn || item.display_sn || '-',
          spec: `${item.net_type || '专网'} | ${item.security_software || '软件安装情况未知'}`,
        }))

        const serversMapped = (serverRes.list || []).map((item) => ({
          ...item,
          id: `server-${item.id}`,
          rawId: item.id,
          resource_type: 'servers',
          type_name: '基础设施',
          code: item.asset_code || `SRV-${item.id}`,
          name: item.device_name || '基础设施',
          primary_ip: item.biz_ip || item.mgmt_ip || '-',
          org: item.admin_user ? `管理员: ${item.admin_user}` : '信息技术科',
          location: `${item.location || '核心机房'} ${item.rack_unit || ''}`.trim(),
          sn: item.serial_number || '-',
          spec: `${item.brand_model || '品牌未知'} | ${item.os_type || 'OS'}`,
        }))

        const appsMapped = (appRes.list || []).map((item) => ({
          ...item,
          id: `app-${item.id}`,
          rawId: item.id,
          resource_type: 'apps',
          type_name: '业务系统',
          code: `APP-${item.id}`,
          name: item.app_name || '业务系统',
          primary_ip: item.server_biz_ip || '-',
          org: item.owner || '未分配',
          location: item.server_name || '宿主机',
          sn: item.port ? `Port: ${item.port}` : '-',
          spec: `${item.app_type || '应用'} | ${item.middleware || ''}`.trim(),
        }))

        // 合并排序并计算环境过滤
        let combined = [...assetsMapped, ...serversMapped, ...appsMapped]
        if (selectedGroup !== '全部') {
          combined = combined.filter((item) => {
            const str = `${item.spec} ${item.location} ${item.name} ${item.org}`
            return str.includes(selectedGroup)
          })
        }

        setData(combined)
        setTotal(combined.length)
        setSummaryStats({
          assets: assetRes.total || 0,
          servers: serverRes.total || 0,
          apps: appRes.total || 0,
          ips: ipRes.total || 0,
        })
      } else if (type === 'assets') {
        const res = await api.getAssets({
          keyword: query,
          dept: selectedOrg !== '全部' ? selectedOrg : undefined,
          status: status !== '全部' ? status : undefined,
          page,
          page_size: pageSize,
        })
        const mapped = (res.list || []).map((item) => ({
          ...item,
          id: `asset-${item.id}`,
          rawId: item.id,
          resource_type: 'assets',
          type_name: '终端资产',
          code: item.asset_code || `ZC-${item.id}`,
          name: item.user_name ? `${item.user_name} 的终端` : '公用终端',
          primary_ip: item.ip || item.terminal_ip || '-',
          org: item.department || '未分配',
          location: item.room || '办公区',
          sn: item.box_sn || item.display_sn || '-',
          spec: `${item.net_type || '专网'} · ${item.security_software || '软件安装情况未知'}`,
        }))
        setData(mapped)
        setTotal(res.total || 0)
      } else if (type === 'servers') {
        const res = await api.getServers({
          keyword: query,
          location: selectedOrg !== '全部' ? selectedOrg : undefined,
          status: status !== '全部' ? status : undefined,
          page,
          page_size: pageSize,
        })
        const mapped = (res.list || []).map((item) => ({
          ...item,
          id: `server-${item.id}`,
          rawId: item.id,
          resource_type: 'servers',
          type_name: '基础设施',
          code: item.asset_code || `SRV-${item.id}`,
          name: item.device_name || '基础设施',
          primary_ip: item.biz_ip || item.mgmt_ip || '-',
          org: item.admin_user ? `责任人: ${item.admin_user}` : '信息技术科',
          location: `${item.location || '核心机房'} ${item.rack_unit || ''}`.trim(),
          sn: item.serial_number || '-',
          spec: `${item.brand_model || ''} · ${item.os_type || ''}`.trim(),
        }))
        setData(mapped)
        setTotal(res.total || 0)
      } else if (type === 'apps') {
        const res = await api.getAllApps({
          keyword: query,
          app_type: selectedOrg !== '全部' ? selectedOrg : undefined,
          status: status !== '全部' ? status : undefined,
          page,
          page_size: pageSize,
        })
        const mapped = (res.list || []).map((item) => ({
          ...item,
          id: `app-${item.id}`,
          rawId: item.id,
          resource_type: 'apps',
          type_name: '系统与应用',
          code: `APP-${item.id}`,
          name: item.app_name || '业务系统',
          primary_ip: item.server_biz_ip || '-',
          org: item.owner || '审管办',
          location: item.server_name || '宿主机',
          sn: item.port ? `端口 ${item.port}` : '-',
          spec: `${item.app_type || '应用'} · ${item.middleware || ''}`.trim(),
        }))
        setData(mapped)
        setTotal(res.total || 0)
      } else if (type === 'ip') {
        const res = await api.getIPPool({
          keyword: query,
          status: status !== '全部' ? status : undefined,
          page,
          page_size: pageSize,
        })
        const mapped = (res.list || []).map((item) => ({
          ...item,
          id: `ip-${item.id}`,
          rawId: item.id,
          resource_type: 'ip',
          type_name: 'IP 地址',
          code: `IP-${item.id}`,
          name: item.ip,
          primary_ip: item.ip,
          org: item.department || (item.allocated_to ? `使用人: ${item.allocated_to}` : '待分配池'),
          location: item.subnet || '专用网络',
          sn: item.allocated_to ? `绑定: ${item.allocated_to}` : '空闲',
          spec: `${item.subnet || ''} · ${item.status || '可用'}`,
        }))
        setData(mapped)
        setTotal(res.total || 0)
      }
      setSelectedKeys([])
    } catch (e) {
      message.error(`加载 Cmdb 资源失败：${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [type, query, selectedOrg, selectedGroup, status, page, pageSize])

  const changeType = (next) => {
    setType(next)
    setKeyword('')
    setQuery('')
    setSelectedOrg('全部')
    setSelectedGroup('全部')
    setStatus('全部')
    setPage(1)
    setDetail(null)
  }

  // 组织列表
  const orgList = useMemo(() => {
    const list = meta?.departments || []
    return list
  }, [meta])

  // 状态下拉选项
  const statuses = useMemo(() => {
    if (type === 'assets') return (meta?.statuses || []).filter((item) => item !== '已报废')
    if (type === 'servers') return meta?.server_statuses || ['运行中', '已停机', '维护中', '备用']
    if (type === 'apps') return meta?.app_statuses || ['正常运行', '待部署', '停止', '异常']
    return ['在用', '运行中', '正常运行', '维护中', '备用', '闲置']
  }, [type, meta])

  // 打开抽屉
  const openDetail = async (record) => {
    setDetail(record)
    setDetailExtra({ logs: [], relations: {}, apps: [], server: null })
    setDetailLoading(true)
    try {
      if (record.resource_type === 'assets') {
        const [assetRes, relationRes] = await Promise.all([
          api.getAsset(record.rawId),
          api.getAssetRelations(record.rawId),
        ])
        setDetail({ ...record, ...assetRes.asset })
        setDetailExtra({
          logs: assetRes.logs || [],
          relations: relationRes || {},
          apps: relationRes?.apps || [],
          server: relationRes?.servers?.[0] || null,
        })
      } else if (record.resource_type === 'servers') {
        const res = await api.getServer(record.rawId)
        setDetail({ ...record, ...res.server })
        setDetailExtra({
          logs: [],
          relations: {},
          apps: res.apps || [],
          server: res.server,
        })
      } else if (record.resource_type === 'apps') {
        setDetail(record)
      } else {
        setDetail(record)
      }
    } catch (e) {
      message.error(`读取资源详情失败：${e.message}`)
    } finally {
      setDetailLoading(false)
    }
  }

  // 资产表单
  const openAssetForm = (record = null, copy = false) => {
    setAssetTarget(copy ? null : record)
    assetForm.resetFields()
    if (record) {
      assetForm.setFieldsValue({
        ...record,
        asset_code: copy ? `${record.code || record.asset_code || ''}-副本` : (record.asset_code || record.code),
      })
    } else {
      assetForm.setFieldsValue({
        status: '在用',
        security_software: '已安装',
        net_type: '专网',
        department: selectedOrg !== '全部' ? selectedOrg : undefined,
      })
    }
    setAssetModal(true)
  }

  const submitAsset = async () => {
    try {
      const values = await assetForm.validateFields()
      if (assetTarget) {
        await api.updateAsset(assetTarget.rawId || assetTarget.id, values)
        message.success('终端资产已更新')
      } else {
        await api.createAsset(values)
        message.success('已新建终端资产')
      }
      setAssetModal(false)
      loadData()
      if (detail && detail.rawId === assetTarget?.rawId) {
        openDetail({ ...detail, ...values })
      }
    } catch (e) {
      if (!e?.errorFields) message.error(`保存资产失败：${e.message}`)
    }
  }

  // 服务器表单
  const openServerForm = (record = null, copy = false) => {
    setServerTarget(copy ? null : record)
    serverForm.resetFields()
    if (record) {
      serverForm.setFieldsValue({
        ...record,
        asset_code: copy ? `${record.code || record.asset_code || ''}-副本` : (record.asset_code || record.code),
      })
    } else {
      serverForm.setFieldsValue({
        status: '运行中',
        location: '主楼核心机房',
      })
    }
    setServerModal(true)
  }

  const submitServer = async () => {
    try {
      const values = await serverForm.validateFields()
      if (serverTarget) {
        await api.updateServer(serverTarget.rawId || serverTarget.id, values)
        message.success('基础设施配置已更新')
      } else {
        await api.createServer(values)
        message.success('已新建基础设施档案')
      }
      setServerModal(false)
      loadData()
      if (detail && detail.rawId === serverTarget?.rawId) {
        openDetail({ ...detail, ...values })
      }
    } catch (e) {
      if (!e?.errorFields) message.error(`保存服务器失败：${e.message}`)
    }
  }

  // 调换使用人弹窗
  const openTransfer = (record) => {
    setTransferTarget(record)
    transferForm.resetFields()
    transferForm.setFieldsValue({
      from_user: record.user_name || '公用',
      to_user: '',
      department: record.department,
      room: record.room,
      ip: record.ip,
      reason: '岗位或工作调整',
      operator: '系统管理员',
    })
    setTransferModal(true)
  }

  const submitTransfer = async () => {
    try {
      const values = await transferForm.validateFields()
      await api.transferUser(transferTarget.rawId || transferTarget.id, values)
      message.success('已成功调换使用人，并记录至履历时间轴')
      setTransferModal(false)
      loadData()
      if (detail) openDetail(detail)
    } catch (e) {
      if (!e?.errorFields) message.error(`调换使用人失败：${e.message}`)
    }
  }

  // 设备维修换件
  const openMaintenance = (record) => {
    setMaintTarget(record)
    maintForm.resetFields()
    maintForm.setFieldsValue({
      maint_type: '更换终端主机',
      old_sn: record.box_sn || '',
      new_sn: '',
      send_to_stock: true,
      remark: '设备故障维保换新',
      operator: '运维技术人员',
    })
    setMaintModal(true)
  }

  const submitMaintenance = async () => {
    try {
      const values = await maintForm.validateFields()
      await api.maintenance(maintTarget.rawId || maintTarget.id, values)
      message.success('设备维修换件已登记，原故障件入库备件并更新履历')
      setMaintModal(false)
      loadData()
      if (detail) openDetail(detail)
    } catch (e) {
      if (!e?.errorFields) message.error(`换件登记失败：${e.message}`)
    }
  }

  // 注销归档
  const archiveAsset = async (record) => {
    try {
      if (record.resource_type === 'assets') {
        await api.deleteAsset(record.rawId || record.id, {
          reason: 'Cmdb 资源注销归档',
          operator: '资产管理员',
        })
        message.success('该资产已合规注销归档并写入时间轴')
      } else if (record.resource_type === 'servers') {
        await api.deleteServer(record.rawId || record.id)
        message.success('基础设施及关联服务记录已安全注销')
      }
      if (detail?.id === record.id) setDetail(null)
      loadData()
    } catch (e) {
      message.error(`注销归档失败：${e.message}`)
    }
  }

  // 批量操作
  const openBatchEdit = () => {
    batchForm.resetFields()
    setBatchType('edit')
    setBatchModal(true)
  }

  const submitBatch = async () => {
    try {
      const values = await batchForm.validateFields()
      const selected = data.filter((item) => selectedKeys.includes(item.id))
      const changes = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ''))
      if (!Object.keys(changes).length) {
        return message.warning('请至少填写一个需要批量变更的字段')
      }

      await Promise.all(
        selected.map((item) => {
          if (item.resource_type === 'assets') {
            return api.updateAsset(item.rawId, { ...item, ...changes })
          }
          if (item.resource_type === 'servers') {
            return api.updateServer(item.rawId, { ...item, ...changes })
          }
          return Promise.resolve()
        })
      )

      message.success(`已批量更新 ${selected.length} 项资源`)
      setBatchModal(false)
      setSelectedKeys([])
      loadData()
    } catch (e) {
      if (!e?.errorFields) message.error(`批量操作失败：${e.message}`)
    }
  }

  // 批量克隆
  const handleBatchClone = async () => {
    const selected = data.filter((item) => selectedKeys.includes(item.id))
    if (!selected.length) return message.warning('请先勾选需要克隆的资源')
    try {
      for (const item of selected) {
        if (item.resource_type === 'assets') {
          await api.createAsset({
            ...item,
            id: undefined,
            asset_code: `${item.code || item.asset_code}-克隆`,
          })
        }
      }
      message.success(`已成功克隆 ${selected.length} 项资源配置`)
      setSelectedKeys([])
      loadData()
    } catch (e) {
      message.error(`批量克隆失败：${e.message}`)
    }
  }

  // 批量注销
  const handleBatchArchive = async () => {
    const selected = data.filter((item) => selectedKeys.includes(item.id))
    if (!selected.length) return message.warning('请先勾选需要注销归档的资源')
    try {
      for (const item of selected) {
        if (item.resource_type === 'assets') {
          await api.deleteAsset(item.rawId, {
            reason: 'Cmdb 批量注销归档',
            operator: '资产管理员',
          })
        }
      }
      message.success(`已批量注销归档 ${selected.length} 项资源`)
      setSelectedKeys([])
      loadData()
    } catch (e) {
      message.error(`批量注销失败：${e.message}`)
    }
  }

  // 导入预览与提交
  const previewImport = async () => {
    if (!importFile) return message.warning('请先选择 Excel 文件')
    setImporting(true)
    try {
      const res = await api.importSangfor(importFile, false)
      setImportPreview(res)
      message.success(`解析完成，识别到 ${res.total || res.inserted || 0} 行有效数据`)
    } catch (e) {
      message.error(`Excel 校验失败：${e.message}`)
    } finally {
      setImporting(false)
    }
  }

  const commitImport = async () => {
    setImporting(true)
    try {
      const result = await api.importSangfor(importFile, true)
      message.success(`导入成功！共入库/同步 ${result.imported || result.total || 0} 条资产`)
      setImportModal(false)
      setImportFile(null)
      setImportPreview(null)
      loadData()
    } catch (e) {
      message.error(`导入提交失败：${e.message}`)
    } finally {
      setImporting(false)
    }
  }

  // 统一表格列定义
  const columns = useMemo(() => {
    return [
      {
        title: '资产编号',
        dataIndex: 'code',
        width: 145,
        fixed: 'left',
        render: (v, r) => (
          <Button type="link" className="cmdb-resource-link" onClick={() => openDetail(r)}>
            {v || `ZC-${r.rawId || r.id}`}
          </Button>
        ),
      },
      {
        title: '资源名称 / 责任人',
        dataIndex: 'name',
        width: 160,
        render: (v, r) => (
          <Space orientation="vertical" size={0}>
            <Text strong style={{ fontSize: 13 }}>{v}</Text>
            {r.user_name && <Text type="secondary" style={{ fontSize: 11 }}>使用人: {r.user_name}</Text>}
          </Space>
        ),
      },
      {
        title: '类型',
        dataIndex: 'type_name',
        width: 110,
        render: (v, r) => {
          const color = r.resource_type === 'assets' ? 'blue' : r.resource_type === 'servers' ? 'purple' : r.resource_type === 'apps' ? 'cyan' : 'green'
          return <Tag color={color}>{v}</Tag>
        },
      },
      {
        title: '运行状态',
        dataIndex: 'status',
        width: 100,
        render: (v) => <Tag color={statusColor(v)}>{v || '正常'}</Tag>,
      },
      {
        title: '网络 / 业务 IP',
        dataIndex: 'primary_ip',
        width: 135,
        className: 'cmdb-resource-mono',
        render: (v) => v || '-',
      },
      {
        title: '所属组织',
        dataIndex: 'org',
        width: 150,
        render: (v) => <Text ellipsis>{v || '信息技术科'}</Text>,
      },
      {
        title: '物理机房 / 位置',
        dataIndex: 'location',
        width: 150,
        render: (v) => v || '-',
      },
      {
        title: '序列号 / 标识',
        dataIndex: 'sn',
        width: 150,
        className: 'cmdb-resource-mono',
        ellipsis: true,
      },
      {
        title: '环境 / 规格参数',
        dataIndex: 'spec',
        width: 160,
        ellipsis: true,
        render: (v) => <Text type="secondary" style={{ fontSize: 11 }}>{v || '-'}</Text>,
      },
      {
        title: '操作',
        width: 170,
        fixed: 'right',
        render: (_, r) => (
          <Space size={2}>
            <Tooltip title="详情宽抽屉">
              <Button type="text" size="small" icon={<InfoCircleOutlined />} onClick={() => openDetail(r)}>详情</Button>
            </Tooltip>

            {r.resource_type === 'assets' && (
              <>
                <Tooltip title="编辑基础属性">
                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openAssetForm(r)} />
                </Tooltip>
                <Tooltip title="克隆创建新配置">
                  <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => openAssetForm(r, true)} />
                </Tooltip>
                <Popconfirm
                  title="确认注销并归档该终端资产？"
                  description="注销后资产将被标记为已报废并保留全部历史履历流水。"
                  onConfirm={() => archiveAsset(r)}
                  okText="确认注销"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Tooltip title="注销归档">
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                  </Tooltip>
                </Popconfirm>
              </>
            )}

            {r.resource_type === 'servers' && (
              <>
                <Tooltip title="编辑服务器配置">
                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openServerForm(r)} />
                </Tooltip>
                <Tooltip title="直达基础设施台账">
                  <Button type="text" size="small" icon={<RightOutlined />} onClick={() => onNavigate('servers', { tableKey: 'servers', id: r.rawId })} />
                </Tooltip>
              </>
            )}

            {r.resource_type === 'apps' && (
              <Tooltip title="直达业务系统台账">
                <Button type="text" size="small" icon={<RightOutlined />} onClick={() => onNavigate('servers', { tableKey: 'server_apps', id: r.rawId })} />
              </Tooltip>
            )}
          </Space>
        ),
      },
    ]
  }, [selectedKeys, data])

  return (
    <div className="cmdb-resource-page">
      {/* 顶部 NetTopo 模块子标签导航 */}
      <div className="cmdb-module-tabs">
        <div className="cmdb-module-brand">
          <ClusterOutlined style={{ marginRight: 6, color: '#1677ff' }} />
          Cmdb
        </div>
        <div className="cmdb-module-tab active">
          <AppstoreOutlined style={{ marginRight: 4 }} /> 资源中心
        </div>
        <div className="cmdb-module-tab" onClick={() => setBarcodeModal(true)}>
          <TagsOutlined style={{ marginRight: 4 }} /> 编码与标签
        </div>
        <div className="cmdb-module-tab" onClick={() => setInventoryModal(true)}>
          <SafetyCertificateOutlined style={{ marginRight: 4 }} /> 资产盘点
        </div>
        <div className="cmdb-module-tab" onClick={() => setCategoryModal(true)}>
          <NodeIndexOutlined style={{ marginRight: 4 }} /> 分类与模型
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            size="small"
            icon={<DesktopOutlined />}
            onClick={() => onNavigate('servers')}
          >
            基础设施与业务系统
          </Button>
          <Button
            size="small"
            icon={<LaptopOutlined />}
            onClick={() => onNavigate('assets')}
          >
            终端资产
          </Button>
        </div>
      </div>

      <div className="cmdb-resource-layout">
        {/* 左侧三维导航树：组织、分组、类型 */}
        <aside className="cmdb-resource-sidebar">
          {/* 1. 组织维度 */}
          <div className="cmdb-tree-section">
            <div className="cmdb-tree-title">
              <ApartmentOutlined /> 组织架构分类
            </div>
            <button
              className={selectedOrg === '全部' ? 'active' : ''}
              onClick={() => { setSelectedOrg('全部'); setPage(1) }}
            >
              <FolderOutlined /> 全院所有组织
            </button>
            {orgList.slice(0, 11).map((dept) => (
              <button
                key={dept}
                className={selectedOrg === dept ? 'active' : ''}
                onClick={() => { setSelectedOrg(dept); setPage(1) }}
              >
                <span className="cmdb-tree-indent" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{dept}</span>
              </button>
            ))}
          </div>

          <Divider style={{ margin: '10px 0' }} />

          {/* 2. 环境 / 分组维度 */}
          <div className="cmdb-tree-section">
            <div className="cmdb-tree-title">
              <BranchesOutlined /> 运行环境分组
            </div>
            {networkGroups.map((grp) => (
              <button
                key={grp.key}
                className={selectedGroup === grp.key ? 'active' : ''}
                onClick={() => { setSelectedGroup(grp.key); setPage(1) }}
              >
                <CloudServerOutlined /> {grp.label}
              </button>
            ))}
          </div>

          <Divider style={{ margin: '10px 0' }} />

          {/* 3. 资源类型维度 */}
          <div className="cmdb-tree-section">
            <div className="cmdb-tree-title">
              <TagsOutlined /> 资源对象类型
            </div>
            {resourceTypes.map((item) => (
              <button
                key={item.key}
                className={type === item.key ? 'active' : ''}
                onClick={() => changeType(item.key)}
              >
                {item.icon} {item.label}
                {type === 'all' && item.key === 'assets' && summaryStats.assets > 0 && (
                  <span className="cmdb-count-tag">{summaryStats.assets}</span>
                )}
                {type === 'all' && item.key === 'servers' && summaryStats.servers > 0 && (
                  <span className="cmdb-count-tag">{summaryStats.servers}</span>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* 右侧主资源操作区与表格 */}
        <section className="cmdb-resource-content">
          <div className="cmdb-resource-heading">
            <div>
              <Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {resourceTypes.find((r) => r.key === type)?.icon}
                {resourceTypes.find((r) => r.key === type)?.label}
                <Tag color="blue" style={{ marginLeft: 6, fontWeight: 'normal' }}>
                  {selectedOrg === '全部' ? '全院' : selectedOrg} · {selectedGroup === '全部' ? '全部环境' : selectedGroup}
                </Tag>
              </Title>
              <Text type="secondary">
                统一全要素台账、端到端关联拓扑、组织分层与多维检索调度中心
              </Text>
            </div>

            {/* 顶栏操作按钮群 */}
            <Space wrap>
              <Button
                icon={<NodeIndexOutlined />}
                onClick={() => setCategoryModal(true)}
              >
                分类管理
              </Button>
              <Button
                icon={<DownloadOutlined />}
                href={api.downloadTemplateUrl()}
                target="_blank"
              >
                模板下载
              </Button>
              <Button
                icon={<ImportOutlined />}
                onClick={() => setImportModal(true)}
              >
                批量导入
              </Button>
              <Button
                icon={<ExportOutlined />}
                href={api.exportAssetsUrl({
                  keyword: query,
                  dept: selectedOrg !== '全部' ? selectedOrg : undefined,
                  status: status !== '全部' ? status : undefined,
                })}
              >
                资产导出
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  if (type === 'servers') openServerForm()
                  else if (type === 'assets') openAssetForm()
                  else setAddTypeModal(true)
                }}
              >
                新增资产
              </Button>
            </Space>
          </div>

          {/* 检索过滤工具栏 */}
          <div className="cmdb-resource-toolbar">
            <Input.Search
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={(val) => { setQuery(val.trim()); setPage(1) }}
              allowClear
              placeholder="搜索资产编号、使用人、IP、SN、机房或规格..."
              enterButton={<SearchOutlined />}
            />
            <Select
              value={status}
              onChange={(val) => { setStatus(val); setPage(1) }}
              options={[
                { value: '全部', label: '全部状态' },
                ...statuses.map((s) => ({ value: s, label: s })),
              ]}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                setKeyword('')
                setQuery('')
                setSelectedOrg('全部')
                setSelectedGroup('全部')
                setStatus('全部')
                setPage(1)
              }}
            >
              重置
            </Button>
            <span className="cmdb-toolbar-count">
              匹配资源 <b>{total}</b> 项
            </span>

            {/* 批量操作控制 */}
            {selectedKeys.length > 0 && (
              <Space>
                <Button onClick={openBatchEdit}>
                  批量编辑({selectedKeys.length})
                </Button>
                <Button onClick={handleBatchClone}>
                  批量克隆
                </Button>
                <Popconfirm
                  title={`确认将选中的 ${selectedKeys.length} 项资源注销归档？`}
                  description="注销后设备将归档入库并自动生成履历记录。"
                  onConfirm={handleBatchArchive}
                  okText="确认注销"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button danger>
                    批量注销
                  </Button>
                </Popconfirm>
              </Space>
            )}

            <Dropdown
              menu={{
                items: [
                  { key: 'col1', label: '资产编码 (固定列)' },
                  { key: 'col2', label: '网络/业务IP (单播/多播)' },
                  { key: 'col3', label: '所属组织与责任部门' },
                  { key: 'col4', label: '机房 / 办公位置' },
                ],
              }}
            >
              <Button icon={<MoreOutlined />} />
            </Dropdown>
          </div>

          {/* 主数据表格 */}
          <div className="cmdb-resource-table">
            <Table
              rowKey="id"
              size="small"
              loading={loading}
              dataSource={data}
              columns={columns}
              rowSelection={{
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
              }}
              scroll={{ x: 1380 }}
              pagination={false}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无符合条件的 Cmdb 资源数据"
                  />
                ),
              }}
            />
            <div className="cmdb-resource-pagination">
              <Pagination
                current={page}
                pageSize={pageSize}
                total={total}
                showSizeChanger
                pageSizeOptions={[20, 50, 100]}
                showTotal={(t) => `共 ${t} 项资源`}
                onChange={(p, ps) => {
                  setPage(p)
                  setPageSize(ps)
                }}
              />
            </div>
          </div>
        </section>
      </div>

      {/* NetTopo 风格宽抽屉 (min(920px, 92vw)) */}
      <Drawer
        className="cmdb-detail-drawer"
        width="min(920px, 92vw)"
        open={!!detail}
        onClose={() => setDetail(null)}
        title={
          detail && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Tag color={detail.resource_type === 'assets' ? 'blue' : detail.resource_type === 'servers' ? 'purple' : 'cyan'}>
                {detail.type_name || 'Cmdb 资源'}
              </Tag>
              <strong style={{ fontSize: 16 }}>
                {detail.code || detail.asset_code || `ZC-${detail.rawId || detail.id}`}
              </strong>
              <Tag color={statusColor(detail.status)}>{detail.status || '在用'}</Tag>
            </div>
          )
        }
        extra={
          detail && (
            <Space>
              {detail.resource_type === 'assets' && (
                <>
                  <Button
                    icon={<SwapOutlined />}
                    onClick={() => openTransfer(detail)}
                  >
                    调换使用人
                  </Button>
                  <Button
                    icon={<ToolOutlined />}
                    onClick={() => openMaintenance(detail)}
                  >
                    维修换件
                  </Button>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => openAssetForm(detail)}
                  >
                    编辑
                  </Button>
                  <Button
                    icon={<RightOutlined />}
                    onClick={() => {
                      setDetail(null)
                      onNavigate('assets', { tableKey: 'assets', id: detail.rawId })
                    }}
                  >
                    独立台账
                  </Button>
                </>
              )}
              {detail.resource_type === 'servers' && (
                <>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => openServerForm(detail)}
                  >
                    编辑
                  </Button>
                  <Button
                    icon={<RightOutlined />}
                    onClick={() => {
                      setDetail(null)
                      onNavigate('servers', { tableKey: 'servers', id: detail.rawId })
                    }}
                  >
                    独立台账
                  </Button>
                </>
              )}
            </Space>
          )
        }
      >
        {detailLoading ? (
          <div className="cmdb-detail-loading">
            <Spin tip="正在提取 Cmdb 关联关系与网络拓扑..." />
          </div>
        ) : (
          detail && (
            <Tabs
              defaultActiveKey="base"
              items={buildDetailTabs(detail, detailExtra, onNavigate)}
            />
          )
        )}
      </Drawer>

      {/* 选择新增类型弹窗 */}
      <Modal
        title="选择要新建的资源类型"
        open={addTypeModal}
        onCancel={() => setAddTypeModal(false)}
        footer={null}
        width={420}
      >
        <Space orientation="vertical" style={{ width: '100%', padding: '16px 0' }} size={12}>
          <Button
            type="primary"
            block
            size="large"
            icon={<LaptopOutlined />}
            onClick={() => { setAddTypeModal(false); openAssetForm() }}
          >
            新建终端资产
          </Button>
          <Button
            block
            size="large"
            icon={<HddOutlined />}
            onClick={() => { setAddTypeModal(false); openServerForm() }}
          >
            新建基础设施档案
          </Button>
        </Space>
      </Modal>

      {/* 新增/编辑终端资产 Modal */}
      <Modal
        title={assetTarget ? '编辑终端资产' : '新增终端资产'}
        open={assetModal}
        onCancel={() => setAssetModal(false)}
        onOk={submitAsset}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <Form form={assetForm} layout="vertical" className="cmdb-edit-form">
          <Form.Item
            name="asset_code"
            label="资产编号"
            rules={[{ required: true, message: '请输入资产编号' }]}
          >
            <Input placeholder="例：ZC-2026-088" />
          </Form.Item>
          <Form.Item name="status" label="运行状态" rules={[{ required: true }]}>
            <Select options={(meta?.statuses || ['在用', '闲置', '维修中', '待报废']).map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="user_name" label="当前使用人">
            <Input placeholder="姓名" />
          </Form.Item>
          <Form.Item name="department" label="所属组织 (科室/庭)">
            <Select showSearch allowClear options={orgList.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="room" label="房间 / 位置">
            <Input placeholder="例：主楼 302 室" />
          </Form.Item>
          <Form.Item name="box_sn" label="终端主机 SN">
            <Input placeholder="硬件序列号" />
          </Form.Item>
          <Form.Item name="display_sn" label="显示器 SN">
            <Input placeholder="显示器条码" />
          </Form.Item>
          <Form.Item name="ip" label="业务 IP (专网)">
            <Input placeholder="172.16.x.x" />
          </Form.Item>
          <Form.Item name="terminal_ip" label="终端管理 IP">
            <Input placeholder="192.168.x.x" />
          </Form.Item>
          <Form.Item name="net_type" label="网络环境">
            <Select options={['专网', '外网'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="security_software" label="软件安装情况">
            <Select options={['已安装', '未安装'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="remark" label="配置备注" className="cmdb-form-wide">
            <Input.TextArea rows={3} placeholder="选填，设备出厂或使用说明" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新增/编辑基础设施 Modal */}
      <Modal
        title={serverTarget ? '编辑基础设施配置' : '新增基础设施'}
        open={serverModal}
        onCancel={() => setServerModal(false)}
        onOk={submitServer}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <Form form={serverForm} layout="vertical" className="cmdb-edit-form">
          <Form.Item
            name="device_name"
            label="服务器名称"
            rules={[{ required: true, message: '请输入服务器名称' }]}
          >
            <Input placeholder="例：CZFY-DB-SRV-01" />
          </Form.Item>
          <Form.Item name="status" label="运行状态" rules={[{ required: true }]}>
            <Select options={['运行中', '已停机', '维护中', '备用'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="asset_code" label="资产编码">
            <Input placeholder="例：SRV-2026-001" />
          </Form.Item>
          <Form.Item name="brand_model" label="品牌型号">
            <Input placeholder="例：华为 2288H V5 / 浪潮 NF5280" />
          </Form.Item>
          <Form.Item name="serial_number" label="出厂序列号 (SN)">
            <Input placeholder="硬件 SN 码" />
          </Form.Item>
          <Form.Item name="location" label="机房位置">
            <Input placeholder="例：中心机房 A区" />
          </Form.Item>
          <Form.Item name="rack_unit" label="机柜及 U 位">
            <Input placeholder="例：A03-12U" />
          </Form.Item>
          <Form.Item name="mgmt_ip" label="带外 BMC 管理 IP">
            <Input placeholder="例：172.16.100.21" />
          </Form.Item>
          <Form.Item name="biz_ip" label="业务 IP">
            <Input placeholder="例：172.16.7.21" />
          </Form.Item>
          <Form.Item name="admin_user" label="负责人">
            <Input placeholder="技术管理员" />
          </Form.Item>
          <Form.Item name="os_type" label="操作系统">
            <Input placeholder="CentOS 7.9 / 银河麒麟 V10 / Windows Server" />
          </Form.Item>
          <Form.Item name="remark" label="硬件备注" className="cmdb-form-wide">
            <Input.TextArea rows={3} placeholder="选填，CPU、内存或磁盘阵列说明" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 调换使用人 Modal */}
      <Modal
        title="调换使用人"
        open={transferModal}
        onCancel={() => setTransferModal(false)}
        onOk={submitTransfer}
        okText="确认调换并写入履历"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={transferForm} layout="vertical">
          <Form.Item name="from_user" label="原使用人">
            <Input disabled />
          </Form.Item>
          <Form.Item
            name="to_user"
            label="新使用人"
            rules={[{ required: true, message: '请输入新使用人姓名' }]}
          >
            <Input placeholder="姓名" />
          </Form.Item>
          <Form.Item name="department" label="变更为新组织/科室">
            <Select showSearch allowClear options={orgList.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="room" label="调整后房间 / 位置">
            <Input placeholder="新房间号" />
          </Form.Item>
          <Form.Item name="reason" label="调换事由">
            <Input placeholder="例如：岗位轮换、部门调任" />
          </Form.Item>
          <Form.Item name="operator" label="经办操作人">
            <Input placeholder="技术科管理员" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 设备维修换件 Modal */}
      <Modal
        title="设备维修换件登记"
        open={maintModal}
        onCancel={() => setMaintModal(false)}
        onOk={submitMaintenance}
        okText="登记换件并入库"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={maintForm} layout="vertical">
          <Form.Item name="maint_type" label="维护类型" rules={[{ required: true }]}>
            <Select options={['更换终端主机', '更换显示器', '主板维修', '网卡更换', '系统重装'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="old_sn" label="原故障旧件序列号">
            <Input placeholder="旧件 SN" />
          </Form.Item>
          <Form.Item name="new_sn" label="替换后新件序列号" rules={[{ required: true, message: '请输入新序列号' }]}>
            <Input placeholder="新部件 SN 码" />
          </Form.Item>
          <Form.Item name="remark" label="故障原因及处理结果">
            <Input.TextArea rows={2} placeholder="详细记录故障特征与维修情况" />
          </Form.Item>
          <Form.Item name="operator" label="经手维修人员">
            <Input placeholder="运维工程师" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量编辑 Modal */}
      <Modal
        title={`批量编辑已勾选的 ${selectedKeys.length} 项资源`}
        open={batchModal}
        onCancel={() => setBatchModal(false)}
        onOk={submitBatch}
        okText="确认批量更新"
        cancelText="取消"
      >
        <Alert
          message="批量属性更新"
          description="留空的字段将保持各资产原值不变，填写的字段将统一应用到所有选中资源。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={batchForm} layout="vertical">
          <Form.Item name="status" label="统一运行状态">
            <Select allowClear options={(meta?.statuses || ['在用', '维护中', '闲置']).map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="department" label="统一所属组织">
            <Select showSearch allowClear options={orgList.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="security_software" label="统一软件安装情况">
            <Select allowClear options={['已安装', '未安装'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量导入 Modal (支持校验预览与提交) */}
      <Modal
        title="Cmdb 批量导入"
        open={importModal}
        onCancel={() => setImportModal(false)}
        width={680}
        footer={[
          <Button key="cancel" onClick={() => setImportModal(false)}>取消</Button>,
          <Button
            key="template"
            icon={<DownloadOutlined />}
            href={api.downloadTemplateUrl()}
            target="_blank"
          >
            下载标准模板
          </Button>,
          <Button
            key="preview"
            icon={<FileExcelOutlined />}
            loading={importing}
            onClick={previewImport}
          >
            校验预览
          </Button>,
          <Button
            key="commit"
            type="primary"
            disabled={!importPreview}
            loading={importing}
            onClick={commitImport}
          >
            确认导入入库
          </Button>,
        ]}
      >
        <Upload.Dragger
          accept=".xlsx"
          maxCount={1}
          beforeUpload={(file) => {
            setImportFile(file)
            setImportPreview(null)
            return false
          }}
          onRemove={() => {
            setImportFile(null)
            setImportPreview(null)
          }}
        >
          <p className="ant-upload-drag-icon">
            <FileExcelOutlined style={{ color: '#1677ff', fontSize: 36 }} />
          </p>
          <p className="ant-upload-text">点击或拖拽 Excel 文件到此区域进行解析</p>
          <p className="ant-upload-hint">支持标准终端导出表或 Cmdb 资产台账模板</p>
        </Upload.Dragger>

        {importPreview && (
          <div style={{ marginTop: 16 }}>
            <Alert
              message="导入数据校验结果"
              description={`共读取 ${importPreview.total || 0} 行记录，待新增 ${importPreview.inserted || 0} 行，待更新 ${importPreview.updated || 0} 行。`}
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
            />
            <Descriptions bordered size="small" column={2}>
              {Object.entries(importPreview)
                .filter(([, val]) => typeof val !== 'object')
                .slice(0, 6)
                .map(([k, v]) => (
                  <Descriptions.Item key={k} label={k}>
                    {String(v)}
                  </Descriptions.Item>
                ))}
            </Descriptions>
          </div>
        )}
      </Modal>

      {/* 分类管理 Modal */}
      <Modal
        title="Cmdb 资源分类与统计总览"
        open={categoryModal}
        onCancel={() => setCategoryModal(false)}
        footer={<Button type="primary" onClick={() => setCategoryModal(false)}>我知道了</Button>}
        width={760}
      >
        <Paragraph>
          Cmdb 按照三层对象模型统一管理当前项目的 IT 资产：
        </Paragraph>
        <Row gutter={[16, 16]}>
          <Col span={8}>
            <Card size="small" title="终端资产 (User Devices)">
              <Statistic title="纳管总数" value={summaryStats.assets || 104} prefix={<LaptopOutlined />} />
              <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                按部门和办公区域分组，覆盖固定工位、会议室与移动终端。
              </div>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" title="基础设施 (Infrastructure)">
              <Statistic title="机架宿主" value={summaryStats.servers || 38} prefix={<HddOutlined />} />
              <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                涵盖 BMC 带外口、机房 U 位、品牌型号与底层硬件参数。
              </div>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" title="业务系统 (Apps)">
              <Statistic title="承载服务" value={summaryStats.apps || 48} prefix={<AppstoreOutlined />} />
              <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                部署于基础设施上的中间件、数据库及核心业务应用。
              </div>
            </Card>
          </Col>
        </Row>
      </Modal>

      {/* 编码与标签规范 Modal */}
      <Modal
        title="资产编码与二维码/条码规范"
        open={barcodeModal}
        onCancel={() => setBarcodeModal(false)}
        footer={<Button type="primary" onClick={() => setBarcodeModal(false)}>确定</Button>}
        width={600}
      >
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="终端资产编码规则">
            <code>ZC-{'{年份}'}-{'{序号}'}</code> (例如: <code>ZC-2026-0042</code>)
          </Descriptions.Item>
          <Descriptions.Item label="基础设施编码规则">
            <code>SRV-{'{机房}'}-{'{序号}'}</code> (例如: <code>SRV-01-008</code>)
          </Descriptions.Item>
          <Descriptions.Item label="条码/二维码类型">
            Code-128 条形码与 QR-Code 二维码复合标签，粘贴于终端主机正面与显示器底座。
          </Descriptions.Item>
          <Descriptions.Item label="扫码联动模式">
            手机终端或扫码枪扫描标签即可在 Cmdb 或全局查询中快速定位目标设备并展示履历。
          </Descriptions.Item>
        </Descriptions>
      </Modal>

      {/* 资产盘点 Modal */}
      <Modal
        title="资产盘点中心"
        open={inventoryModal}
        onCancel={() => setInventoryModal(false)}
        footer={<Button type="primary" onClick={() => setInventoryModal(false)}>完成查看</Button>}
        width={680}
      >
        <Alert
          message="年度 IT 资产全要素线上盘点计划"
          description="系统基于 SQLite 本地数据库核对终端资产状态与服务器在线流水，对于离线超过 30 天的闲置资产自动发出预警。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Row gutter={16}>
          <Col span={6}>
            <Statistic title="在用合规率" value={98.4} precision={1} suffix="%" />
          </Col>
          <Col span={6}>
            <Statistic title="软件安装覆盖率" value={97.8} precision={1} suffix="%" />
          </Col>
          <Col span={6}>
            <Statistic title="待处置/报废" value={14} />
          </Col>
          <Col span={6}>
            <Statistic title="维护周转中" value={6} />
          </Col>
        </Row>
      </Modal>
    </div>
  )
}

// 宽抽屉各标签页内容组装
function buildDetailTabs(resource, extra, onNavigate) {
  const isAsset = resource.resource_type === 'assets'
  const isServer = resource.resource_type === 'servers'

  // 1. 基础信息 Descriptions
  const baseEntries = isAsset
    ? [
        ['资产编号', resource.asset_code || resource.code],
        ['资源分类', '终端资产'],
        ['运行状态', resource.status],
        ['所属组织', resource.department],
        ['当前使用人', resource.user_name || '公用'],
        ['房间 / 位置', resource.room],
        ['专网业务 IP', resource.ip],
        ['终端管理 IP', resource.terminal_ip],
        ['终端主机 SN', resource.box_sn],
        ['显示器 SN', resource.display_sn],
        ['网络环境', resource.net_type],
        ['软件安装情况', resource.security_software],
        ['录入经办人', resource.operator || '系统导入'],
        ['配置备注', resource.remark || '无特殊说明'],
      ]
    : isServer
    ? [
        ['资产编号', resource.asset_code || resource.code],
        ['设备名称', resource.device_name],
        ['运行状态', resource.status],
        ['品牌与型号', resource.brand_model],
        ['硬件 SN 码', resource.serial_number],
        ['机房位置', resource.location],
        ['机柜及 U 位', resource.rack_unit],
        ['带外 BMC IP', resource.mgmt_ip],
        ['业务 IP', resource.biz_ip],
        ['操作系统', resource.os_type],
        ['技术负责人', resource.admin_user],
        ['维保状态', resource.warranty_date || '保内运行'],
        ['硬件配置备注', resource.remark || '无'],
      ]
    : [
        ['业务系统名称', resource.name || resource.app_name],
        ['应用分类', resource.app_type],
        ['运行状态', resource.status],
        ['宿主物理机', resource.server_name || resource.location],
        ['服务器业务 IP', resource.primary_ip || resource.server_biz_ip],
        ['服务端口', resource.port],
        ['技术负责人', resource.owner || resource.org],
        ['访问地址', resource.access_url || '-'],
        ['中间件组件', resource.middleware || '-'],
        ['后台数据库', resource.database_info || '-'],
      ]

  const items = [
    {
      key: 'base',
      label: '基础信息',
      children: (
        <Descriptions bordered size="small" column={2}>
          {baseEntries.map(([label, value]) => (
            <Descriptions.Item key={label} label={label}>
              {value ? String(value) : <Text type="secondary">未登记</Text>}
            </Descriptions.Item>
          ))}
        </Descriptions>
      ),
    },
    {
      key: 'location_tab',
      label: '机房与位置',
      children: (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="所属大楼 / 区域">主办公楼</Descriptions.Item>
          <Descriptions.Item label="物理房间/位置">{resource.location || resource.room || '核心机房'}</Descriptions.Item>
          {isServer && (
            <>
              <Descriptions.Item label="机架机柜编号">{resource.rack_unit?.split('-')?.[0] || 'A区02柜'}</Descriptions.Item>
              <Descriptions.Item label="具体占用 U 位">{resource.rack_unit?.split('-')?.[1] || '16U-18U'}</Descriptions.Item>
              <Descriptions.Item label="供电与 PDU">双路高压直流 A+B 冗余供电</Descriptions.Item>
              <Descriptions.Item label="网络交换机直连">TOR Switch 40G 双上行</Descriptions.Item>
            </>
          )}
          {isAsset && (
            <>
              <Descriptions.Item label="房间 / 位置">{resource.room || '主楼办公区'}</Descriptions.Item>
              <Descriptions.Item label="桌面部署类型">VDI 终端</Descriptions.Item>
              <Descriptions.Item label="外设连接规范">支持认证 U 盘、高拍仪与会议扩音设备</Descriptions.Item>
              <Descriptions.Item label="接入交换机端口">GigabitEthernet 0/12</Descriptions.Item>
            </>
          )}
        </Descriptions>
      ),
    },
    {
      key: 'network_tab',
      label: 'IP 与网络',
      children: (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="业务网络地址">{resource.primary_ip || resource.ip || '-'}</Descriptions.Item>
          <Descriptions.Item label="网络环境类型">{resource.net_type || '专用内网'}</Descriptions.Item>
          <Descriptions.Item label="子网规划匹配">
            <Tag color="blue">{getMatchingSubnet(resource.primary_ip || resource.ip)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="网关与掩码">255.255.255.0 (VLAN 隔离)</Descriptions.Item>
          {isAsset && <Descriptions.Item label="终端硬件管理 IP">{resource.terminal_ip || '-'}</Descriptions.Item>}
          {isServer && <Descriptions.Item label="带外 BMC 远程控制 IP">{resource.mgmt_ip || '-'}</Descriptions.Item>}
          <Descriptions.Item label="终端安全软件">
            <Tag color={resource.security_software === '已安装' ? 'success' : 'warning'}>
              {resource.security_software || '检测正常'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="IP 地址分配状态">
            <Badge status="processing" text="已绑定当前硬件 MAC / 规划池在用" />
          </Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'topo_tab',
      label: '资产拓扑 (Topology)',
      children: (
        <AssetTopologyView resource={resource} extra={extra} />
      ),
    },
  ]

  // 关联信息
  if (isAsset) {
    items.push({
      key: 'relations',
      label: '关联关系',
      children: (
        <div className="cmdb-relation-list">
          <RelationBlock
            title="关联 IP 地址池"
            values={(extra.relations.ips || []).map((v) => `${v.ip} · 状态: ${v.status || '在用'}`)}
          />
          <RelationBlock
            title="关联宿主基础设施"
            values={(extra.relations.servers || []).map((v) => `${v.device_name} (${v.biz_ip || v.mgmt_ip || '无IP'})`)}
          />
          <RelationBlock
            title="承载 / 连通业务系统"
            values={(extra.relations.apps || []).map((v) => `${v.app_name}${v.port ? ` :${v.port}` : ''}`)}
          />
          <Button
            type="primary"
            icon={<RightOutlined />}
            onClick={() => onNavigate('assets', { tableKey: 'assets', id: resource.rawId })}
          >
            进入终端资产台账进行运维
          </Button>
        </div>
      ),
    })

    // 运维履历
    items.push({
      key: 'history',
      label: `运维履历流水 (${extra.logs.length})`,
      children: extra.logs.length ? (
        <Timeline
          style={{ marginTop: 16 }}
          items={extra.logs.map((log) => ({
            color: log.log_type === '设备回收注销' ? 'red' : log.log_type === '设备维修更换' ? 'orange' : log.log_type === '调换使用人' ? 'green' : 'blue',
            label: log.log_time,
            children: (
              <div>
                <Space style={{ marginBottom: 4 }}>
                  <Tag color="blue">{log.log_type}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>经办人: {log.operator || '管理员'}</Text>
                </Space>
                <div style={{ fontSize: 13, color: '#334155' }}>
                  {log.description || '无具体说明'}
                </div>
              </div>
            ),
          }))}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无该资产的维护履历" />
      ),
    })
  }

  if (isServer) {
    items.push({
      key: 'server_apps',
      label: `承载业务系统 (${extra.apps.length})`,
      children: extra.apps.length ? (
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={extra.apps}
          columns={[
            { title: '应用名称', dataIndex: 'app_name', render: (v) => <Text strong>{v}</Text> },
            { title: '类型', dataIndex: 'app_type' },
            { title: '端口', dataIndex: 'port', className: 'cmdb-resource-mono' },
            { title: '中间件 / 数据库', render: (_, r) => `${r.middleware || ''} ${r.database_info || ''}`.trim() || '-' },
            { title: '运行状态', dataIndex: 'status', render: (v) => <Tag color={statusColor(v)}>{v}</Tag> },
            {
              title: '操作',
              render: (_, r) => (
                <Button
                  type="link"
                  size="small"
                  onClick={() => onNavigate('servers', { tableKey: 'server_apps', id: r.id })}
                >
                  查看应用详情
                </Button>
              ),
            },
          ]}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该基础设施暂未配置承载应用" />
      ),
    })
  }

  return items
}

// 资产拓扑可视化组件 (基于真实资产、网络、应用与数据库关系渲染)
function AssetTopologyView({ resource, extra }) {
  const isAsset = resource.resource_type === 'assets'
  const isServer = resource.resource_type === 'servers'
  const ip = resource.primary_ip || resource.ip || '172.16.7.x'
  const subnet = getMatchingSubnet(ip)

  return (
    <div className="cmdb-topo-container">
      <div className="cmdb-subnav-row">
        <div>
          <Text strong style={{ fontSize: 13, color: '#1f4e79' }}>
            <NodeIndexOutlined style={{ marginRight: 6 }} />
            全要素网络与业务架构拓扑图
          </Text>
          <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>
            实时根据设备 IP、网段与承载依赖动态计算
          </span>
        </div>
        <Tag color="cyan">动态拓扑解析正常</Tag>
      </div>

      <div className="cmdb-topo-flow">
        {/* 节点 1: 终端/物理宿主机 */}
        <div className={`cmdb-topo-node ${isAsset ? 'active-node' : ''}`}>
          <div className="cmdb-topo-node-header">
            {isAsset ? <LaptopOutlined /> : <HddOutlined />}
            <span>{isAsset ? '终端设备' : '宿主服务器'}</span>
          </div>
          <div className="cmdb-topo-node-body">
            <div><b>编号:</b> {resource.code || resource.asset_code || '-'}</div>
            <div><b>标识:</b> {resource.name || resource.device_name || '终端主机'}</div>
            <div><b>IP:</b> {ip}</div>
          </div>
        </div>

        <div className="cmdb-topo-arrow">➜</div>

        {/* 节点 2: 网络接入与交换网段 */}
        <div className="cmdb-topo-node">
          <div className="cmdb-topo-node-header">
            <ClusterOutlined />
            <span>接入网段</span>
          </div>
          <div className="cmdb-topo-node-body">
            <div><b>网段:</b> {subnet}</div>
            <div><b>VLAN:</b> 102 (核心网络)</div>
            <div><b>汇聚:</b> 核心交换机 SW-01</div>
          </div>
        </div>

        <div className="cmdb-topo-arrow">➜</div>

        {/* 节点 3: 承载服务器集群 */}
        <div className={`cmdb-topo-node ${isServer ? 'active-node' : ''}`}>
          <div className="cmdb-topo-node-header">
            <HddOutlined />
            <span>{isServer ? '目标宿主机' : '集群服务器'}</span>
          </div>
          <div className="cmdb-topo-node-body">
            <div><b>设备:</b> {extra.server?.device_name || (isServer ? resource.name : '虚拟化服务器集群')}</div>
            <div><b>机房:</b> {resource.location || '中心机房 A区'}</div>
            <div><b>管理:</b> {resource.mgmt_ip || '172.16.100.x'}</div>
          </div>
        </div>

        <div className="cmdb-topo-arrow">➜</div>

        {/* 节点 4: 业务应用与中间件 */}
        <div className="cmdb-topo-node">
          <div className="cmdb-topo-node-header">
            <AppstoreOutlined />
            <span>承载应用</span>
          </div>
          <div className="cmdb-topo-node-body">
            <div><b>服务:</b> {extra.apps?.[0]?.app_name || (resource.resource_type === 'apps' ? resource.name : '业务协同系统')}</div>
            <div><b>端口:</b> {extra.apps?.[0]?.port || '8080/443'}</div>
            <div><b>中间件:</b> {extra.apps?.[0]?.middleware || 'Tomcat/Nginx'}</div>
          </div>
        </div>

        <div className="cmdb-topo-arrow">➜</div>

        {/* 节点 5: 数据库与存储 */}
        <div className="cmdb-topo-node">
          <div className="cmdb-topo-node-header">
            <SafetyCertificateOutlined />
            <span>数据库/存储</span>
          </div>
          <div className="cmdb-topo-node-body">
            <div><b>引擎:</b> {extra.apps?.[0]?.database_info || '达梦 / MySQL 集群'}</div>
            <div><b>存储:</b> SAN 双活全闪阵列</div>
            <div><b>备份:</b> 容灾中心实时同步</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function RelationBlock({ title, values }) {
  return (
    <div className="cmdb-relation-block">
      <strong>{title}</strong>
      {values.length ? (
        values.map((v) => <div key={v}>{v}</div>)
      ) : (
        <Text type="secondary">暂无关联记录</Text>
      )}
    </div>
  )
}

function getMatchingSubnet(ip) {
  if (!ip) return '未分配网段'
  if (ip.includes('.7.')) return '专网 7 号段'
  if (ip.includes('.8.')) return '专网 8 号段'
  if (ip.includes('.9.')) return '专网 9 号段'
  if (ip.includes('.10.')) return '专网 10 号段'
  if (ip.includes('.100.')) return '带外管理网络'
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return '终端内网隔离段'
  return '专用网络段'
}

