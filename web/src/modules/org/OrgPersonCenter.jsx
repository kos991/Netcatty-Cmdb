import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import {
  Card,
  Alert,
  Table,
  Button,
  Input,
  Select,
  Tag,
  Space,
  Modal,
  Form,
  Row,
  Col,
  Statistic,
  message,
  Popconfirm,
  Badge,
  Tree,
  Typography,
} from 'antd'
import {
  UserAddOutlined,
  SearchOutlined,
  ReloadOutlined,
  ApartmentOutlined,
  TeamOutlined,
  EditOutlined,
  DeleteOutlined,
  DesktopOutlined,
} from '@ant-design/icons'
import { cmdbApi } from '../../cmdb/cmdbApi'
import PersonAssetDrawer from './PersonAssetDrawer'
import { buildPersonTree } from '../../cmdbWorkspaceState'
import './org-person.css'

const { Text } = Typography

export default function OrgPersonCenter({ focusTarget, onNavigate }) {
  const [loading, setLoading] = useState(false)
  const [persons, setPersons] = useState([])
  const [selectedDept, setSelectedDept] = useState(null)
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [directory, setDirectory] = useState([])
  const [error, setError] = useState('')
  const [directoryError, setDirectoryError] = useState('')
  const requestVersion = useRef(0)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingPerson, setEditingPerson] = useState(null)
  const [drawerPerson, setDrawerPerson] = useState(null)
  const [form] = Form.useForm()

  const loadData = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    try {
      const selection = selectedDept ? JSON.parse(selectedDept) : {}
      const res = await cmdbApi.listPersons({ keyword, ...selection, page, page_size: pageSize })
      if (version !== requestVersion.current) return
      setPersons(res.list || [])
      setTotal(res.total || 0)
      setError('')
    } catch (err) {
      if (version === requestVersion.current) setError(err.message)
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [keyword, selectedDept, page, pageSize])

  const loadDirectory = async () => {
    try {
      const entries = []
      let current = 1
      let count
      do {
        const res = await cmdbApi.listPersons({ page: current++, page_size: 500 })
        entries.push(...(res.list || []))
        count = res.total || 0
        if (!res.list?.length && entries.length < count) throw new Error('人员目录返回不完整，请重试')
      } while (entries.length < count)
      setDirectory(entries)
      setDirectoryError('')
    } catch (err) { setDirectoryError(err.message) }
  }
  const refresh = () => { loadData(); loadDirectory() }
  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadDirectory() }, [])
  useEffect(() => {
    if (focusTarget?.tableKey !== 'persons') return
    cmdbApi.getPersonAssets(focusTarget.id).then((res) => {
      setDrawerPerson(res.person)
      setError('')
    }).catch((err) => setError(err.message))
  }, [focusTarget])

  // 聚合部门与组织树
  const treeData = useMemo(() => buildPersonTree(directory).map((node) => ({
    ...node,
    icon: node.key === 'all' ? <ApartmentOutlined /> : <TeamOutlined />,
    children: node.children?.map((child) => ({ ...child, icon: <ApartmentOutlined /> })),
  })), [directory])

  // 统计数据
  const stats = useMemo(() => {
    const total = directory.length
    const active = directory.filter((p) => p.status === '在职').length
    const totalAssets = directory.reduce((acc, p) => acc + (p.asset_count || 0), 0)
    return { total, active, totalAssets }
  }, [directory])

  const handleOpenModal = (record = null) => {
    setEditingPerson(record)
    if (record) {
      form.setFieldsValue(record)
    } else {
      form.resetFields()
      form.setFieldsValue({
        status: '在职',
        org_name: '总机构',
        group_name: '技术运维组',
      })
    }
    setModalVisible(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      if (editingPerson) {
        await cmdbApi.updatePerson(editingPerson.id, values)
        message.success('人员信息更新成功')
      } else {
        await cmdbApi.createPerson(values)
        message.success('新增人员成功')
      }
      setModalVisible(false)
      refresh()
    } catch (err) {
      if (err.errorFields) return
      message.error(`保存失败: ${err.message}`)
    }
  }

  const handleDelete = async (id) => {
    try {
      await cmdbApi.deletePerson(id)
      message.success('已删除人员档案')
      refresh()
    } catch (err) {
      message.error(`删除失败: ${err.message}`)
    }
  }

  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      render: (text, r) => (
        <a
          onClick={() => setDrawerPerson(r)}
          style={{ fontWeight: 600, color: '#1677ff' }}
        >
          {text}
        </a>
      ),
    },
    {
      title: '工号',
      dataIndex: 'person_code',
      key: 'person_code',
      render: (t) => t || '-',
    },
    {
      title: '组织 / 分组',
      key: 'org_group',
      render: (_, r) => (
        <Space size={4}>
          <Tag>{r.org_name || '总机构'}</Tag>
          {r.group_name && <Tag color="geekblue">{r.group_name}</Tag>}
        </Space>
      ),
    },
    {
      title: '部门',
      dataIndex: 'department',
      key: 'department',
    },
    {
      title: '职务 / 岗位',
      dataIndex: 'title',
      key: 'title',
      render: (t) => t || '-',
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      key: 'phone',
      render: (t) => t || '-',
    },
    {
      title: '在职状态',
      dataIndex: 'status',
      key: 'status',
      render: (st) => (
        <Badge
          status={st === '在职' ? 'success' : 'default'}
          text={st || '在职'}
        />
      ),
    },
    {
      title: '名下资产数',
      dataIndex: 'asset_count',
      key: 'asset_count',
      render: (cnt, r) => (
        <Button
          type="link"
          size="small"
          icon={<DesktopOutlined />}
          onClick={() => setDrawerPerson(r)}
        >
          {cnt || 0} 台
        </Button>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_, r) => (
        <Space size="small">
          <Button
            type="text"
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleOpenModal(r)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该人员档案？"
            description="删除后将解除其名下资产的负责人绑定。"
            onConfirm={() => handleDelete(r.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="org-person-page">
      <div className="cmdb-page-heading"><h2>组织与人员</h2></div>
      {error && <Alert type="error" showIcon message="人员查询失败" description={error} action={<Button onClick={loadData}>重试</Button>} />}
      {directoryError && <Alert type="error" showIcon message="组织目录加载失败" description={directoryError} action={<Button onClick={loadDirectory}>重试</Button>} />}
      {/* 顶部指标 */}
      <Row gutter={16} style={{ marginBottom: 16 }} hidden={!!directoryError && !directory.length}>
        <Col span={8}>
          <Card size="small" bordered={false} className="org-stat-card">
            <Statistic title="人员总规模" value={stats.total} suffix="人" />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" bordered={false} className="org-stat-card">
            <Statistic
              title="当前在职"
              value={stats.active}
              suffix="人"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" bordered={false} className="org-stat-card">
            <Statistic
              title="人员关联资产总数"
              value={stats.totalAssets}
              suffix="台"
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 主工作区：左树右表 */}
      <div className="org-main-layout">
        <div className="org-tree-pane">
          <div className="org-tree-header">
            <ApartmentOutlined />
            <span>组织架构导航</span>
          </div>
          <Tree
            showIcon
            defaultExpandAll
            treeData={treeData}
            onSelect={(keys) => {
              setPage(1)
              if (keys.length === 0 || keys[0] === 'all') {
                setSelectedDept(null)
              } else {
                setSelectedDept(keys[0])
              }
            }}
          />
        </div>

        <div className="org-table-pane">
          <div className="org-toolbar">
            <Space>
              <Input
                placeholder="搜索姓名、工号、电话"
                prefix={<SearchOutlined />}
                allowClear
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
                style={{ width: 280 }}
              />
              <Button icon={<ReloadOutlined />} onClick={refresh}>
                刷新
              </Button>
            </Space>
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => handleOpenModal()}
            >
              新增人员
            </Button>
          </div>

          <Table
            rowKey="id"
            loading={loading}
            dataSource={persons}
            columns={columns}
            scroll={{ x: 1100 }}
            pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 名人员`, onChange: (p, size) => { setPage(p); setPageSize(size) } }}
            size="middle"
          />
        </div>
      </div>

      {/* 新增/编辑人员弹窗 */}
      <Modal
        title={editingPerson ? '编辑人员信息' : '新增人员档案'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="姓名"
                rules={[{ required: true, message: '请输入姓名' }]}
              >
                <Input placeholder="例如：张三" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="person_code" label="工号 / 员工编号">
                <Input placeholder="例如：EMP-0128" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="org_name" label="所属组织">
                <Input placeholder="例如：信息运维部" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="group_name" label="所属分组">
                <Input placeholder="例如：核心业务保障组" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="department"
                label="所属部门"
                rules={[{ required: true, message: '请输入部门名称' }]}
              >
                <Input placeholder="例如：审判管理处、技术科" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="title" label="职位 / 岗位">
                <Input placeholder="例如：系统管理员、法官助理" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="phone" label="联系电话">
                <Input placeholder="手机号或分机号码" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="在职状态">
                <Select
                  options={[
                    { value: '在职', label: '在职' },
                    { value: '离职', label: '离职' },
                    { value: '调休', label: '调休' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="remark" label="备注说明">
            <Input.TextArea rows={2} placeholder="可填写工位、负责系统等附加信息" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 人员名下资产穿透画像抽屉 */}
      <PersonAssetDrawer
        visible={!!drawerPerson}
        person={drawerPerson}
        allPersons={directory}
        onNavigate={onNavigate}
        onClose={() => setDrawerPerson(null)}
        onTransferred={refresh}
      />
    </div>
  )
}
