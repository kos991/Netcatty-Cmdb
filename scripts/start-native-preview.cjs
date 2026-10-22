// 使用独立数据库和用户目录启动原生客户端，保留真实文件选择、保存对话框。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const target = path.resolve(process.env.NETCATTY_PREVIEW_TARGET || path.join(root, 'build', 'netcatty-native-ui'));
const data = path.resolve(process.env.NETCATTY_PREVIEW_DATA || path.join(root, 'build', 'native-ui-preview'));
const server = path.resolve(process.env.NETCATTY_PREVIEW_SERVER || path.join(root, 'build', 'cmdb-server-native-ui.exe'));
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
  const candidates = [
    process.env.NETCATTY_PREVIEW_ELECTRON,
    ...[target, path.join(root, 'build', 'netcatty')]
      .map(directory => path.join(directory, 'node_modules', 'electron', 'dist', 'electron.exe')),
    path.join(root, 'build', 'electron-runtime-preview', 'electron.exe'),
  ].filter(Boolean);
  const executable = candidates.find(file => fs.existsSync(file));
  if (!executable) throw new Error('本地 Electron 尚未安装，请先安装 Netcatty 的桌面运行依赖');
  for (const file of [server, executable, path.join(target, 'dist', 'index.html')]) {
    if (!fs.existsSync(file)) throw new Error(`缺少本地构建产物：${file}`);
  }
  fs.mkdirSync(path.join(data, 'profile'), { recursive: true });
  const env = { ...process.env, NETCATTY_CMDB_DB_PATH: path.join(data, 'assets.db'), NETCATTY_CMDB_SERVER_PATH: server };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const stdoutPath = path.join(data, 'preview-stdout.log');
  const stderrPath = path.join(data, 'preview-stderr.log');
  const stdout = fs.openSync(stdoutPath, 'a');
  const stderr = fs.openSync(stderrPath, 'a');
  const child = spawn(executable, [`--user-data-dir=${path.join(data, 'profile')}`, __filename], { cwd: target, env, detached: true, windowsHide: false, stdio: ['ignore', stdout, stderr] });
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  child.on('error', error => { console.error('客户端启动失败：', error.message); process.exitCode = 1; });
  child.on('spawn', () => console.log(`测试进程已创建（PID ${child.pid}）；源码：${target}；测试数据：${data}；启动日志：${stdoutPath} / ${stderrPath}`));
  child.unref();
}
