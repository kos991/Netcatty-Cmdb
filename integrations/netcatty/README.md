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

`update/updateService.ts`、`update/useUpdateCheck.ts` 和 `electron/autoUpdateBridge.cjs` 是受控升级源码，装配器复制到宿主服务、状态与桥接模块。宿主“软件更新”保留上游官方发布源 `binaricat/Netcatty`，只检查并提示上游新版本：electron-updater 的自动下载与退出时安装固定关闭，下载和安装 IPC 一律拒绝，界面上不提供下载、重启或前往下载入口，防止用不含 Cmdb 的上游官方安装包覆盖集成版。错误信息只显示简短原因，不展示响应头。`electron/autoUpdateBridge.test.cjs` 替换上游同名测试，覆盖上述约束。

Cmdb 集成版通过本仓库 Release 的完整安装包 `Netcatty-Cmdb-<版本>-win-x64.exe` 或离线补丁安装器 `Netcatty-Cmdb-patch-<版本>-win-x64.exe` 升级。宿主应用版本保持上游版本，只有文件名使用 Cmdb 版本。

离线补丁安装器由 `scripts/build-cmdb-patch.mjs` 用 electron-builder 缓存中的 makensis 编译 `patch/cmdb-patch-installer.nsi`，辅助脚本 `patch/patch-helper.ps1` 负责查找安装目录、校验宿主上游提交与文件哈希、备份覆盖与失败恢复。只替换安装目录中的 `resources/app.asar` 与 `resources/cmdb/*`，不触碰 `%APPDATA%\netcatty` 用户数据。

