// 使用独立数据库和用户目录启动原生客户端，保留真实文件选择、保存对话框。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const target = path.resolve(process.env.NETCATTY_PREVIEW_TARGET || path.join(root, 'build', 'netcatty-native-ui'));
const data = path.join(root, 'build', 'native-ui-preview');
const server = path.join(root, 'build', 'cmdb-server-native-ui.exe');
const port = Number(process.env.NETCATTY_PREVIEW_PORT || 18082);

if (process.versions.electron) {
  const { app } = require('electron');
  if (process.env.NETCATTY_PREVIEW_DEBUG_PORT) {
    app.commandLine.appendSwitch('remote-debugging-port', process.env.NETCATTY_PREVIEW_DEBUG_PORT);
  }
  app.setAppPath(target);
  app.setPath('userData', path.join(data, 'profile'));
  const service = require(path.join(target, 'electron', 'cmdbService.cjs'));
  const start = service.startCmdbService;
  service.startCmdbService = options => start({ ...options, port });
  require(path.join(target, 'electron', 'main.cjs'));
} else {
  const candidates = [target, path.join(root, 'build', 'netcatty')]
    .map(directory => path.join(directory, 'node_modules', 'electron', 'dist', 'electron.exe'));
  const executable = candidates.find(file => fs.existsSync(file));
  if (!executable) throw new Error('本地 Electron 尚未安装，请先安装 Netcatty 的桌面运行依赖');
  for (const file of [server, executable, path.join(target, 'dist', 'index.html')]) {
    if (!fs.existsSync(file)) throw new Error(`缺少本地构建产物：${file}`);
  }
  fs.mkdirSync(path.join(data, 'profile'), { recursive: true });
  const env = { ...process.env, NETCATTY_CMDB_DB_PATH: path.join(data, 'assets.db'), NETCATTY_CMDB_SERVER_PATH: server };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const child = spawn(executable, [__filename], { cwd: target, env, detached: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', error => { console.error('客户端启动失败：', error.message); process.exitCode = 1; });
  child.on('spawn', () => console.log(`原生测试客户端已启动，测试数据目录：${data}`));
  child.unref();
}
