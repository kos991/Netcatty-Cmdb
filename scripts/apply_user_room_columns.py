import re

new_columns_code = """  const columns = [

    {
      key: 'user_room',
      label: '使用人 / 房间号',
      render: (_, r) => (
        <div className="space-y-1">
          <div className="font-semibold text-foreground text-xs">
            {r.user_name || '公用 / 闲置'}
          </div>
          {r.room ? (
            <div className="inline-flex items-center">
              <span className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {r.room}室
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">-</p>
          )}
        </div>
      ),
    },

    {
      key: 'department_group',
      label: '部门 / 分组',
      render: (_, r) => {
        const dept = formatDepartmentName(r.department)
        return (
          <div className="space-y-1">
            <div className="font-semibold text-foreground text-xs">
              {dept || '未分配部门'}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">{r.group_name || '未分组'}</span>
              {r.device_type && (
                <span className="rounded bg-muted/50 px-1 py-0.5 text-[10px] text-muted-foreground/80 leading-none">
                  {r.device_type}
                </span>
              )}
            </div>
          </div>
        )
      },
    },

    {
      key: 'ip',
      label: 'IP / 网络类型',
      render: (v, r) => {
        const isCloud = isCloudDevice(r.device_type)
        const isExternal = v === '外网' || /外网/.test(String(v))
        const netTypeLabel = isExternal ? '外网互联网' : (r.net_type || '政法专网')
        const netBadgeColor = isExternal
          ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
          : 'bg-sky-500/15 text-sky-400 border-sky-500/30'

        return (
          <div className="space-y-0.5 whitespace-nowrap text-xs">
            {isExternal ? (
              <div className="font-medium text-amber-400">外网桌面</div>
            ) : (
              <div className="font-mono">
                <span className="text-muted-foreground text-[11px]">{isCloud ? '桌面IP：' : '设备IP：'}</span>
                <span>{v || '-'}</span>
              </div>
            )}
            {isCloud && r.terminal_ip && (
              <div className="font-mono text-muted-foreground text-[11px]">
                <span className="text-muted-foreground/70">盒子物理IP：</span>
                <span>{r.terminal_ip}</span>
              </div>
            )}
            <div className="pt-0.5">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium leading-none ${netBadgeColor}`}>
                {netTypeLabel}
              </span>
            </div>
          </div>
        )
      },
    },

    {
      key: 'asset_code',
      label: '资产 / 设备 SN',
      render: (v, r) => {
        const serial = terminalSerialProfile(r)
        return (
          <div className="space-y-0.5 text-xs">
            <div className="font-mono">
              <span className="text-muted-foreground/70 text-[11px]">资产编码：</span>
              <Button variant="link" className="h-auto p-0 font-mono text-xs font-medium" onClick={() => setDetailId(r.id)}>
                {v || `#${r.id}`}
              </Button>
            </div>
            <div className="font-mono text-muted-foreground text-[11px]">
              <span className="text-muted-foreground/70">{serial.primaryLabel}：</span>
              <span>{serial.primaryValue || '-'}</span>
            </div>
            {serial.secondaryLabel && (
              <div className="font-mono text-muted-foreground text-[11px]">
                <span className="text-muted-foreground/70">{serial.secondaryLabel}：</span>
                <span>{serial.secondaryValue || '-'}</span>
              </div>
            )}
          </div>
        )
      },
    },

    { key: 'operating_system', label: '操作系统', className: 'min-w-[150px]', render: (_, r) => <OperatingSystemCell asset={r} host={linkedHostByAssetID.get(Number(r.id))} /> },

    { key: 'status', label: '设备状态', className: 'min-w-[110px] whitespace-nowrap', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },

    { key: 'actions', label: '操作', render: (_, r) => <TerminalRowActions record={r} compact={false} onDetail={() => setDetailId(r.id)} onEdit={() => open('edit', r)} onTransfer={() => open('transfer', r)} onMaintenance={() => open('maintenance', r)} onArchive={() => setArchive(r)} /> },

  ]"""

targets = [
    r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\build\netcatty-final\components\cmdb\TerminalAssets.jsx',
    r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\integrations\netcatty\cmdb\TerminalAssets.jsx',
]

for t in targets:
    with open(t, 'r', encoding='utf-8') as f:
        content = f.read()

    # 替换 columns
    pattern = re.compile(r'  const columns = \[\n.*?  \]\n', re.DOTALL)
    match = pattern.search(content)
    if match:
        content = content[:match.start()] + new_columns_code + '\n' + content[match.end():]
        with open(t, 'w', encoding='utf-8') as f:
            f.write(content)
        print("Updated columns successfully in:", t)
    else:
        print("Could not match columns regex in:", t)
