import os

files = [
    r"integrations\netcatty\cmdb\TerminalAssets.jsx",
    r"integrations\netcatty\cmdb\modules\assets\TerminalAssets.jsx",
    r"build\netcatty-final\components\cmdb\TerminalAssets.jsx",
    r"build\netcatty-release-gate\components\cmdb\TerminalAssets.jsx",
    r"build\netcatty-update-test-20261004\components\cmdb\TerminalAssets.jsx",
    r"build\netcatty-update-test-20261004\components\cmdb\modules\assets\TerminalAssets.jsx",
    r"build\netcatty-update-test-20261004-b\components\cmdb\TerminalAssets.jsx",
    r"build\netcatty-update-test-20261004-b\components\cmdb\modules\assets\TerminalAssets.jsx",
    r"build\netcatty-update-test-20261004-c\components\cmdb\TerminalAssets.jsx",
    r"build\netcatty-update-test-20261004-c\components\cmdb\modules\assets\TerminalAssets.jsx"
]

target_old = """  const columns = [
    { key: 'asset_code', label: '资产 / 分类 / 分组', render: (v, r) => <div><Button variant="link" className="h-auto p-0" onClick={() => setDetailId(r.id)}>{v || `#${r.id}`}</Button><p className="mt-1 text-xs text-muted-foreground">{r.device_type || '未分类'} · {r.group_name || '未分组'}</p></div> },
    { key: 'user_name', label: '使用人 / 部门', render: (v, r) => <div>{v || '公用 / 闲置'}<p className="text-xs text-muted-foreground">{r.department} {r.room}</p></div> },
    { key: 'box_sn', label: '设备 SN', render: (_, r) => { const serial = terminalSerialProfile(r); return <div className="font-mono text-xs"><span>{serial.primaryValue || '-'}</span>{serial.secondaryLabel && <p className="mt-1 text-muted-foreground">显示器：{serial.secondaryValue || '-'}</p>}</div> } },
    { key: 'operating_system', label: '操作系统', className: 'min-w-[150px]', render: (_, r) => <OperatingSystemCell asset={r} host={linkedHostByAssetID.get(Number(r.id))} /> },
    { key: 'ip', label: 'IP / 网络类型', render: (v, r) => <div className="whitespace-nowrap"><span className="font-mono text-xs">{v || '-'}</span>{isCloudDevice(r.device_type) && r.terminal_ip && <p className="text-xs text-muted-foreground">物理：{r.terminal_ip}</p>}<p className="mt-1 text-xs text-muted-foreground">{r.net_type || '未设置'}</p></div> },
    { key: 'status', label: '设备状态', className: 'min-w-[110px] whitespace-nowrap', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
    { key: 'actions', label: '操作', render: (_, r) => <TerminalRowActions record={r} compact={false} onDetail={() => setDetailId(r.id)} onEdit={() => open('edit', r)} onTransfer={() => open('transfer', r)} onMaintenance={() => open('maintenance', r)} onArchive={() => setArchive(r)} /> },
  ]"""

target_new = """  const columns = [
    { key: 'user_name', label: '使用人 / 部门 / 房间号', render: (v, r) => <div>{v || '公用 / 闲置'}<p className="text-xs text-muted-foreground">{[r.department, r.room].filter(Boolean).join(' ') || '-'}</p></div> },
    { key: 'ip', label: 'IP / 网络类型', render: (v, r) => <div className="whitespace-nowrap"><span className="font-mono text-xs">{v || '-'}</span>{isCloudDevice(r.device_type) && r.terminal_ip && <p className="text-xs text-muted-foreground">物理：{r.terminal_ip}</p>}<p className="mt-1 text-xs text-muted-foreground">{r.net_type || '未设置'}</p></div> },
    { key: 'category_group', label: '分类 / 分组', render: (_, r) => <div><span className="text-xs font-medium">{r.device_type || '云桌面终端'}</span><p className="mt-1 text-xs text-muted-foreground">{r.group_name || '未分组'}</p></div> },
    { key: 'asset_code', label: '资产 / 设备 SN', render: (v, r) => { const serial = terminalSerialProfile(r); return <div><Button variant="link" className="h-auto p-0 font-mono text-xs" onClick={() => setDetailId(r.id)}>{v || `#${r.id}`}</Button><p className="mt-0.5 font-mono text-xs text-muted-foreground">{serial.primaryValue || '-'}</p>{serial.secondaryLabel && <p className="text-[11px] text-muted-foreground">显示器：{serial.secondaryValue || '-'}</p>}</div> } },
    { key: 'operating_system', label: '操作系统', className: 'min-w-[150px]', render: (_, r) => <OperatingSystemCell asset={r} host={linkedHostByAssetID.get(Number(r.id))} /> },
    { key: 'status', label: '设备状态', className: 'min-w-[110px] whitespace-nowrap', render: (v) => <StatusPill tone={statusTone(v)}>{v}</StatusPill> },
    { key: 'actions', label: '操作', render: (_, r) => <TerminalRowActions record={r} compact={false} onDetail={() => setDetailId(r.id)} onEdit={() => open('edit', r)} onTransfer={() => open('transfer', r)} onMaintenance={() => open('maintenance', r)} onArchive={() => setArchive(r)} /> },
  ]"""

target_old_crlf = target_old.replace("\n", "\r\n")
target_new_crlf = target_new.replace("\n", "\r\n")

count = 0
for fpath in files:
    if os.path.exists(fpath):
        with open(fpath, "rb") as f:
            raw = f.read()
        is_crlf = b"\r\n" in raw
        text = raw.decode("utf-8")
        
        if target_old in text:
            text = text.replace(target_old, target_new)
            with open(fpath, "w", encoding="utf-8", newline="\r\n" if is_crlf else "\n") as f:
                f.write(text)
            print(f"Updated LF in {fpath}")
            count += 1
        elif target_old_crlf in text:
            text = text.replace(target_old_crlf, target_new_crlf)
            with open(fpath, "w", encoding="utf-8", newline="\r\n") as f:
                f.write(text)
            print(f"Updated CRLF in {fpath}")
            count += 1
        else:
            print(f"Block not matched in {fpath}")

print(f"Total updated: {count}")
