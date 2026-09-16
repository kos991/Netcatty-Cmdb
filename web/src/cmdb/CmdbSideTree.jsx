import React, { useMemo } from 'react'
import { Tree, Tooltip } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'

// 首项固定为「全部…」，id=0 表示不过滤（与实测证据一致）。
const ALL_LABEL = {
  orgs: '全部组织',
  groups: '全部分组',
  categories: '全部分类',
}

const HEADING = {
  orgs: '组织架构',
  groups: '分组架构',
  categories: '类型架构',
}

// 扁平节点按 parent_id 组装成嵌套树
export function buildTaxonomyTree(nodes, allKey, allLabel) {
  const byParent = {}
  ;(nodes || []).forEach((n) => {
    const pid = n.parent_id || 0
    byParent[pid] = byParent[pid] || []
    byParent[pid].push(n)
  })
  const build = (pid) =>
    (byParent[pid] || []).map((n) => ({
      key: String(n.id),
      title: n.name,
      raw: n,
      children: build(n.id),
    }))
  return [{ key: allKey, title: allLabel, raw: { id: 0, name: allLabel }, children: build(0) }]
}

const EMPTY_HINT = {
  orgs: '暂无组织。点上方「+」新增下级，或用工具栏「分类管理」批量维护。',
  groups: '暂无分组。分组用于按机房 / 区域归类设备，点「+」或工具栏「分类管理」开始建。',
  categories: '暂无设备分类。分类会用于「设备分类」列与看板分布统计，点「+」或工具栏「分类管理」开始建。',
}

export default function CmdbSideTree({
  mode = 'orgs',
  data = [],
  selectedId = 0,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
}) {
  const allLabel = ALL_LABEL[mode] || '全部'
  const list = Array.isArray(data) ? data : []

  const treeData = useMemo(() => buildTaxonomyTree(list, '0', allLabel), [list, allLabel])

  const titleRender = (node) => {
    const raw = node.raw || {}
    const isRoot = raw.id === 0
    return (
      <span className="cmdb-tree-title">
        <span className="cmdb-tree-label" title={raw.name}>
          {node.title}
        </span>
        <span className="cmdb-tree-actions" onClick={(e) => e.stopPropagation()}>
          <Tooltip title="新增下级">
            <PlusOutlined
              className="cmdb-tree-action"
              onClick={() => onAdd && onAdd(isRoot ? 0 : raw.id)}
            />
          </Tooltip>
          {!isRoot ? (
            <>
              <Tooltip title="重命名 / 调整">
                <EditOutlined className="cmdb-tree-action" onClick={() => onEdit && onEdit(raw)} />
              </Tooltip>
              <Tooltip title="删除">
                <DeleteOutlined
                  className="cmdb-tree-action cmdb-tree-action-danger"
                  onClick={() => onDelete && onDelete(raw)}
                />
              </Tooltip>
            </>
          ) : null}
        </span>
      </span>
    )
  }

  return (
    <div className="cmdb-side">
      <div className="cmdb-side-heading">
        <div className="cmdb-side-title">{HEADING[mode] || '分类'}</div>
        <Tooltip title="新增分类">
          <button className="cmdb-side-add" type="button" onClick={() => onAdd && onAdd(0)} aria-label="新增分类">
            <PlusOutlined />
          </button>
        </Tooltip>
      </div>
      {list.length === 0 ? (
        <div className="cmdb-side-empty">{EMPTY_HINT[mode] || '暂无数据。'}</div>
      ) : null}
      <Tree
        blockNode
        defaultExpandAll
        selectedKeys={[String(selectedId)]}
        treeData={treeData}
        titleRender={titleRender}
        onSelect={(keys) => {
          const key = keys && keys.length ? keys[0] : '0'
          onSelect && onSelect(Number(key) || 0)
        }}
      />
    </div>
  )
}
