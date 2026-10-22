Netcatty-Cmdb 离线补丁

适用：无法联网自动升级、但已安装 Netcatty-Cmdb 集成版的 Windows 电脑。
有网络时请直接使用客户端“检查更新”，不需要本补丁。

使用：
1. 完全退出 Netcatty（含托盘）。
2. 解压本 zip，双击 install-cmdb-patch.cmd，按提示输入 y。
   安装目录不是默认的 %LOCALAPPDATA%\Programs\Netcatty 时，在命令行运行：
   install-cmdb-patch.cmd -InstallDir "D:\你的安装目录"

规则：
- 只替换 resources\app.asar 与 resources\cmdb 下的文件，不改用户数据和数据库。
- 本机 Netcatty 的上游版本必须与补丁一致（见 patch-manifest.json 的 upstreamRelease），不一致时拒绝安装，需改装对应版本的完整安装包。
- 覆盖前备份到安装目录下的 cmdb-patch-backup\<时间>，写入后逐个校验 SHA-256，失败自动恢复。
- 恢复旧版：把备份目录里的 resources 覆盖回安装目录即可。
