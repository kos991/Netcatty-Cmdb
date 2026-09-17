import React from 'react'
import { Tag } from 'antd'

// 状态取色
const STATUS_COLORS = {
  在线: 'success',
  在用: 'success',
  运行中: 'success',
  在库: 'processing',
  闲置: 'default',
  维护中: 'warning',
  维保: 'warning',
  维修中: 'warning',
  报废: 'error',
  下线: 'error',
  离线: 'error',
  故障: 'error',
}

function renderEmpty(value) {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

// 包含标准 42 字段 + 融合特有字段的基础全景列配置
export const CMDB_BASE_COLUMNS = [
  { title: '资产编号', dataIndex: 'asset_code', width: 140, fixed: 'left', sorter: true },
  { title: '资产名称', dataIndex: 'name', width: 160, fixed: 'left', sorter: true },
  { title: '状态', dataIndex: 'status', width: 100, filterKey: 'status' },
  { title: '资产大类', dataIndex: 'asset_class', width: 110, filterKey: 'asset_class' },
  { title: '设备分类', dataIndex: 'device_type', width: 120, filterKey: 'device_type' },
  { title: '管理IP', dataIndex: 'manage_ip', width: 130 },
  { title: '业务IP', dataIndex: 'biz_ip', width: 130 },
  { title: '公网IP', dataIndex: 'public_ip', width: 130 },
  { title: '序列号(SN)', dataIndex: 'sn', width: 150 },
  { title: '终端主机 SN', dataIndex: 'box_sn', width: 140 },
  { title: '显示器SN', dataIndex: 'display_sn', width: 130 },
  { title: 'MAC地址', dataIndex: 'mac_address', width: 140 },
  { title: '所属组织', dataIndex: 'organization', width: 130, sorter: true },
  { title: '所属分组', dataIndex: 'group_name', width: 120 },
  { title: '部门', dataIndex: 'department', width: 130 },
  { title: '负责人', dataIndex: 'owner', width: 100 },
  { title: '房间/工位', dataIndex: 'room', width: 120 },
  { title: '厂商', dataIndex: 'vendor', width: 100 },
  { title: '型号', dataIndex: 'model', width: 140 },
  { title: 'CPU核心(vCPU)', dataIndex: 'vcpu', width: 110 },
  { title: '内存(MB)', dataIndex: 'memory_mb', width: 110 },
  { title: 'CPU详情', dataIndex: 'cpu_info', width: 140 },
  { title: '磁盘配置', dataIndex: 'disk_info', width: 140 },
  { title: '操作系统', dataIndex: 'os_type', width: 120, filterKey: 'os_type' },
  { title: '系统版本', dataIndex: 'os_version', width: 130 },
  { title: '安防桌管软件', dataIndex: 'security_software', width: 130 },
  { title: '网络密级', dataIndex: 'net_type', width: 110 },
  { title: '数据中心/区域', dataIndex: 'area', width: 120 },
  { title: '楼层', dataIndex: 'floor', width: 80 },
  { title: '机柜名称', dataIndex: 'cabinet_name', width: 110 },
  { title: '机柜位置', dataIndex: 'cabinet_pos', width: 110 },
  { title: '机架U位', dataIndex: 'rack_unit', width: 100 },
  { title: '高度(U)', dataIndex: 'u_height', width: 80 },
  { title: '起始U位', dataIndex: 'u_start', width: 90 },
  { title: '端口数量', dataIndex: 'port_count', width: 90 },
  { title: '电源类型', dataIndex: 'power_type', width: 100 },
  { title: '冗余电源', dataIndex: 'redundant_power', width: 90 },
  { title: '安装日期', dataIndex: 'purchase_at', width: 110, sorter: true },
  { title: '保修日期', dataIndex: 'warranty_at', width: 110, sorter: true },
  { title: '云厂商/提供商', dataIndex: 'provider', width: 120 },
  { title: '地域/可用区', dataIndex: 'region_zone', width: 130 },
  { title: '实例规格', dataIndex: 'instance_type', width: 130 },
  { title: '带外BMC控制台', dataIndex: 'mgmt_url', width: 140 },
  { title: '标签', dataIndex: 'tags', width: 120 },
  { title: '操作', key: 'action', width: 170, fixed: 'right' },
]

export const CMDB_COLUMNS = CMDB_BASE_COLUMNS

export const CMDB_SORT_FIELD_MAP = {
  asset_code: 'asset_code',
  name: 'name',
  status: 'status',
  asset_class: 'asset_class',
  organization: 'organization',
  os_type: 'os_type',
  manage_ip: 'manage_ip',
  purchase_at: 'purchase_at',
  warranty_at: 'warranty_at',
  updated_at: 'updated_at',
}

function buildFilters(col, filterOptions) {
  const opt = filterOptions || {}
  const toOptions = (arr) => (arr || []).map((v) => ({ text: v, value: v }))
  switch (col.filterKey) {
    case 'status':
      return toOptions(opt.statuses || ['在用', '在线', '闲置', '维保', '报废'])
    case 'asset_class':
      return toOptions(opt.asset_classes || ['physical', 'virtual', 'desktop', 'network'])
    case 'os_type':
      return toOptions(opt.os_types || ['统信UOS', '银河麒麟', 'CentOS', 'Windows'])
    default:
      return null
  }
}

export function buildCmdbColumns({ filterOptions, customFields = [] } = {}) {
  const baseCols = CMDB_BASE_COLUMNS.map((col) => {
    const next = { ...col }

    const filters = buildFilters(col, filterOptions)
    if (filters && filters.length) {
      next.filters = filters
      next.filterMultiple = false
    } else {
      delete next.filterKey
    }

    if (col.key === 'action') return next

    if (col.dataIndex === 'status') {
      next.render = (value) =>
        value ? React.createElement(Tag, { color: STATUS_COLORS[value] || 'default' }, value) : '-'
      return next
    }
    if (col.dataIndex === 'redundant_power') {
      next.render = (value) => (Number(value) === 1 ? '是' : '否')
      return next
    }
    if (col.dataIndex === 'region_zone') {
      next.render = (_, r) => {
        if (!r.region && !r.zone) return '-'
        return `${r.region || ''}${r.zone ? '/' + r.zone : ''}`
      }
      return next
    }
    if (col.dataIndex === 'mgmt_url') {
      next.render = (url) =>
        url
          ? React.createElement(
              'a',
              { href: url, target: '_blank', rel: 'noreferrer' },
              '打开控制台'
            )
          : '-'
      return next
    }

    next.render = (value) => renderEmpty(value)
    return next
  })

  // 动态追加启用的自定义字段列（按 show_in_list 过滤）
  const customCols = (customFields || [])
    .filter((f) => f.show_in_list === 1)
    .map((f) => ({
      title: f.field_name,
      dataIndex: ['custom_fields', f.field_key],
      key: `custom_${f.field_key}`,
      width: 130,
      render: (val, r) => {
        const raw = r.custom_fields ? r.custom_fields[f.field_key] : undefined
        if (raw === undefined || raw === null || raw === '') return '-'
        if (f.field_type === 'boolean') return raw ? '是' : '否'
        return String(raw)
      },
    }))

  // 将自定义字段插入在“操作”列前
  const actionCol = baseCols.find((c) => c.key === 'action')
  const contentCols = baseCols.filter((c) => c.key !== 'action')

  return [...contentCols, ...customCols, actionCol].filter(Boolean)
}
