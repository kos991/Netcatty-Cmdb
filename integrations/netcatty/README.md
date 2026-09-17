# Netcatty 集成层

该目录保存 Netcatty-CMDB 对上游 Netcatty 的最小集成代码，不保存上游完整源码。

- `upstream.json`：锁定经过验证的上游仓库 Release 标签及其实际提交。
- `electron/`：启动、健康检查和回收 `cmdb-server`，并注册 CMDB IPC bridge 的主进程模块。
- `../../web/src/`：作为 Netcatty 原生根工作区装配到 `components/cmdb/` 的 React + Ant Design 5 源码。
- `../../scripts/prepare-netcatty.mjs`：将上述内容注入干净的上游源码。

升级 Netcatty 上游时，应先更新 `upstream.json`，然后运行装配器、CMDB bridge 校验、lint 和构建。装配器的
任何锚点失败都表示上游调用链已变化，必须检查后再调整集成代码，不能绕过校验。
