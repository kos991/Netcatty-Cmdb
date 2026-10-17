# 安装器使用说明

本目录打包后附在每个 `.ncpkg` 旁边一起分发。

## 用户操作（Windows）

```
netcatty-cmdb-1.3.1-win-x64/
  ├── netcatty-cmdb-1.3.1-win-x64.ncpkg   ← 插件包
  ├── install.bat                           ← 双击此文件安装
  ├── install.mjs                           ← 安装器主体
  └── README.md                             ← 本文件
```

1. 双击 `install.bat`
2. 按提示确认，等待完成
3. 重启 Netcatty，侧边栏出现 CMDB 图标

## 用户操作（Linux / macOS）

```bash
chmod +x install.sh
./install.sh
```

## 前提条件

- Node.js 22 或更高版本（[下载](https://nodejs.org/)）
- 已安装标准版 Netcatty（v1.1.83 或更高）

## 自定义 userData 路径

若 Netcatty 安装在非标准位置（企业定制路径、旧版目录名等）：

```bash
node install.mjs --userData "D:\MyApps\Netcatty\data"
```

## 卸载

在 Netcatty 设置 → 插件管理中卸载，或手动删除：

- `%APPDATA%\Netcatty\plugins\packages\com.netcatty.cmdb\`（Windows）
- `~/Library/Application Support/Netcatty/plugins/packages/com.netcatty.cmdb/`（macOS）
- `~/.config/Netcatty/plugins/packages/com.netcatty.cmdb/`（Linux）

同时从 `plugins.sqlite` 删除对应行（或直接重装 Netcatty）。
