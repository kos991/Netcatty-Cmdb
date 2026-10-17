
import re

targets = [
    r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\build\netcatty-final\components\cmdb\TerminalAssets.jsx',
    r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\integrations\netcatty\cmdb\TerminalAssets.jsx',
]

for t in targets:
    with open(t, 'r', encoding='utf-8') as f:
        code = f.read()

    # 1. 优化 AssetDetails
    asset_details_pattern = re.compile(
        r'function AssetDetails\(\{ id, host, onEdit, onClose, onNetcattyChanged, onNavigate \}\) \{.*?\n\}\n\nfunction TerminalRowActions',
        re.DOTALL
    )

    new_asset_details = """function AssetDetails({ id, host, onEdit, onClose, onNetcattyChanged, onNavigate }) {
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

function TerminalRowActions"""

    match = asset_details_pattern.search(code)
    if match:
        code = code[:match.start()] + new_asset_details + code[match.end() - len('function TerminalRowActions'):]
        print("Updated AssetDetails in:", t)
    else:
        print("Could not match AssetDetails in:", t)

    # 2. 优化 TerminalRowActions
    actions_pattern = re.compile(
        r'function TerminalRowActions\(\{ record, compact, onDetail, onEdit, onTransfer, onMaintenance, onArchive \}\) \{.*?\n\}\n\nexport default function TerminalAssets',
        re.DOTALL
    )

    new_row_actions = """function TerminalRowActions({ record, onDetail, onEdit, onTransfer, onMaintenance, onArchive }) {
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

export default function TerminalAssets"""

    match2 = actions_pattern.search(code)
    if match2:
        code = code[:match2.start()] + new_row_actions + code[match2.end() - len('export default function TerminalAssets'):]
        print("Updated TerminalRowActions in:", t)
    else:
        print("Could not match TerminalRowActions in:", t)

    # 3. 优化 columns 与 废除 mediumColumns 的过滤
    columns_and_density_pattern = re.compile(
        r'  const columns = \[\n.*?  const visibleColumns = density === \'compact\' \? compactColumns : density === \'medium\' \? mediumColumns : columns\n',
        re.DOTALL
    )

    new_columns_section = """  const columns = [
    {
      key: 'user_room',
      label: '使用人 / 房间号',
      className: 'min-w-[135px]',
      render: (_, r) => {
        const roomText = r.room ? (String(r.room).endsWith('室') ? String(r.room) : `${r.room}室`) : ''
        return (
          <div className="flex items-center gap-2 whitespace-nowrap text-xs">
            <span className="font-semibold text-foreground">{r.user_name || '公用 / 闲置'}</span>
            {roomText ? (
              <span className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {roomText}
              </span>
            ) : null}
          </div>
        )
      },
    },

    {
      key: 'department_group',
      label: '部门 / 分组',
      className: 'min-w-[130px]',
      render: (_, r) => {
        const dept = formatDepartmentName(r.department) || '未分配部门'
        const grp = r.group_name || '未分组'
        return (
          <div className="flex items-center gap-1.5 whitespace-nowrap text-xs">
            <span className="font-medium text-foreground">{dept}</span>
            <span className="text-muted-foreground/30">/</span>
            <span className="text-muted-foreground">{grp}</span>
          </div>
        )
      },
    },

    {
      key: 'device_type',
      label: '分类',
      className: 'min-w-[85px]',
      render: (v) => (
        <span className="text-xs text-foreground/85 whitespace-nowrap">
          {v || '云桌面终端'}
        </span>
      ),
    },

    {
      key: 'ip',
      label: 'IP',
      className: 'min-w-[125px]',
      render: (v, r) => {
        const isCloud = isCloudDevice(r.device_type)
        const isExternal = v === '外网' || /外网/.test(String(v))

        return (
          <div className="space-y-0.5 whitespace-nowrap text-xs font-mono">
            <div className="text-foreground font-medium">
              {isExternal ? '外网桌面' : (v || '-')}
            </div>
            {isCloud && r.terminal_ip && (
              <div className="text-[11px] text-muted-foreground">
                终端: {r.terminal_ip}
              </div>
            )}
          </div>
        )
      },
    },

    {
      key: 'net_type',
      label: '网络',
      className: 'w-[75px] whitespace-nowrap',
      render: (_, r) => {
        const isExternal = r.ip === '外网' || /外网/.test(String(r.ip)) || r.net_type === '外网' || /外网/.test(String(r.net_type))
        return (
          <span
            className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            title={isExternal ? '外网互联网' : (r.net_type || '政法专网')}
          >
            {isExternal ? (
              <>
                <Globe className="h-3 w-3 text-muted-foreground/80" />
                <span>外网</span>
              </>
            ) : (
              <>
                <Network className="h-3 w-3 text-muted-foreground/80" />
                <span>专网</span>
              </>
            )}
          </span>
        )
      },
    },

    {
      key: 'asset_code',
      label: '资产 / 设备 SN',
      className: 'min-w-[155px]',
      render: (v, r) => {
        const serial = terminalSerialProfile(r)
        const isCloud = isCloudDevice(r.device_type)
        const boxLabel = isCloud ? '盒子: ' : 'SN: '

        return (
          <div className="space-y-0.5 whitespace-nowrap text-xs font-mono">
            <div>
              <Button variant="link" className="h-auto p-0 font-mono text-xs font-medium text-foreground hover:underline" onClick={() => setDetailId(r.id)}>
                {v || `#${r.id}`}
              </Button>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>{serial.primaryValue ? `${boxLabel}${serial.primaryValue}` : '-'}</span>
              {serial.secondaryValue && (
                <span
                  className="cursor-help rounded bg-muted/60 px-1 text-[10px] text-muted-foreground/90 hover:text-foreground"
                  title={`显示器 SN: ${serial.secondaryValue}`}
                >
                  [含屏]
                </span>
              )}
            </div>
          </div>
        )
      },
    },

    { key: 'operating_system', label: '操作系统', className: 'min-w-[130px] whitespace-nowrap', render: (_, r) => <OperatingSystemCell asset={r} host={linkedHostByAssetID.get(Number(r.id))} /> },

    { key: 'status', label: '设备状态', className: 'w-[85px] whitespace-nowrap', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },

    { key: 'actions', label: '操作', className: 'w-[80px] whitespace-nowrap', render: (_, r) => <TerminalRowActions record={r} onDetail={() => setDetailId(r.id)} onEdit={() => open('edit', r)} onTransfer={() => open('transfer', r)} onMaintenance={() => open('maintenance', r)} onArchive={() => setArchive(r)} /> },
  ]

  const visibleColumns = columns
"""

    match3 = columns_and_density_pattern.search(code)
    if match3:
        code = code[:match3.start()] + new_columns_section + code[match3.end():]
        print("Updated columns & visibleColumns in:", t)
    else:
        print("Could not match columns_and_density in:", t)

    # 4. 替换 DataTable compact
    code = code.replace("<DataTable columns={visibleColumns} compact={density !== 'wide'}", "<DataTable columns={visibleColumns} compact={false}")

    with open(t, 'w', encoding='utf-8') as f:
        f.write(code)
