# 交换机只读配置实施计划

## 目标

在 Cmdb 的基础设施详情中增加“读取配置”能力，复用 Netcatty 已有的 SSH/Telnet 主机与身份引用。读取仅在用户点击时发生，结果脱敏后保存最近一次快照并展示设备、端口、ACL、账号服务和 SNMP 摘要；失败不覆盖旧快照。

## 约束

- 只读，不执行配置修改命令，不保存密码、哈希、密文、Community 或认证/加密密钥。
- 命令只允许五家厂商的白名单读取命令；未知厂商明确提示未适配。
- CMDB 手工维护的上下联和对端字段不被读取结果覆盖。
- 使用现有 Netcatty 原生组件、桥接和项目隔离 API；不改正式安装目录、不发布版本。

## 任务与测试顺序

1. **解析器（纯 JavaScript）**
   - 新增 `integrations/netcatty/cmdb/switchConfig.js` 和测试。
   - 先写厂商命令白名单、敏感字段脱敏、华为/H3C/锐捷/思科/中兴输出解析失败测试，再实现标准快照结构。
   - 运行 `node --test integrations/netcatty/cmdb/switchConfig.test.js`，先红后绿。

2. **Go 快照存储和接口**
   - 新增快照表及迁移，增加 `CmdbSwitchSnapshot` 模型和项目作用域读写方法。
   - 新增 `GET/PUT /api/cmdb/assets/{id}/switch-snapshot`，PUT 校验资产必须为交换机/网络设备，并递归拒绝秘密字段。
   - 详情接口附带 `switch_snapshot`；失败写入不改变现有成功快照。
   - 先补 `internal/store/cmdb_switch_snapshot_test.go`、`internal/server_cmdb_switch_snapshot_test.go`，运行对应 `go test` 后实现。

3. **Electron 受控执行通道**
   - 在 `integrations/netcatty/electron/cmdbBridge.cjs` 增加 `netcatty:cmdb:read-switch`，仅接受主机引用、厂商和协议，SSH 调用现有 `execCommand`，Telnet 建立临时会话、写入命令并按结束标记收集输出，统一超时和输出上限。
   - 在 `scripts/prepare-netcatty.mjs` 注入 preload API 与类型声明。
   - 先补 bridge 单测覆盖白名单、超时、输出上限、秘密值不回传，再实现。

4. **详情页原生界面**
   - 在 `integrations/netcatty/cmdb/Infrastructure.jsx` 的交换机详情增加紧凑配置区、读取按钮、最近读取状态和四个页签：ACL 规则、设备账号、SSH/Telnet、SNMP 配置；端口按响应式网格展示，悬浮查看完整作用。
   - 读取成功后 PUT 脱敏快照并刷新详情；读取失败保留旧快照并显示错误。
   - 运行 `npm run build`（`web/`）、集成装配测试和 Electron 相关单测。

5. **隔离测试机加载**
   - 运行 `go test ./...`、`node scripts/prepare-netcatty.mjs`、Netcatty 构建。
   - 构建 `build/cmdb-server-native-ui.exe`，启动 `node scripts/start-native-preview.cjs`。
   - 通过本地 Electron 测试版检查交换机详情、空快照、读取失败态和已有快照展示；无真实设备凭据时只验证录制输出解析和失败态，不声称真实设备连接成功。

## 回滚边界

仅删除本轮新增文件、迁移表和装配器注入即可回滚；不触碰已有资产、链路、主机和钥匙串数据。
