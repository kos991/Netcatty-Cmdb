import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAction } from './hooks'
import { DataTable, DefinitionList, ErrorBanner, ModalForm } from './ui'

export default function ImportDialog({ importer, onImported, title = '导入资产', renderTrigger }) {
  const [preview, setPreview] = useState(null)
  const action = useAction()
  const rows = preview?.rows || preview?.items || []
  const startImport = () => action.run(async () => { const result = await importer(); if (!result.cancelled) setPreview(result) })
  return <>{renderTrigger ? renderTrigger(startImport, action.busy) : <Button size="sm" variant="outline" disabled={action.busy} onClick={startImport}>{title}</Button>}
    <ModalForm open={!!preview} onOpenChange={(v) => { if (!v) setPreview(null) }} title={`${title}预览`} wide busy={action.busy} submitLabel="确认导入" onSubmit={() => action.run(async () => {
      if (!preview.token) throw new Error('导入预览已失效，请重新选择文件')
      if (preview.errors?.length) throw new Error('请先修正导入文件中的错误')
      await importer(true, preview.token); setPreview(null); onImported()
    }, '导入完成')}>
      <DefinitionList items={preview?.rows ? [['总行数', preview.total], ['有效行数', preview.valid]] : [['新增基础设施', preview?.servers_created], ['更新基础设施', preview?.servers_updated], ['新增应用', preview?.apps_created], ['更新应用', preview?.apps_updated]]} />
      {!!preview?.errors?.length && <ErrorBanner message={preview.errors.join('；')} />}
      <div className="max-h-80 overflow-auto"><DataTable rows={rows.map((r, index) => ({ ...r, id: index, asset_code: r.asset_code || r.asset?.asset_code }))} columns={preview?.rows ? [{ key: 'row', label: '行' }, { key: 'name', label: '名称' }, { key: 'asset_code', label: '资产编码' }, { key: 'message', label: '校验结果' }] : [{ key: 'kind', label: '类型' }, { key: 'name', label: '名称' }, { key: 'detail', label: '明细' }, { key: 'action', label: '操作' }]} /></div>
    </ModalForm></>
}
