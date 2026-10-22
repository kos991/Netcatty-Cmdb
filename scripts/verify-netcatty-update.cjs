// Run with the integrated Electron binary; uses real electron-updater and a loopback feed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const Module = require('node:module');
const target = path.resolve(process.argv.at(-2));
const installer = path.resolve(process.argv.at(-1));
const requireHost = Module.createRequire(path.join(target, 'package.json'));
const { app, BrowserWindow } = require('electron');
const { NsisUpdater } = requireHost('electron-updater');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'netcatty-update-smoke-'));
app.setPath('userData', path.join(temporary, 'user-data'));
// 当前版本取自 VERSION；高一天的 1.0.YYYYMMDD 只用于模拟“有新版本”。
const currentVersion = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
const [, datePart] = /^1\.0\.(\d{8})$/.exec(currentVersion) || [];
assert.ok(datePart, `VERSION ${currentVersion} must use 1.0.YYYYMMDD`);
const nextDate = new Date(Date.UTC(+datePart.slice(0, 4), +datePart.slice(4, 6) - 1, +datePart.slice(6) + 1));
const nextVersion = `1.0.${nextDate.toISOString().slice(0, 10).replaceAll('-', '')}`;
app.getVersion = () => currentVersion;
let feedVersion = currentVersion;
let responseMode = 'ok';
let installerRequests = 0;
const installerSize = fs.statSync(installer).size;
const installerSha = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
const events = [];
const report = { installer, scenarios: [], isolatedUserData: app.getPath('userData') };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/latest.yml')) {
    if (responseMode === '404') { res.writeHead(404); res.end('missing metadata'); return; }
    if (responseMode === 'invalid') { res.end('version: invalid\nfiles: []\n'); return; }
    const sha = responseMode === 'checksum' ? Buffer.alloc(64).toString('base64') : installerSha;
    res.setHeader('Content-Type', 'text/yaml');
    res.end(`version: ${feedVersion}\nfiles:\n  - url: Netcatty-setup.exe\n    sha512: ${sha}\n    size: ${installerSize}\npath: Netcatty-setup.exe\nsha512: ${sha}\nreleaseDate: '2026-10-21T00:00:00.000Z'\nreleaseNotes: 'Cmdb local updater contract smoke'\n`);
  } else if (req.url === '/Netcatty-setup.exe') {
    installerRequests++;
    res.setHeader('Content-Length', installerSize);
    fs.createReadStream(installer).pipe(res);
  } else { res.writeHead(404); res.end(); }
});
(async () => {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const updater = new NsisUpdater({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}/` });
  updater.forceDevUpdateConfig = true;
  updater.disableDifferentialDownload = true;
  const configPath = path.join(temporary, 'app-update.yml');
  updater.updateConfigPath = configPath;
  fs.writeFileSync(configPath, `provider: generic\nurl: http://127.0.0.1:${server.address().port}/\nupdaterCacheDirName: netcatty-update-smoke-${process.pid}\n`);
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron-updater' && parent?.filename.endsWith('autoUpdateBridge.cjs')) return { autoUpdater: updater };
    return originalLoad.call(this, request, parent, isMain);
  };
  const bridge = require(path.join(target, 'electron/bridges/autoUpdateBridge.cjs'));
  bridge.init({ electronModule: { app, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel, payload) => events.push({ channel, payload }) } }] } } });
  const handlers = new Map();
  bridge.registerHandlers({ handle: (name, handler) => handlers.set(name, handler) });
  const invoke = (name, args) => handlers.get(`netcatty:update:${name}`)(null, args);
  await invoke('setAutoUpdate', { enabled: false });
  let result = await invoke('check');
  assert.equal(result.available, false);
  assert.equal(result.error, undefined);
  report.scenarios.push('equal version: no update');
  responseMode = '404';
  result = await invoke('check');
  assert.match(result.error, /404/);
  assert.match((await invoke('getStatus')).checkError, /不能据此判断已是最新版/);
  report.scenarios.push('HTTP 404: explicit source error');
  responseMode = 'invalid';
  result = await invoke('check');
  assert.ok(result.error);
  report.scenarios.push('invalid metadata: explicit error');
  responseMode = 'ok'; feedVersion = nextVersion;
  const [first, second] = await Promise.all([invoke('check'), invoke('check')]);
  assert.equal(first.available, true); assert.equal(second.available, true);
  assert.equal(installerRequests, 0);
  assert.equal((await invoke('getStatus')).status, 'available');
  assert.equal((await invoke('getStatus')).releaseNotes, 'Cmdb local updater contract smoke');
  report.scenarios.push('concurrent checks share result; disabled auto download makes zero installer requests');
  responseMode = 'checksum';
  await invoke('check');
  result = await invoke('download');
  assert.equal(result.success, false);
  assert.match(result.error, /checksum|sha512/i);
  report.scenarios.push('installer SHA512 mismatch: download rejected');
  responseMode = 'ok';
  await invoke('check');
  result = await invoke('download');
  assert.equal(result.success, true);
  assert.equal((await invoke('getStatus')).status, 'ready');
  assert.equal((await invoke('getStatus')).percent, 100);
  assert.ok(events.some(event => event.channel.endsWith('downloaded')));
  report.scenarios.push('real NSIS installer downloaded, hash verified, IPC ready event received');
  report.note = `Loopback feed advertises ${nextVersion} only to exercise availability; downloaded installer remains VERSION ${currentVersion}. Actual installation is performed separately with the production NSIS installer.`;
  const reportPath = path.join(target, '..', 'netcatty-update-smoke.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  server.close();
  app.exit(0);
})().catch(error => { console.error(error); server.close(); app.exit(1); });
