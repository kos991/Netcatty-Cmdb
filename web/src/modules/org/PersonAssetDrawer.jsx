import React, { useEffect, useState } from 'react'
import {
  Drawer,
  Alert,
  Table,
  Tag,
  Button,
  Space,
  Descriptions,
  Modal,
  Select,
  message,
  Typography,
  Empty,
  Badge,
} from 'antd'
import {
  SwapOutlined,
  DesktopOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { cmdbApi } from '../../cmdb/cmdbApi'

const { Text } = Typography

export default function PersonAssetDrawer({ visible, person, onClose, allPersons = [], onTransferred, onNavigate }) {
  const [loading, setLoading] = useState(false)
  const [assets, setAssets] = useState([])
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [transferModal, setTransferModal] = useState(false)
  const [targetPersonId, setTargetPersonId] = useState(null)
  const [transferring, setTransferring] = useState(false)

  const loadAssets = async () => {
    if (!person?.id) return
    setLoading(true)
    try {
      const res = await cmdbApi.getPersonAssets(person.id)
      setAssets(res.assets || [])
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (visible && person?.id) {
      setAssets([])
      setError('')
      loadAssets()
      setTargetPersonId(null)
      setTransferModal(false)
      setSelectedIds([])
    }
  }, [visible, person?.id])

  const handleTransfer = async () => {
    if (!targetPersonId) {
      message.warning('请选择目标接收人')
      return
    }
    const ids = selectedIds.length > 0 ? selectedIds : assets.map((a) => a.id)
    if (ids.length === 0) {
      message.warning('暂无可转交的资产')
      return
    }

    setTransferring(true)
    try {
      await cmdbApi.transferPersonAssets({
        from_person_id: person.id,
        to_person_id: targetPersonId,
        asset_ids: ids,
      })
      message.success(`成功交接 ${ids.length} 项资产`)
      setTransferModal(false)
      loadAssets()
      onTransferred?.()
    } catch (err) {
      message.error(`资产交接失败: ${err.message}`)
    } finally {
      setTransferring(false)
    }
  }

  const columns = [
    {
      title: '资产名称 / 编码',
      dataIndex: 'name',
      key: 'name',
      render: (text, r) => (
        <div>
          <Space onClick={() => onNavigate?.({ tableKey: r.source_type === 'legacy_asset' ? 'assets' : 'cmdb_assets', id: r.source_type === 'legacy_asset' ? r.source_id : r.id })} style={{ cursor: 'pointer' }}>
            {r.asset_class === 'physical' ? (
              <CloudServerOutlined style={{ color: '#1677ff' }} />
            ) : r.asset_class === 'desktop' ? (
              <DesktopOutlined style={{ color: '#52c41a' }} />
            ) : (
              <ClusterOutlined style={{ color: '#722ed1' }} />
            )}
            <Text strong>{text || '-'}</Text>
          </Space>
          {r.asset_code && (
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>{r.asset_code}</div>
          )}
        </div>
      ),
    },
    {
      title: '大类/分类',
      dataIndex: 'device_type',
      key: 'device_type',
      render: (t, r) => (
        <Space direction="vertical" size={2}>
          <Tag color="blue">{r.asset_class || 'physical'}</Tag>
          <span style={{ fontSize: 12 }}>{t || '-'}</span>
        </Space>
      ),
    },
    {
      title: '管理 IP',
      dataIndex: 'manage_ip',
      key: 'manage_ip',
      render: (t) => t ? <code>{t}</code> : <span style={{ color: '#bfbfbf' }}>-</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (st) => {
        let color = 'default'
        if (st === '在用' || st === '在线' || st === '运行中') color = 'success'
        else if (st === '维保' || st === '维修中') color = 'warning'
        else if (st === '报废' || st === '下线') color = 'error'
        return <Badge status={color} text={st || '在库'} />
      },
    },
    {
      title: '位置 / 机柜',
      key: 'location',
      render: (_, r) => (
        <span style={{ fontSize: 12 }}>
          {r.area || r.room ? `${r.area || ''} ${r.room || ''}` : r.cabinet_name ? `机柜 ${r.cabinet_name}` : '-'}
        </span>
      ),
    },
  ]

  const candidatePersons = allPersons.filter((p) => p.id !== person?.id)

  return (
    <Drawer
      title={
        <Space>
          <span>人员资产画像：<strong>{person?.name || '未知'}</strong></span>
          <Tag color={person?.status === '在职' ? 'green' : 'orange'}>
            {person?.status || '在职'}
          </Tag>
        </Space>
      }
      open={visible}
      onClose={onClose}
      width={780}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadAssets}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<SwapOutlined />}
            onClick={() => setTransferModal(true)}
            disabled={loading || !!error || assets.length === 0}
          >
            {selectedIds.length > 0 ? `交接已选 (${selectedIds.length})` : '一键全部交接'}
          </Button>
        </Space>
      }
    >
      {person && (
        <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="工号">{person.person_code || '-'}</Descriptions.Item>
          <Descriptions.Item label="部门">{person.department || '-'}</Descriptions.Item>
          <Descriptions.Item label="职位/岗位">{person.title || '-'}</Descriptions.Item>
          <Descriptions.Item label="所属组织">{person.org_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="所属分组">{person.group_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{person.phone || '-'}</Descriptions.Item>
        </Descriptions>
      )}

      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong>名下直接关联资产清单 ({assets.length})</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          支持多选进行部分划转交接；未勾选则默认一键交接全部资产。
        </Text>
      </div>

      {error && <Alert type="error" showIcon message="加载名下资产失败" description={error} action={<Button onClick={loadAssets}>重试</Button>} />}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={assets}
        columns={columns}
        pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 项资产` }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: setSelectedIds,
        }}
        locale={{ emptyText: <Empty description="该人员名下暂未绑定任何资产" /> }}
      />

      <Modal
        title="资产交接确认"
        open={transferModal}
        onOk={handleTransfer}
        confirmLoading={transferring}
        onCancel={() => setTransferModal(false)}
        okText="确认划转"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          将 <strong>{person?.name}</strong> 名下的{' '}
          <Tag color="blue">{selectedIds.length > 0 ? `${selectedIds.length} 项所选资产` : `全部 ${assets.length} 项资产`}</Tag>{' '}
          交接转移至：
        </div>
        <Select
          showSearch
          placeholder="请搜索并选择接收人"
          style={{ width: '100%' }}
          value={targetPersonId}
          onChange={setTargetPersonId}
          optionFilterProp="label"
          options={candidatePersons.map((p) => ({
            value: p.id,
            label: `${p.name} (${p.department || '未分配'} - ${p.title || '员工'})`,
          }))}
        />
        <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 12 }}>
          交接完成后，资产的负责人（owner）与所属部门将自动更新为新接收人，原关联履历自动归档。
        </div>
      </Modal>
    </Drawer>
  )
}
