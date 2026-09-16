---
name: CMDB
description: CMDB 运维与虚拟机安装包盘点、安全补丁扫描插件（支持统信UOS与银河麒麟）
---

# CMDB 运维与补丁盘点技能 (Netcatty Skill)

本技能为 Netcatty 提供与 **CMDB 资产管理平台** 无缝联动的能力，专门针对批量控制与盘点**统信 UOS**和**银河麒麟（KylinOS）**虚拟机：
1. 查询 CMDB 中登记的虚拟机与服务器资产（支持按 OS 类型、IP、负责人搜索）；
2. 远程或批量执行轻量级非侵入式探针脚本，提取虚拟机已安装程序列表、内核版本与系统信息；
3. 扫描软件源与仓库中的安全补丁数量、可升级包列表；
4. 将盘点数据（安装包数、安全补丁数、采样明细）自动回填并更新至 CMDB 资产中心。

---

## 快速使用指令

在 Netcatty 终端或 AI 助手会话中，可随时调用内置 CLI 工具：

### 1. 查看 CMDB 资产与最新盘点状态
```bash
# 列出全部 CMDB 设备与补丁状态
python cmdb_cli.py list

# 仅筛选统信 UOS 虚拟机
python cmdb_cli.py list --os uos

# 仅筛选银河麒麟 KylinOS 虚拟机
python cmdb_cli.py list --os kylin

# 搜索特定 IP 或负责人的设备
python cmdb_cli.py list --kw 192.168.34
```

### 2. 获取探针脚本路径
Netcatty 在建立 SSH 会话或批量执行命令时，可获取对应探针脚本直接在远程虚拟机执行：
```bash
# 获取统信 UOS / Debian 系探针脚本路径
python cmdb_cli.py probe-path --type uos

# 获取银河麒麟 / RPM 系探针脚本路径
python cmdb_cli.py probe-path --type kylin
```

### 3. 探针结果回填 CMDB
当在虚拟机执行探针获得 JSON 输出后，调用回填指令：
```bash
# 将远程探针结果回填至对应 CMDB 资产 (例如 ID 为 10)
python cmdb_cli.py inspect --id 10 --probe-json /path/to/probe_result.json

# 本地快速测试验证
python cmdb_cli.py inspect --id 1 --os-type uos --mock
```

---

## 探针原理与安全规范

- **零依赖与非侵入**：探针纯 Bash 编写，利用系统原生 `dpkg`/`apt`（UOS）或 `rpm`/`dnf`/`yum`（银河麒麟），无需在目标虚拟机预装代理或常驻守护进程。
- **只读模拟安全检测**：补丁检测使用 `apt-get -s upgrade` 或 `yum check-update`，纯仿真比对软件源更新元数据，严禁主动执行破坏性升级。
- **合规回写**：探针检测结果自动注入 CMDB 资产的 `custom_fields`（包含 `installed_packages_count`, `security_patches_count`, `security_patches_list`, `os_kernel` 等字段）。
