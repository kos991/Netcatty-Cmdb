import re

new_columns_code = """  const columns = [

    {
      key: 'user_room',
      label: '使用人 / 房间号',
      render: (_, r) => (
        <div className="flex items-center gap-2 whitespace-nowrap text-xs">
          <span className="font-semibold text-foreground">{r.user_name || '公用 / 闲置'}</span>
          {r.room ? (
            <span className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {r.room}室
            </span>
          ) : null}
        </div>
      ),
    },

    {
      key: 'department_group',
      label: '部门 / 分组',
      render: (_, r) => {
        const dept = formatDepartmentName(r.department)
        const sub = [r.group_name || '未分组', r.device_type].filter(Boolean).join(' · ')
        return (
          <div className="space-y-0.5 whitespace-nowrap text-xs">
            <div className="font-semibold text-foreground">{dept || '未分配部门'}</div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </div>
        )
      },
    },

    {
      key: 'ip',
      label: 'IP / 网络',
      render: (v, r) => {
        const isCloud = isCloudDevice(r.device_type)
        const isExternal = v === '外网' || /外网/.test(String(v))
        const netTag = isExternal ? '外网' : (r.net_type || '专网')

        return (
          <div className="space-y-0.5 whitespace-nowrap text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-foreground font-medium">
                {isExternal ? '外网桌面' : (v || '-')}
              </span>
              <span className="text-[11px] text-muted-foreground font-normal">[{netTag}]</span>
            </div>
            {isCloud && r.terminal_ip && (
              <div className="text-[11px] text-muted-foreground">
                {r.terminal_ip} <span className="text-[10px] text-muted-foreground/70">(盒子)</span>
              </div>
            )}
          </div>
        )
      },
    },

    {
      key: 'asset_code',
      label: '资产 / 设备 SN',
      render: (v, r) => {
        const serial = terminalSerialProfile(r)
        const isCloud = isCloudDevice(r.device_type)
        const boxLabel = isCloud ? '盒子: ' : 'SN: '

        return (
          <div className="space-y-0.5 whitespace-nowrap text-xs font-mono">
            <div>
              <Button variant="link" className="h-auto p-0 font-mono text-xs font-medium text-foreground/90 hover:underline" onClick={() => setDetailId(r.id)}>
                {v || `#${r.id}`}
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {serial.primaryValue ? `${boxLabel}${serial.primaryValue}` : '-'}
            </div>
            {serial.secondaryValue && (
              <div className="text-[11px] text-muted-foreground">
                显示器: {serial.secondaryValue}
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

    pattern = re.compile(r'  const columns = \[\n.*?  \]\n', re.DOTALL)
    match = pattern.search(content)
    if match:
        content = content[:match.start()] + new_columns_code + '\n' + content[match.end():]
        with open(t, 'w', encoding='utf-8') as f:
            f.write(content)
        print("Updated columns successfully in:", t)
    else:
        print("Could not match columns regex in:", t)
