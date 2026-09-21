# Netcatty 集成层

该目录保存 Netcatty-CMDB 对上游 Netcatty 的最小集成代码，不保存上游完整源码。

- `upstream.json`：锁定经过验证的上游仓库 Release 标签及其实际提交。
- `electron/`：启动、健康检查和回收 `cmdb-server`，并注册 CMDB IPC bridge 的主进程模块。
- `cmdb/`：唯一正式界面源码，装配到 `components/cmdb/`，直接引用宿主原生组件、Tailwind、Radix UI 和 Lucide。
- `CmdbSurface.tsx`：Netcatty 根工作区与可折叠侧栏。
- `../../scripts/prepare-netcatty.mjs`：将上述内容注入干净的上游源码。

升级 Netcatty 上游时，应先更新 `upstream.json`，然后运行装配器、CMDB bridge 校验、lint 和构建。装配器的
任何锚点失败都表示上游调用链已变化，必须检查后再调整集成代码，不能绕过校验。

## 本地原生界面测试

在 Windows 下，将已装配的 Netcatty 构建到 `build/netcatty-native-ui`，后端构建到 `build/cmdb-server-native-ui.exe`，然后在本仓库执行：

```powershell
node scripts/start-native-preview.cjs
```

该入口使用 `build/native-ui-preview/` 内的独立用户目录与空业务库，服务端口为 `18082`，不会加载正式安装数据。界面运行在真实 Electron 客户端中，导入导出使用系统文件对话框。关闭客户端即可关闭对应后端。该脚本仅供本地验证，不随发布包启动。
