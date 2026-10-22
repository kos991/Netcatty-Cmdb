import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SettingCard, SettingRow, SettingsSection } from '@/components/settings/settings-ui'
import { CMDB_CLOUD_SYNC_STORAGE_KEY, CMDB_CLOUD_SYNC_SETTINGS_EVENT, readCmdbCloudSyncSettings, writeCmdbCloudSyncSettings } from '../../application/CmdbCloudSync'
import { api } from './api'
import { directoryChanged, useAction } from './hooks'
import { ErrorBanner } from './ui'
import './settings.css'

export default function SettingsSyncMaintenance({ project }) {
  const [settings, setSettings] = useState(readCmdbCloudSyncSettings)
  const [confirmEnable, setConfirmEnable] = useState(false)
  const [preview, setPreview] = useState(false)
  const [result, setResult] = useState(null)
  const action = useAction()
  useEffect(() => {
    const refresh = () => setSettings(readCmdbCloudSyncSettings())
    const storage = (event) => { if (!event.key || event.key === CMDB_CLOUD_SYNC_STORAGE_KEY) refresh() }
    window.addEventListener(CMDB_CLOUD_SYNC_SETTINGS_EVENT, refresh)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener(CMDB_CLOUD_SYNC_SETTINGS_EVENT, refresh); window.removeEventListener('storage', storage) }
  }, [])
  const update = (enabled) => action.run(async () => { setSettings(writeCmdbCloudSyncSettings({ enabled })); setConfirmEnable(false) })
  const migrate = () => action.run(async () => {
    const response = await api.syncInfrastructure()
    setResult(response)
    setPreview(false)
    directoryChanged()
  }, '旧台账迁入完成')
  return <div className="cmdb-settings-sections">
    <SettingsSection title="云同步">
      <SettingCard><SettingRow anchorId="cmdb-sync" label="同步 Cmdb 数据" description="资产、组织及联系电话、IP、工单和履历统一随 Netcatty 云同步"><Switch checked={settings.enabled} disabled={action.busy} onCheckedChange={(enabled) => enabled ? setConfirmEnable(true) : update(false)} aria-label="同步 Cmdb 数据" /></SettingRow></SettingCard>
      {settings.lastStatus === 'error' && <ErrorBanner title="Cmdb 云同步失败" message={settings.lastError || '宿主未提供详细错误，请在云同步设置中查看'} />}
    </SettingsSection>
    <SettingsSection title="数据维护">
      <SettingCard divided>
        <SettingRow anchorId="cmdb-legacy" label="旧台账迁入" description="将旧终端和基础设施资料迁入当前项目，已有记录跳过"><Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={!project || action.busy} onClick={() => setPreview(true)}>查看迁入预览</Button></SettingRow>
        {result && <SettingRow label="上次迁入结果" description={`新增组织 ${result.org_inserted ?? 0}，新增终端资产 ${result.asset_inserted ?? 0}，新增基础设施 ${result.server_inserted ?? 0}，跳过已有记录 ${result.skipped ?? 0}`}><span className="text-xs text-muted-foreground">接口执行结果</span></SettingRow>}
      </SettingCard>
    </SettingsSection>
    <ConfirmDialog open={confirmEnable} onOpenChange={setConfirmEnable} title="启用 Cmdb 云同步" message="资产、组织及联系电话、IP、工单和履历将统一进入 Netcatty 现有端到端加密同步载荷。工单附件仅在宿主已解锁且 S3 可用时加密补传；密码和密钥不会写入 Cmdb。同步执行与状态由宿主管理。" confirmLabel="启用" busy={action.busy} onConfirm={() => update(true)} />
    <Dialog open={preview} onOpenChange={(open) => { if (!action.busy) setPreview(open) }}>
      <DialogContent className="cmdb-theme-scope cmdb-record-shell cmdb-settings-dialog flex w-[min(600px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="cmdb-record-header"><div className="min-w-0 pr-6"><DialogTitle>旧台账迁入预览</DialogTitle><p className="cmdb-settings-dialog-note">确认后按当前项目执行幂等迁入，已有映射的记录跳过。</p></div></DialogHeader>
        <div className="cmdb-record-body space-y-3">
          <p className="text-[13px] leading-relaxed">将当前项目的旧终端与基础设施资料迁入 Cmdb，已有有效映射跳过。</p>
          <dl className="divide-y rounded-lg border border-border px-4 text-xs">{[
            ['当前项目', project ? `${project.name}（${project.code}）` : '未读取到当前项目'],
            ['数据来源', '当前项目的旧终端台账与旧基础设施台账。'],
            ['作用范围', '新增对应 Cmdb 资产及业务 IP 接口；从旧终端部门补充组织，不跨项目写入。'],
            ['重复执行', '按当前项目、来源类型和来源记录 ID 判重；已有有效映射跳过，不覆盖已映射资产。'],
            ['保留边界', '不删除现有资产或旧台账，不迁移、重建或清空已有运维履历；不导入业务系统。'],
          ].map(([label, value]) => <div key={label} className="grid grid-cols-[80px_1fr] gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}</dl>
          <p className="text-xs leading-relaxed text-muted-foreground">现有接口不提供逐项预检或待迁入数量；确认后执行幂等迁入，并显示服务端返回的实际新增和跳过数量。</p>
        </div>
        <div className="cmdb-record-footer"><Button variant="outline" disabled={action.busy} onClick={() => setPreview(false)}>取消</Button><Button className="cmdb-primary-action" disabled={!project || action.busy} onClick={migrate}>{action.busy ? '迁入中…' : '确认迁入'}</Button></div>
      </DialogContent>
    </Dialog>
  </div>
}
