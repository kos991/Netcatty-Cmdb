# Netcatty 集成层

该目录保存 Netcatty-CMDB 对上游 Netcatty 的最小集成代码，不保存上游完整源码。

- `upstream.json`：锁定经过验证的上游仓库 Release 标签及其实际提交。
- `electron/`：启动、健康检查和回收 `cmdb-server`，并注册 CMDB IPC bridge 的主进程模块。
- `cmdb/`：唯一正式界面源码，装配到 `components/cmdb/`，直接引用宿主原生组件、Tailwind、Radix UI 和 Lucide。
- `CmdbSurface.tsx`：Netcatty 根工作区与可折叠侧栏。
- `../../scripts/prepare-netcatty.mjs`：将上述内容注入干净的上游源码。
- `scripts/netcatty-aside-panel-integration.mjs`：宿主 `AsidePanel` 的调宽补丁；宿主独占数值宽度与持久化，业务页只传 `minWidthPx`/`maxWidthPx` 并通过 `onWidthChange` 读取实际宽度。

升级 Netcatty 上游时，应先更新 `upstream.json`，然后运行装配器、CMDB bridge 校验、lint 和构建。装配器的
任何锚点失败都表示上游调用链已变化，必须检查后再调整集成代码，不能绕过校验。

`AsidePanel` 调宽契约（由 `scripts/netcatty-aside-panel-integration.test.mjs` 守护）：默认范围 320–720，`width="w-[420px]"`
这类任意值作为回退宽度；拖拽、方向键（`Shift` 步长 1px）与 `Home`/双击复位都会持久化，`w-full` 展开不覆盖记住的可拖拽宽度。

## 本地原生界面测试

在 Windows 下，将已装配的 Netcatty 构建到 `build/netcatty-native-ui`，后端构建到 `build/cmdb-server-native-ui.exe`，然后在本仓库执行：

```powershell
node scripts/start-native-preview.cjs
```

该入口使用 `build/native-ui-preview/` 内的独立用户目录与空业务库，服务端口为 `18082`，不会加载正式安装数据。界面运行在真实 Electron 客户端中，导入导出使用系统文件对话框。关闭客户端即可关闭对应后端。该脚本仅供本地验证，不随发布包启动。

## 客户端升级契约

`update/updateService.ts`、`update/useUpdateCheck.ts` 和 `electron/autoUpdateBridge.cjs` 是受控升级源码，装配器复制到宿主服务、状态与桥接模块。主进程 electron-updater 唯一决定版本适用性、NSIS 资源及哈希校验，所有窗口从主进程状态快照回读；renderer 不再直接请求 GitHub API、不猜测 exe 下载资源、不保留演示版本或第二套版本比较。并发检查共享同一结果，检查失败明确保留错误，不显示最新版。

发布配置使用 `kos991/Netcatty-Cmdb`。Release 工作流只在 `main` 上的 `v1.0.YYYYMMDD` tag 触发，上传 Windows x64 NSIS、portable、latest.yml、blockmap 与 SHA256SUMS.txt。匿名 404 无法区分仓库不存在、私有或未发布，需发布方确认权限及资源完整性。

本地升级烟测先完成统一源码测试、lint、构建和 NSIS 打包，再执行：

```powershell
& build/netcatty/node_modules/electron/dist/electron.exe scripts/verify-netcatty-update.cjs build/netcatty build/netcatty/release/Netcatty-<VERSION>-win-x64.exe
```

烟测用独立临时用户目录与回环 HTTP 发布源，验证同版、404、坏元数据、并发检查、关闭自动下载、SHA512 拒绝及真实安装包下载就绪；不将本地发布源写入正式客户端。测试中仅元数据模拟高版本，安装包保持 VERSION 所指定版本，正式覆盖安装另行执行 `/S`。

