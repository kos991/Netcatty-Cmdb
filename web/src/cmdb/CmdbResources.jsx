import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Table,
  Input,
  Button,
  Select,
  Checkbox,
  Popover,
  Tooltip,
  Alert,
  Space,
  message,
  Modal,
  Form,
  Drawer,
  Descriptions,
  Tag,
  Typography,
  Dropdown,
} from 'antd'
import {
  ReloadOutlined,
  ApartmentOutlined,
  EditOutlined,
  DeleteOutlined,
  ExportOutlined,
  PlusOutlined,
  MoreOutlined,
  TeamOutlined,
  TagsOutlined,
  SearchOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  HddOutlined,
  SettingOutlined,
  SlidersOutlined,
} from '@ant-design/icons'
import { cmdbApi } from './cmdbApi'
import { buildCmdbColumns, CMDB_SORT_FIELD_MAP, CMDB_COLUMNS } from './columns'
import CmdbTaxonomy from './CmdbTaxonomy'
import DynamicFieldForm from './DynamicFieldForm'

const PAGE_SIZE_OPTIONS = ['10', '50', '100', '300']
const DEFAULT_COLUMNS = ['name', 'status', 'mgmt_ip', 'department', 'owner', 'source_type']
const SEARCH_PLACEHOLDER = '搜索资产 (名称, SN, IP...)'

const DIMENSIONS = [
  { key: 'orgs', label: '组织', param: 'org_id' },
  { key: 'groups', label: '分组', param: 'group_id' },
  { key: 'categories', label: '类型', param: 'category_id' },
]

const ASSET_FORM_SECTIONS = [
  { key: 'basic', label: '基础信息', icon: <ApartmentOutlined /> },
  { key: 'credentials', label: '凭证关联', icon: <TagsOutlined /> },
  { key: 'ownership', label: '归属与位置', icon: <TeamOutlined /> },
  { key: 'geo', label: '地理位置', icon: <ApartmentOutlined /> },
  { key: 'network', label: '网络配置', icon: <ApartmentOutlined /> },
  { key: 'power', label: '电力与规格', icon: <ApartmentOutlined /> },
  { key: 'system', label: '系统与软件', icon: <TagsOutlined /> },
  { key: 'custom', label: '自定义属性', icon: <SlidersOutlined /> },
  { key: 'other', label: '其他信息', icon: <MoreOutlined /> },
]

// 视图：按数据来源筛选。参考站的默认项是「我的资产」（依赖用户体系），
// 本项目没有用户体系，故改为按来源划分的真实视图。
const VIEWS = [
  { value: '', label: '全部资产' },
  { value: 'legacy_asset', label: '云桌面终端' },
  { value: 'legacy_server', label: '物理服务器' },
  { value: 'manual', label: '手工登记' },
]

// 批量变更语义：留空 = 不变更
function compactChanges(values) {
  const out = {}
  Object.entries(values || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    out[k] = v
  })
  return out
}

