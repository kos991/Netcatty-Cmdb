targets = [
    r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\build\netcatty-final\components\cmdb\TerminalAssets.jsx',
    r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\integrations\netcatty\cmdb\TerminalAssets.jsx',
]

replacement = """function AssetDetails({ id, host, onEdit, onClose, onNetcattyChanged, onNavigate }) {
  const loader = useCallback(async () => {
    const [detail, relations] = await Promise.all([api.asset(id), api.assetRelations(id)])
    return { ...detail, relations }
  }, [id])

  const query = useQuery(loader)

  if (query.error) return <AssetPanel open onClose={onClose} title="终端资产"><ErrorBanner message={query.error} onRetry={query.reload} /></AssetPanel>
  if (!query.data) return <AssetPanel open onClose={onClose} title="终端资产"><Spinner /></AssetPanel>

  const { asset, logs } = query.data
  const cloud = isCloudDevice(asset.device_type)
  const serial = terminalSerialProfile(asset)
  const roomText = asset.room ? (String(asset.room).endsWith('室') ? String(asset.room) : `${asset.room}室`) : '未登记'

  return <AssetPanel open onClose={onClose} title={asset.asset_code || `终端资产 #${id}`} subtitle={asset.device_type} status={asset.status} icon={Monitor} onEdit={() => onEdit('edit', asset)}>
    <AssetPanelSection title="使用与位置" icon={UserRound} action={<div className="flex gap-1"><ActionIcon label="调换使用人" onClick={() => onEdit('transfer', asset)}><ArrowLeftRight size={15} /></ActionIcon><ActionIcon label="维修换件" onClick={() => onEdit('maintenance', asset)}><Wrench size={15} /></ActionIcon></div>}>
      <AssetPanelFields items={[
        ["当前使用人", asset.user_name || '公用 / 闲置'],
        ["部门", formatDepartmentName(asset.department) || '未分配部门'],
        ["房间 / 位置", roomText]
      ]} />
    </AssetPanelSection>

    <AssetPanelSection title="设备与网络" icon={Network}>
      <AssetPanelFields items={[
        ["资产编码", asset.asset_code || '-'],
        ["设备类型", asset.device_type || '-'],
        ["所属分组", asset.group_name || '未分组'],
        [serial.primaryLabel, serial.primaryValue || '-'],
        ...(serial.secondaryValue ? [[serial.secondaryLabel, serial.secondaryValue]] : []),
        ["操作系统", <OperatingSystemCell asset={asset} host={host} />],
        [cloud ? '桌面业务 IP' : '设备 IP', asset.ip || '-'],
        ...(cloud && asset.terminal_ip ? [['终端物理 IP', asset.terminal_ip]] : []),
        ["网络类型", asset.net_type || (asset.ip === '外网' || /外网/.test(String(asset.ip)) ? '外网' : '专网')],
        ...(asset.remark ? [["备注", asset.remark]] : []),
        ["建档时间", asset.created_at || '-']
      ]} />
    </AssetPanelSection>

    <AssetPanelSection title="IPAM 地址" icon={Network}>
      {(() => {
        const ips = [asset.ip, ...(cloud ? [asset.terminal_ip] : [])].filter((ip) => ip && ip !== '外网' && !/外网/.test(ip))
        if (!ips.length) return <p className="text-xs text-muted-foreground">暂无可纳管的专网 IP</p>
        return ips.map((ip) => {
          const entry = query.data.relations?.ips?.find((item) => item.ip === ip)
          return (
            <div key={ip} className="flex items-center justify-between text-xs py-1">
              <span className="font-mono text-foreground">{ip}</span>
              <span className="text-muted-foreground">{entry ? `${entry.subnet} (${entry.status})` : '未纳入 IPAM'}</span>
              {entry ? (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onNavigate?.({ tableKey: 'ip_pool', id: entry.id, title: entry.ip, subtitle: entry.subnet })}>
                  查看
                </Button>
              ) : null}
            </div>
          )
        })
      })()}
    </AssetPanelSection>

    <AssetPanelSection title="设备照片" icon={ImageIcon}><DeviceImages kind="terminal" id={id} /></AssetPanelSection>
    <AssetPanelSection title="凭证中心" icon={Network}><NetcattyLinks asset={{ ...asset, name: asset.asset_code }} assetType="terminal" assetId={id} embedded onChanged={onNetcattyChanged} /></AssetPanelSection>
    <AssetPanelSection title="运维履历" icon={History}><LogTimeline logs={logs || []} /></AssetPanelSection>
  </AssetPanel>
}

function TerminalRowActions({ record, onDetail, onEdit, onTransfer, onMaintenance, onArchive }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="flex items-center gap-0.5">
      <ActionIcon label="编辑" onClick={onEdit}><Pencil size={14} /></ActionIcon>
      <ActionIcon label="调换使用人" onClick={onTransfer}><ArrowLeftRight size={14} /></ActionIcon>
      <Dropdown open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownTrigger asChild>
          <ActionIcon label="更多操作"><MoreHorizontal size={14} /></ActionIcon>
        </DropdownTrigger>
        <DropdownContent align="end" className="w-36">
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs hover:bg-secondary" onClick={() => { setMenuOpen(false); onDetail() }}><History size={14} />详情与履历</button>
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs hover:bg-secondary" onClick={() => { setMenuOpen(false); onMaintenance() }}><Wrench size={14} />维修换件</button>
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-destructive hover:bg-secondary" onClick={() => { setMenuOpen(false); onArchive() }}><Archive size={14} />注销归档</button>
        </DropdownContent>
      </Dropdown>
    </div>
  )
}

"""

for t in targets:
    with open(t, 'r', encoding='utf-8') as f:
        code = f.read()

    start_str = 'function AssetDetails({ id, host, onEdit, onClose, onNetcattyChanged, onNavigate }) {'
    end_str = 'export default function TerminalAssets('

    if start_str in code and end_str in code:
        idx1 = code.index(start_str)
        idx2 = code.index(end_str)

        code = code[:idx1] + replacement + code[idx2:]
        with open(t, 'w', encoding='utf-8') as f:
            f.write(code)
        print('Successfully replaced in:', t)
    else:
        print('Tags not found in:', t)
