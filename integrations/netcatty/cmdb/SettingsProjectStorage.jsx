import React, { useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SettingCard, SettingRow, SettingsSection } from '@/components/settings/settings-ui'
import { api } from './api'
import { directoryChanged, useAction, useQuery } from './hooks'
import { selectAttachmentDirectory } from './transport'
import { buildAttachmentMigrationSummary, buildAttachmentStorageSummary, formatAttachmentBytes } from './attachmentStorageModel'
import { ErrorBanner } from './ui'
import './settings.css'

export default function SettingsProjectStorage({ project, onSaved }) {
  const attachmentQuery = useQuery(api.attachmentStorage)
  const action = useAction()
  const [values, setValues] = useState({ name: '', code: '' })
  const projectId = useRef(null)
  const [migration, setMigration] = useState(null)
  const [migrationResult, setMigrationResult] = useState(null)
  useEffect(() => {
    if (project && projectId.current !== `${project.id}:${project.revision}`) {
      projectId.current = `${project.id}:${project.revision}`
      setValues({ name: project.name || '', code: project.code || '' })
    }
  }, [project])
  const summary = buildAttachmentStorageSummary(attachmentQuery.data)
  const chooseDirectory = () => action.run(async () => {
    const target = await selectAttachmentDirectory()
    if (target) setMigration({ preview: await api.preflightAttachmentStorage(target), restoreDefault: false })
  })
  const confirmMigration = () => action.run(async () => {
    const result = migration.restoreDefault ? await api.restoreDefaultAttachmentStorage() : await api.migrateAttachmentStorage(migration.preview.target_root)
    setMigrationResult(result)
    setMigration(null)
    await attachmentQuery.reload()
  }, '附件目录已更新')
  return <div className="cmdb-settings-sections">
    <SettingsSection title="项目设置" actions={<Button className="cmdb-primary-action" disabled={!project || action.busy} onClick={() => action.run(async () => { await api.updateProject(project.id, values); onSaved?.(); directoryChanged() }, '项目设置已保存')}><Save size={14} />保存设置</Button>}>
      <SettingCard divided>
        <SettingRow anchorId="cmdb-project-name" label="项目名称" description="资产、组织、地址池和工单归属同一当前项目"><Input aria-label="项目名称" disabled={!project || action.busy} className="h-[34px] w-72 max-w-full text-[13px]" value={values.name} onChange={(event) => setValues((old) => ({ ...old, name: event.target.value }))} /></SettingRow>
        <SettingRow anchorId="cmdb-project-code" label="项目编码" description="用于项目数据隔离和导入导出识别，不作为资产编码"><Input aria-label="项目编码" disabled={!project || action.busy} className="h-[34px] w-72 max-w-full font-mono text-[13px]" value={values.code} onChange={(event) => setValues((old) => ({ ...old, code: event.target.value }))} /></SettingRow>
      </SettingCard>
    </SettingsSection>
    <SettingsSection title="附件存储">
      {attachmentQuery.error && <ErrorBanner message={attachmentQuery.error} onRetry={attachmentQuery.reload} />}
      <SettingCard divided>
        <SettingRow anchorId="cmdb-attachment-path" label="附件管理路径" description={attachmentQuery.data ? `${summary.modeLabel} · ${summary.writableLabel} · ${summary.countLabel} · ${summary.sizeLabel}` : attachmentQuery.loading ? '正在读取当前项目附件目录、可写状态及容量' : '未能读取附件存储状态'}>
          <div className="flex max-w-full flex-col items-end gap-2">
            <Input aria-label="附件管理路径" className="h-[34px] w-72 max-w-full bg-muted/30 font-mono text-xs" value={attachmentQuery.data ? summary.path : ''} readOnly />
            <div className="flex gap-2"><Button size="sm" variant="outline" className="h-8 text-xs" disabled={!project || action.busy || attachmentQuery.loading} onClick={chooseDirectory}>选择目录</Button><Button size="sm" variant="ghost" className="h-8 text-xs" disabled={!project || action.busy || attachmentQuery.loading || attachmentQuery.data?.uses_default} onClick={() => action.run(async () => setMigration({ preview: await api.preflightAttachmentStorage(''), restoreDefault: true }))}>恢复默认</Button></div>
          </div>
        </SettingRow>
        <SettingRow anchorId="cmdb-attachment-sync" label="附件同步" description="本地保留明文附件；宿主已解锁且 S3 可用时加密补传"><span className="text-xs text-muted-foreground">跟随项目</span></SettingRow>
      </SettingCard>
      {migrationResult && <p className="break-all text-xs text-muted-foreground" role="status">迁移完成：{migrationResult.migrated_files} 个文件，{formatAttachmentBytes(migrationResult.size_bytes)}；目标目录：{migrationResult.target_root}</p>}
    </SettingsSection>
    <ConfirmDialog open={!!migration} onOpenChange={(open) => { if (!open && !action.busy) setMigration(null) }} title={migration?.restoreDefault ? '恢复默认附件目录' : '迁移附件目录'} message={migration ? (() => { const result = buildAttachmentMigrationSummary(migration.preview); return `源目录：${result.source}\n目标目录：${result.target}\n将处理 ${result.countLabel}，共 ${result.sizeLabel}。迁移失败时保留原目录。` })() : ''} confirmLabel="确认迁移" busy={action.busy} onConfirm={confirmMigration} />
  </div>
}