export default function CmdbResources({ meta }) {
  const [mode, setMode] = useState('orgs')
  const [cmdbMeta, setCmdbMeta] = useState({ statuses: [] })
  const [filterOptions, setFilterOptions] = useState({})
  const [taxonomy, setTaxonomy] = useState([])
  const [taxonomyList, setTaxonomyList] = useState({ orgs: [], groups: [], categories: [] })

  const [view, setView] = useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [colFilters, setColFilters] = useState({})
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_COLUMNS)
  const [selectedId, setSelectedId] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState('')
  const [sortOrder, setSortOrder] = useState('')
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [customFields, setCustomFields] = useState([])
  const [persons, setPersons] = useState([])

  useEffect(() => {
    cmdbApi.listCustomFields().then((res) => {
      if (res && res.list) setCustomFields(res.list)
    }).catch(() => {})
    cmdbApi.listPersons({ page: 1, page_size: 500 }).then((res) => {
      if (res && res.list) setPersons(res.list)
    }).catch(() => {})
  }, [])
  const [selectedRowKeys, setSelectedRowKeys] = useState([])

  const [taxOpen, setTaxOpen] = useState(false)
  const [taxPresetParent, setTaxPresetParent] = useState(null)
  const [taxAutoCreate, setTaxAutoCreate] = useState(false)
  const [taxInitialEdit, setTaxInitialEdit] = useState(null)

  const [detail, setDetail] = useState({ open: false, asset: null, interfaces: [] })

  const [assetFormOpen, setAssetFormOpen] = useState(false)
  const [assetFormMode, setAssetFormMode] = useState('edit')
  const [editingAsset, setEditingAsset] = useState(null)
  const [saving, setSaving] = useState(false)
  const [assetForm] = Form.useForm()
  const [assetFormSection, setAssetFormSection] = useState('basic')
  const assetSectionRefs = useRef({})

  const [batchOpen, setBatchOpen] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchForm] = Form.useForm()

  useEffect(() => {
    cmdbApi
      .meta()
      .then((m) => setCmdbMeta(m || {}))
      .catch((e) => message.error('加载 CMDB 元数据失败：' + e.message))
  }, [])

  const loadFilterOptions = useCallback(async () => {
    try {
      const res = await cmdbApi.assetFilters()
      setFilterOptions(res || {})
    } catch (e) {
      message.error('加载筛选项失败：' + e.message)
    }
  }, [])

  const loadTaxonomy = useCallback(
    async (k = mode) => {
      try {
        const res = await cmdbApi.listTaxonomy(k)
        setTaxonomy(res.list || [])
      } catch (e) {
        message.error('加载分类失败：' + e.message)
        setTaxonomy([])
      }
    },
    [mode],
  )

  const loadTaxonomyList = useCallback(async () => {
    try {
      const [orgs, groups, categories] = await Promise.all([
        cmdbApi.listTaxonomy('orgs'),
        cmdbApi.listTaxonomy('groups'),
        cmdbApi.listTaxonomy('categories'),
      ])
      setTaxonomyList({
        orgs: orgs.list || [],
        groups: groups.list || [],
        categories: categories.list || [],
      })
    } catch (_) {
      /* 下拉为空不影响主流程 */
    }
  }, [])

  useEffect(() => {
    loadTaxonomy(mode)
  }, [mode, loadTaxonomy])

  useEffect(() => {
    loadTaxonomyList()
    loadFilterOptions()
  }, [loadTaxonomyList, loadFilterOptions])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, page_size: pageSize }
      if (keyword) params.keyword = keyword
      if (view) params.source_type = view
      const dim = DIMENSIONS.find((d) => d.key === mode)
      if (dim && selectedId > 0) params[dim.param] = selectedId
      if (colFilters.status) params.status = colFilters.status
      if (colFilters.category_id) params.category_id = colFilters.category_id
      if (colFilters.os_type) params.os_type = colFilters.os_type
      if (colFilters.os_version) params.os_version = colFilters.os_version
      if (sortBy && sortOrder) {
        params.sort_by = sortBy
        params.sort_order = sortOrder
      }
      const res = await cmdbApi.listAssets(params)
      setRows(res.list || [])
      setTotal(res.total || 0)
    } catch (e) {
      message.error('加载 CMDB 资源失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, keyword, view, colFilters, mode, selectedId, sortBy, sortOrder])

  useEffect(() => {
    load()
  }, [load])

  const reloadAll = () => {
    load()
    loadTaxonomy()
    loadTaxonomyList()
    loadFilterOptions()
  }

  const openDetail = async (record) => {
    setDetail({ open: true, asset: record, interfaces: [] })
    try {
      const res = await cmdbApi.getAsset(record.id)
      setDetail({ open: true, asset: res.asset || record, interfaces: res.interfaces || [] })
    } catch (e) {
      message.error('加载资产详情失败：' + e.message)
    }
  }

  // ---- 单条新增 / 编辑 / 删除 / 归档 / 克隆 ----
  const openCreate = () => {
    setAssetFormMode('create')
    setEditingAsset(null)
    setAssetFormSection('basic')
    assetForm.resetFields()
    assetForm.setFieldsValue({ status: '在库' })
    setAssetFormOpen(true)
  }

  const openEdit = (record) => {
    setAssetFormMode('edit')
    setEditingAsset(record)
    setAssetFormSection('basic')
    assetForm.resetFields()
    let parsedCustom = {}
    if (record.custom_fields) {
      try {
        parsedCustom = typeof record.custom_fields === 'string' ? JSON.parse(record.custom_fields) : record.custom_fields
      } catch (err) {}
    }
    assetForm.setFieldsValue({
      name: record.name,
      status: record.status,
      department: record.department,
      owner: record.owner,
      org_id: record.org_id || 0,
      group_id: record.group_id || 0,
      category_id: record.category_id || 0,
      data_center: record.data_center,
      floor: record.floor,
      cabinet_name: record.cabinet_name,
      remark: record.remark,
      custom_fields: parsedCustom,
      owner_id: record.owner_id || 0,
    })
    setAssetFormOpen(true)
  }

  const jumpToAssetSection = (key) => {
    setAssetFormSection(key)
    window.requestAnimationFrame(() => {
      assetSectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const submitAssetForm = async () => {
    try {
      const v = await assetForm.validateFields()
      setSaving(true)
      let customFieldsStr = ''
      if (v.custom_fields && Object.keys(v.custom_fields).length > 0) {
        customFieldsStr = JSON.stringify(v.custom_fields)
      }
      if (assetFormMode === 'create') {
        await cmdbApi.createAsset({
          name: v.name,
          status: v.status || '在库',
          asset_class: 'physical',
          category_id: v.category_id || 0,
          org_id: v.org_id || 0,
          group_id: v.group_id || 0,
          department: v.department || '',
          owner: v.owner || '',
          data_center: v.data_center || '',
          floor: v.floor || '',
          cabinet_name: v.cabinet_name || '',
          remark: v.remark || '',
          custom_fields: customFieldsStr,
          owner_id: v.owner_id || 0,
        })
        message.success('已新增资产')
      } else {
        await cmdbApi.updateAsset(editingAsset.id, {
          status: v.status,
          department: v.department ?? '',
          owner: v.owner ?? '',
          org_id: v.org_id ?? 0,
          group_id: v.group_id ?? 0,
          category_id: v.category_id ?? 0,
          data_center: v.data_center ?? '',
          floor: v.floor ?? '',
          cabinet_name: v.cabinet_name ?? '',
          remark: v.remark ?? '',
          custom_fields: customFieldsStr,
          owner_id: v.owner_id || 0,
        })
        message.success(editingAsset.source_id > 0 ? '已保存，并同步写回源台账' : '已保存')
      }
      setAssetFormOpen(false)
      reloadAll()
    } catch (e) {
      if (e?.errorFields) return
      message.error('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const doArchive = (record) => {
    Modal.confirm({
      title: `确认注销归档「${record.name}」？`,
      content:
        '注销归档会保留资产资料和履历，并将状态置为「报废」；来自旧台账的记录会同步更新源台账状态。',
      okText: '注销归档',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await cmdbApi.batchAssets([record.id], 'archive')
          message.success('已注销归档')
          reloadAll()
        } catch (e) {
          message.error('归档失败：' + e.message)
          throw e
        }
      },
    })
  }

  // ---- 批量操作 ----
  const requireSelection = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先勾选要操作的资产')
      return false
    }
    return true
  }

  const openBatchEdit = () => {
    if (!requireSelection()) return
    batchForm.resetFields()
    setBatchOpen(true)
  }

  const submitBatchEdit = async () => {
    try {
      const values = await batchForm.validateFields()
      const changes = compactChanges(values)
      if (Object.keys(changes).length === 0) {
        message.warning('请至少填写一个需要批量变更的字段')
        return
      }
      setBatchBusy(true)
      const res = await cmdbApi.batchAssets(selectedRowKeys, 'edit', changes)
      message.success(`已批量更新 ${res.affected} 条资产（映射来的记录已同步写回源台账）`)
      setBatchOpen(false)
      setSelectedRowKeys([])
      reloadAll()
    } catch (e) {
      if (e?.errorFields) return
      message.error('批量编辑失败：' + e.message)
    } finally {
      setBatchBusy(false)
    }
  }

  // 注销归档保留资产资料与履历，不执行物理删除。
  const doBatchDelete = () => {
    if (!requireSelection()) return
    Modal.confirm({
      title: `确认删除所选的 ${selectedRowKeys.length} 条资产？`,
      width: 520,
      content:
        '按本项目规则，删除采用「注销归档」：记录与履历都会保留，状态置为「报废」，不会物理删除；来自旧台账的记录其源台账状态会同步更新。',
      okText: '注销归档',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await cmdbApi.batchAssets(selectedRowKeys, 'archive')
          message.success(`已注销归档 ${res.affected} 条资产`)
          setSelectedRowKeys([])
          reloadAll()
        } catch (e) {
          message.error('注销归档失败：' + e.message)
          throw e
        }
      },
    })
  }

  // ---- 分类管理入口 ----
  const openTaxonomy = () => {
    setTaxPresetParent(null)
    setTaxAutoCreate(false)
    setTaxInitialEdit(null)
    setTaxOpen(true)
  }

  const handleTreeAdd = (parentId) => {
    setTaxPresetParent(parentId)
    setTaxAutoCreate(true)
    setTaxInitialEdit(null)
    setTaxOpen(true)
  }

  const handleTreeEdit = (node) => {
    setTaxPresetParent(null)
    setTaxAutoCreate(false)
    setTaxInitialEdit(node)
    setTaxOpen(true)
  }

  const handleTreeDelete = (node) => {
    Modal.confirm({
      title: `确认删除「${node.name}」？`,
      content: '若有子节点或已被资产引用，系统会拒绝删除并说明原因。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await cmdbApi.deleteTaxonomy(mode, node.id)
          message.success('已删除')
          if (selectedId === node.id) setSelectedId(0)
          reloadAll()
        } catch (e) {
          message.error(e.message)
          throw e
        }
      },
    })
  }

  const columns = useMemo(() => {
    const base = buildCmdbColumns({ filterOptions, customFields })
    const sourceColumn = { title: '资源类型', dataIndex: 'source_type', width: 120,
      render: (value) => VIEWS.find((item) => item.value === value)?.label || '手工登记' }
    const ordered = [...visibleColumns.map((key) => key === 'source_type' ? sourceColumn : base.find((col) => col.dataIndex === key)).filter(Boolean), base.find((col) => col.key === 'action')]
    return ordered.map((col) => {
      if (col.dataIndex === 'name') return { ...col, title: '资源名称 / 资产编号', width: 240, fixed: undefined,
        render: (_, rec) => <div className="ledger-identity"><span className={`ledger-device ${rec.source_type === 'legacy_server' ? 'server' : ''}`}>{rec.source_type === 'legacy_server' ? <HddOutlined /> : <DesktopOutlined />}</span><div><button type="button" onClick={() => openDetail(rec)}>{rec.name}</button><small>{rec.asset_code || '未编号'}</small></div></div> }
      if (col.dataIndex === 'status') return { ...col, width: 100, filteredValue: colFilters.status ? [colFilters.status] : null,
        render: (value) => <span className={`ledger-status ${value === '在线' ? 'online' : value === '报废' || value === '故障' ? 'fault' : 'other'}`}><i />{value || '未设置'}</span> }
      if (col.dataIndex === 'mgmt_ip') return { ...col, title: '管理 IP', width: 145, render: (v) => <span className="ledger-ip">{v || '-'}</span> }
      if (col.key !== 'action') return col
      return {
        ...col,
        width: 100,
        fixed: undefined,
        render: (_, rec) => (
          <Space size={2}>
            <Button type="link" size="small" onClick={() => openEdit(rec)}>
              编辑
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'detail', label: '详情' },
                  { key: 'archive', label: '注销归档', danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === 'detail') openDetail(rec)
                   if (key === 'archive') doArchive(rec)
                },
              }}
            >
              <Button aria-label="更多资产操作" type="text" size="small" icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        ),
      }
    })
  }, [filterOptions, visibleColumns, colFilters, openDetail, openEdit, doArchive, customFields])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await cmdbApi.syncLegacy()
      message.success(
        `同步完成：终端 ${res.asset_inserted} 条，服务器 ${res.server_inserted} 条，跳过 ${res.skipped} 条`,
      )
      setPage(1)
      reloadAll()
    } catch (e) {
      message.error('同步旧台账失败：' + e.message)
    } finally {
      setSyncing(false)
    }
  }

  const exportParams = () => {
    const p = {}
    if (keyword) p.keyword = keyword
    if (view) p.source_type = view
    const dim = DIMENSIONS.find((d) => d.key === mode)
    if (dim && selectedId > 0) p[dim.param] = selectedId
    if (colFilters.status) p.status = colFilters.status
    if (colFilters.category_id) p.category_id = colFilters.category_id
    if (colFilters.os_type) p.os_type = colFilters.os_type
    if (colFilters.os_version) p.os_version = colFilters.os_version
    if (sortBy && sortOrder) {
      p.sort_by = sortBy
      p.sort_order = sortOrder
    }
    return p
  }

  const dimOptions = (list) =>
    [{ value: 0, label: '（未设置）' }].concat((list || []).map((n) => ({ value: n.id, label: n.name })))

  return (
    <div className="resource-ledger">
      <section className="ledger-main">
        <div className="ledger-breadcrumb">CMDB<span>/</span>资源总账</div>
        <header className="ledger-heading">
          <div><h2>资源总账</h2><span className="ledger-total">{total.toLocaleString()} 项</span></div>
          <Space>
            <Button icon={<ExportOutlined />} href={cmdbApi.exportAssetsUrl({...exportParams(),format:'xlsx'})}>导出</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增资产</Button>
          </Space>
        </header>
        <div className="ledger-filterbar">
          <Input.Search aria-label="搜索资源" allowClear placeholder="搜索名称、编号、SN、IP" value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onSearch={(value) => { setKeyword(value.trim()); setPage(1) }} />
          <Select aria-label="资产状态" allowClear placeholder="全部状态" value={colFilters.status || undefined}
            options={(cmdbMeta.statuses || []).map((s) => ({value:s,label:s}))}
            onChange={(value) => {setColFilters((prev) => ({...prev,status:value || ''}));setPage(1)}} />
          <Popover trigger="click" placement="bottom" title="更多筛选" content={<div className="ledger-more-filters">
            <label>资源来源<Select allowClear placeholder="全部来源" value={view || undefined} options={VIEWS.filter((item) => item.value).map((item) => ({value:item.value,label:item.label}))} onChange={(value) => {setView(value || '');setPage(1)}} /></label>
            <label>组织<Select allowClear placeholder="全部组织" value={mode === 'orgs' && selectedId ? selectedId : undefined} options={taxonomyList.orgs.map((n) => ({value:n.id,label:n.name}))} onChange={(id) => {setMode('orgs');setSelectedId(id || 0);setPage(1)}} /></label>
            <label>分组<Select allowClear placeholder="全部分组" value={mode === 'groups' && selectedId ? selectedId : undefined} options={taxonomyList.groups.map((n) => ({value:n.id,label:n.name}))} onChange={(id) => {setMode('groups');setSelectedId(id || 0);setPage(1)}} /></label>
            <label>设备分类<Select allowClear placeholder="全部分类" value={colFilters.category_id || undefined} options={taxonomyList.categories.map((n) => ({value:n.id,label:n.name}))} onChange={(id) => {setColFilters((prev) => ({...prev,category_id:id || ''}));setPage(1)}} /></label>
            <Button type="link" icon={<SettingOutlined />} onClick={openTaxonomy}>管理分类</Button>
          </div>}><Button>更多筛选</Button></Popover>
          <Button type="text" onClick={() => {setKeyword('');setKeywordInput('');setColFilters({});setSelectedId(0);setPage(1)}}>重置</Button>
          <div className="ledger-toolbar-end">
            <Tooltip title="刷新"><Button aria-label="刷新资源" icon={<ReloadOutlined />} onClick={reloadAll} /></Tooltip>
            <Popover trigger="click" placement="bottomRight" title="显示字段" content={<Checkbox.Group className="ledger-column-picker" value={visibleColumns} onChange={setVisibleColumns} options={[
              ...CMDB_COLUMNS.filter((c) => c.dataIndex && c.dataIndex !== 'monitor_status').map((c) => ({label:c.title,value:c.dataIndex,disabled:c.dataIndex === 'name'})),
              {label:'资源类型',value:'source_type'},
              ...(customFields || []).map((cf) => ({ label: `[自定义] ${cf.field_name}`, value: cf.field_key })),
            ]} />}>
              <Tooltip title="显示字段"><Button aria-label="显示字段" icon={<SettingOutlined />} /></Tooltip>
            </Popover>
            <Dropdown menu={{items:[{key:'sync',label:'同步已有台账'}],onClick:handleSync}}>
              <Button aria-label="台账工具" icon={<MoreOutlined />} loading={syncing} />
            </Dropdown>
          </div>
        </div>
        {selectedRowKeys.length > 0 && <div className="ledger-selection"><strong>已选 {selectedRowKeys.length} 项</strong>
          <Button size="small" icon={<EditOutlined />} onClick={openBatchEdit}>批量编辑</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={doBatchDelete}>注销归档</Button>
          <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
        </div>}
        <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 940 }}
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            onChange={(pagination, filters, sorter, extra) => {
              if (extra.action === 'paginate') return
              const field = Array.isArray(sorter) ? sorter[0]?.field : sorter?.field
              const order = Array.isArray(sorter) ? sorter[0]?.order : sorter?.order
              const backendField = field ? CMDB_SORT_FIELD_MAP[field] : undefined
              if (backendField && order) {
                setSortBy(backendField)
                setSortOrder(order === 'ascend' ? 'asc' : 'desc')
              } else {
                setSortBy('')
                setSortOrder('')
              }
              const pick = (k) => {
                const v = filters?.[k]
                return Array.isArray(v) ? v[0] : v
              }
              setColFilters({
                status: pick('status') || '',
                category_id: pick('category_id') || '',
                os_type: pick('os_type') || '',
                os_version: pick('os_version') || '',
              })
              setPage(1)
            }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              showQuickJumper: true,
              showTotal: (t, range) =>
                `第 ${range[0]}–${range[1]} 项，共 ${t} 项`,
              onChange: (p, ps) => {
                setPage(p)
                if (ps && ps !== pageSize) setPageSize(ps)
              },
            }}
          />
      </section>

      {/* ===== 资产详情抽屉 ===== */}
      <Drawer
        title={detail.asset ? detail.asset.name : '资产详情'}
        width={560}
        open={detail.open}
        onClose={() => setDetail({ open: false, asset: null, interfaces: [] })}
      >
        {detail.asset ? (
          <>
            <Descriptions column={1} size="small" bordered title="基础信息">
              <Descriptions.Item label="资产编号">{detail.asset.asset_code || '-'}</Descriptions.Item>
              <Descriptions.Item label="设备名称">{detail.asset.name}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag>{detail.asset.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="设备分类">{detail.asset.category_name || '未分类'}</Descriptions.Item>
              <Descriptions.Item label="序列号">{detail.asset.sn || '-'}</Descriptions.Item>
              <Descriptions.Item label="厂商 / 型号">
                {[detail.asset.vendor, detail.asset.model].filter(Boolean).join(' ') || '-'}
              </Descriptions.Item>
            </Descriptions>

            <Descriptions column={1} size="small" bordered title="组织归属" style={{ marginTop: 16 }}>
              <Descriptions.Item label="所属组织">{detail.asset.org_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="所属分组">{detail.asset.group_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="所属部门">{detail.asset.department || '-'}</Descriptions.Item>
              <Descriptions.Item label="负责人">{detail.asset.owner || '-'}</Descriptions.Item>
            </Descriptions>

            <Descriptions column={1} size="small" bordered title="位置与规格" style={{ marginTop: 16 }}>
              <Descriptions.Item label="数据中心">{detail.asset.data_center || '-'}</Descriptions.Item>
              <Descriptions.Item label="楼层">{detail.asset.floor || '-'}</Descriptions.Item>
              <Descriptions.Item label="机柜名称">{detail.asset.cabinet_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="起始U位 / 高度">
                {detail.asset.start_u || 0}U / {detail.asset.height_u || 1}U
              </Descriptions.Item>
              <Descriptions.Item label="电源类型 / 冗余">
                {detail.asset.power_type || '-'} / {detail.asset.redundant_power ? '是' : '否'}
              </Descriptions.Item>
              <Descriptions.Item label="额定 / 最大功耗">
                {detail.asset.rated_power_w || 0}W / {detail.asset.max_power_w || 0}W
              </Descriptions.Item>
              <Descriptions.Item label="重量">{detail.asset.weight_kg || 0} kg</Descriptions.Item>
            </Descriptions>

            <Descriptions column={1} size="small" bordered title="网络接口" style={{ marginTop: 16 }}>
              {detail.interfaces.length === 0 ? (
                <Descriptions.Item label="接口">该资产暂无网络接口</Descriptions.Item>
              ) : (
                detail.interfaces.map((it) => (
                  <Descriptions.Item key={it.id} label={it.is_primary ? '主接口' : it.if_name || '接口'}>
                    {it.ip || '-'}
                    {it.net_zone ? `（${it.net_zone}）` : ''}
                    {it.remark ? ` · ${it.remark}` : ''}
                  </Descriptions.Item>
                ))
              )}
            </Descriptions>

            <Descriptions column={1} size="small" bordered title="来源" style={{ marginTop: 16 }}>
              <Descriptions.Item label="数据来源">
                {detail.asset.source_type === 'legacy_asset' ? (
                  <Tag color="blue">云桌面终端台账（映射）</Tag>
                ) : detail.asset.source_type === 'legacy_server' ? (
                  <Tag color="purple">物理服务器与应用（映射）</Tag>
                ) : (
                  <Tag color="green">CMDB 手工登记</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="备注">{detail.asset.remark || '-'}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{detail.asset.updated_at || '-'}</Descriptions.Item>
            </Descriptions>
          </>
        ) : null}
      </Drawer>

      {/* ===== 新增 / 编辑资产 ===== */}
      <Modal
        title={assetFormMode === 'create' ? '新增资产' : `编辑资产「${editingAsset?.name || ''}」`}
        open={assetFormOpen}
        onOk={submitAssetForm}
        onCancel={() => setAssetFormOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={940}
        destroyOnClose
        className="cmdb-asset-editor-modal"
      >
        <div className="cmdb-asset-editor">
          <nav className="cmdb-asset-editor-nav" aria-label="资产信息分区">
            <div className="cmdb-asset-editor-nav-caption">资产信息</div>
            {ASSET_FORM_SECTIONS.map((section) => (
              <button
                key={section.key}
                type="button"
                className={assetFormSection === section.key ? 'active' : ''}
                onClick={() => jumpToAssetSection(section.key)}
              >
                {section.icon}
                <span>{section.label}</span>
              </button>
            ))}
          </nav>

          <div className="cmdb-asset-editor-content">
            <Form form={assetForm} layout="vertical">
              <section ref={(el) => { assetSectionRefs.current.basic = el }} className="cmdb-form-section">
                <div className="cmdb-form-section-title">基础信息</div>
                <div className="cmdb-form-grid cmdb-form-grid-2">
                  <Form.Item name="name" label="设备名称" rules={[{ required: true, message: '请填写设备名称' }]}>
                    <Input placeholder="如 302室云桌面" allowClear />
                  </Form.Item>
                  <Form.Item name="status" label="状态">
                    <Select options={(cmdbMeta.statuses || []).map((s) => ({ value: s, label: s }))} />
                  </Form.Item>
                  <Form.Item name="category_id" label="设备分类">
                    <Select showSearch optionFilterProp="label" options={dimOptions(taxonomyList.categories)} />
                  </Form.Item>
                  <div className="cmdb-readonly-field">
                    <div className="cmdb-readonly-field-label">资产编号</div>
                    <div className="cmdb-readonly-field-value">{editingAsset?.asset_code || '保存后由资产标签或源台账提供'}</div>
                  </div>
                </div>
                <div className="cmdb-readonly-note">
                  序列号：{editingAsset?.sn || '-'}　·　厂商：{editingAsset?.vendor || '-'}　·　型号：{editingAsset?.model || '-'}
                </div>
              </section>

              <section ref={(el) => { assetSectionRefs.current.credentials = el }} className="cmdb-form-section">
                <div className="cmdb-form-section-title">凭证关联</div>
                <Alert
                  type="info"
                  showIcon
                  message="凭证不在资产编辑表单中直接录入"
                  description="可在 CMDB「凭证中心」维护 SSH、Web 等凭证，并通过资产编号关联；密码等敏感信息不会在普通资产页面展示。"
                />
              </section>

              <section ref={(el) => { assetSectionRefs.current.ownership = el }} className="cmdb-form-section">
                <div className="cmdb-form-section-title">归属与位置</div>
                <div className="cmdb-form-grid cmdb-form-grid-2">
                  <Form.Item name="org_id" label="所属组织">
                    <Select showSearch optionFilterProp="label" options={dimOptions(taxonomyList.orgs)} />
                  </Form.Item>
                  <Form.Item name="group_id" label="所属分组">
                    <Select showSearch optionFilterProp="label" options={dimOptions(taxonomyList.groups)} />
                  </Form.Item>
                  <Form.Item name="department" label="所属部门">
                    <Input allowClear />
                  </Form.Item>
                  <Form.Item name="owner" label="负责人">
                    <Select
                      showSearch
                      allowClear
                      placeholder="选择人员或输入负责人"
                      filterOption={(input, opt) => (opt?.label || '').toLowerCase().includes(input.toLowerCase())}
                      options={persons.map((p) => ({
                        value: p.name,
                        label: `${p.name} (${p.department || '未分配部门'})`,
                        person: p,
                      }))}
                      onChange={(val, opt) => {
                        if (opt?.person) {
                          assetForm.setFieldsValue({
                            department: opt.person.department,
                            owner_id: opt.person.id,
                          })
                        }
                      }}
                    />
                  </Form.Item>
                  <Form.Item name="owner_id" hidden>
                    <Input />
                  </Form.Item>
                  <Form.Item name="data_center" label="所属数据中心">
                    <Input allowClear />
                  </Form.Item>
                  <Form.Item name="floor" label="楼层">
                    <Input allowClear />
                  </Form.Item>
                  <Form.Item name="cabinet_name" label="机柜名称">
                    <Input allowClear />
                  </Form.Item>
                </div>
              </section>

              <section ref={(el) => { assetSectionRefs.current.geo = el }} className="cmdb-form-section">
                <div className="cmdb-form-section-title">地理位置</div>
                <div className="cmdb-info-grid">
                  <span>省 / 市 / 区</span><strong>{[editingAsset?.province, editingAsset?.city, editingAsset?.district].filter(Boolean).join(' / ') || '-'}</strong>
                  <span>详细地址</span><strong>{editingAsset?.address || '-'}</strong>
                  <span>经纬度</span><strong>{editingAsset ? `${editingAsset.longitude || 0}, ${editingAsset.latitude || 0}` : '-'}</strong>
                </div>
                <div className="cmdb-readonly-note">地理位置字段当前由资产导入与接口同步维护，编辑页暂不覆盖写入。</div>
              </section>

              <section ref={(el) => { assetSectionRefs.current.network = el }} className="cmdb-form-section">
                <div className="cmdb-form-section-title">网络配置</div>
                <div className="cmdb-info-grid">
                  <span>管理 IP</span><strong>{editingAsset?.mgmt_ip || '-'}</strong>
                  <span>MAC 地址</span><strong>{editingAsset?.mac || '-'}</strong>
                  <span>网络接口</span><strong>{editingAsset ? '请在资产详情中查看接口明细' : '保存资产后关联接口'}</strong>
                </div>
              </section>

              <section ref={(el) => { assetSectionRefs.current.power = el }} className="cmdb-form-section">
                <div className="cmdb-form-section-title">电力与规格</div>
                <div className="cmdb-info-grid">
                  <span>端口数量</span><strong>{editingAsset?.port_count || 0}</strong>
                  <span>额定 / 最大功耗</span><strong>{editingAsset ? `${editingAsset.rated_power_w || 0}W / ${editingAsset.max_power_w || 0}W` : '-'}</strong>
                  <span>电源类型 / 冗余</span><strong>{editingAsset ? `${editingAsset.power_type || '-'} / ${editingAsset.redundant_power ? '是' : '否'}` : '-'}</strong>
                  <span>重量</span><strong>{editingAsset ? `${editingAsset.weight_kg || 0} kg` : '-'}</strong>
                </div>
              </section>

              <section ref={(el) => { assetSectionRefs.current.system = el }} className="cmdb-form-section">
                <div className="cmdb-form-section-title">系统与软件</div>
                <div className="cmdb-info-grid">
                  <span>操作系统</span><strong>{[editingAsset?.os_type, editingAsset?.os_version].filter(Boolean).join(' ') || '-'}</strong>
                  <span>安装日期</span><strong>{editingAsset?.install_date || '-'}</strong>
                  <span>保修到期</span><strong>{editingAsset?.warranty_date || '-'}</strong>
                </div>
              </section>

              <section ref={(el) => { assetSectionRefs.current.custom = el }} className="cmdb-form-section">
                <div className="cmdb-form-section-title">自定义属性</div>
                <DynamicFieldForm customFields={customFields} assetClass="all" />
              </section>

              <section ref={(el) => { assetSectionRefs.current.other = el }} className="cmdb-form-section">
                <div className="cmdb-form-section-title">其他信息</div>
                <Form.Item name="remark" label="备注">
                  <Input.TextArea rows={4} placeholder="记录资产补充说明" />
                </Form.Item>
                {assetFormMode === 'edit' ? (
                  <div className="cmdb-info-grid cmdb-info-grid-muted">
                    <span>数据来源</span><strong>{editingAsset?.source_type === 'legacy_asset' ? '云桌面终端台账（映射）' : editingAsset?.source_type === 'legacy_server' ? '物理服务器与应用（映射）' : 'CMDB 手工登记'}</strong>
                    <span>更新时间</span><strong>{editingAsset?.updated_at || '-'}</strong>
                  </div>
                ) : null}
              </section>
            </Form>
          </div>
        </div>
        {assetFormMode === 'edit' && editingAsset?.source_id > 0 ? (
          <Alert
            type="warning"
            showIcon
            message="该记录由旧台账映射而来"
            description="部门 / 负责人 / 状态 / 备注的修改会同步写回源台账；留空不会清空源台账（如需清空请到源台账中操作）。所属组织 / 分组 / 分类 / 数据中心 / 楼层 / 机柜仅保存在 CMDB。"
          />
        ) : null}
      </Modal>

      {/* ===== 批量编辑 ===== */}
      <Modal
        title={`批量编辑（已选 ${selectedRowKeys.length} 条）`}
        open={batchOpen}
        onOk={submitBatchEdit}
        onCancel={() => setBatchOpen(false)}
        confirmLoading={batchBusy}
        okText="应用到所选"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          只填写需要变更的字段，留空的字段保持不变。部门 / 负责人 / 状态 / 备注会同步写回源台账。
        </Typography.Paragraph>
        <Form form={batchForm} layout="vertical">
          <Form.Item name="status" label="状态">
            <Select allowClear options={(cmdbMeta.statuses || []).map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="org_id" label="所属组织">
            <Select allowClear showSearch optionFilterProp="label" options={dimOptions(taxonomyList.orgs)} />
          </Form.Item>
          <Form.Item name="group_id" label="所属分组">
            <Select allowClear showSearch optionFilterProp="label" options={dimOptions(taxonomyList.groups)} />
          </Form.Item>
          <Form.Item name="category_id" label="设备分类">
            <Select allowClear showSearch optionFilterProp="label" options={dimOptions(taxonomyList.categories)} />
          </Form.Item>
          <Form.Item name="department" label="所属部门">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="owner" label="负责人">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="data_center" label="所属数据中心">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="floor" label="楼层">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="cabinet_name" label="机柜名称">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <CmdbTaxonomy
        open={taxOpen}
        kind={mode}
        presetParent={taxPresetParent}
        autoCreate={taxAutoCreate}
        initialEdit={taxInitialEdit}
        onClose={() => {
          setTaxOpen(false)
          setTaxInitialEdit(null)
          setTaxAutoCreate(false)
        }}
        onChanged={reloadAll}
      />
    </div>
  )
}
