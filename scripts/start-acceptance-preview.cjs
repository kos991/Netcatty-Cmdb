// 一键启动“正确分支”的 Cmdb 原生验收客户端。
// 只使用隔离的 build/ 目录与独立数据库，不读取、不写入正式安装数据。
// 用法：node scripts/start-acceptance-preview.cjs [--seed] [--port 18974] [--debug-port 9254]
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(readFlag('--port', '18974'));
const debugPort = Number(readFlag('--debug-port', '9254'));
const shouldSeed = args.includes('--seed');

const target = path.resolve(process.env.NETCATTY_PREVIEW_TARGET || path.join(buildDir, 'netcatty-prototype-layout'));
const data = path.resolve(process.env.NETCATTY_PREVIEW_DATA || path.join(buildDir, 'prototype-ci-preview'));
const server = path.resolve(process.env.NETCATTY_PREVIEW_SERVER || path.join(buildDir, 'cmdb-server-prototype-ci.exe'));
const electron = path.resolve(process.env.NETCATTY_PREVIEW_ELECTRON || path.join(buildDir, 'electron-runtime-preview', 'electron.exe'));

const fail = (message) => {
  console.error(`验收客户端启动失败：${message}`);
  process.exit(1);
};

for (const file of [path.join(target, 'electron', 'main.cjs'), path.join(target, 'dist', 'index.html'), server, electron]) {
  if (!fs.existsSync(file)) fail(`缺少构建产物：${file}\n请先运行 scripts/prepare-netcatty.mjs 装配、go build 编译服务端并准备 Electron 运行时。`);
}

fs.mkdirSync(path.join(data, 'profile'), { recursive: true });

// --seed 会重置测试数据库，丢弃当前测试修改；日常重启不应传此选项。
if (shouldSeed) {
  const seed = path.join(__dirname, 'seed-acceptance-data.cjs');
  const result = spawnSync(process.execPath, [seed, '--data', data, '--server', server, '--port', String(port + 2)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NETCATTY_CMDB_DB_PATH: path.join(data, 'assets.db') },
  });
  if (result.status !== 0) fail('验收数据写入失败，请查看上方输出。');
}

const env = {
  ...process.env,
  NETCATTY_CMDB_DB_PATH: path.join(data, 'assets.db'),
  NETCATTY_CMDB_SERVER_PATH: server,
  NETCATTY_PREVIEW_DEBUG_PORT: String(debugPort),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;

const stdoutPath = path.join(data, 'preview-stdout.log');
const stderrPath = path.join(data, 'preview-stderr.log');
const stdout = fs.openSync(stdoutPath, 'a');
const stderr = fs.openSync(stderrPath, 'a');
const child = spawn(electron, [`--user-data-dir=${path.join(data, 'profile')}`, path.join(__dirname, 'start-native-preview.cjs')], {
  cwd: target,
  env: { ...env, NETCATTY_PREVIEW_TARGET: target, NETCATTY_PREVIEW_DATA: data, NETCATTY_PREVIEW_SERVER: server, NETCATTY_PREVIEW_PORT: String(port) },
  detached: true,
  windowsHide: false,
  stdio: ['ignore', stdout, stderr],
});
fs.closeSync(stdout);
fs.closeSync(stderr);

child.on('error', (error) => fail(error.message));
child.on('spawn', () => {
  console.log(`验收客户端已启动（PID ${child.pid}）。`);
  console.log(`  源码：${target}`);
  console.log(`  数据：${data}\\assets.db（隔离，不影响正式安装）`);
  console.log(`  Cmdb 服务：http://127.0.0.1:${port}`);
  console.log(`  调试端口：${debugPort}`);
  console.log(`  启动日志：${stdoutPath} / ${stderrPath}`);
  console.log('  验收清单见 docs/acceptance-checklist.md');
});
child.unref();
