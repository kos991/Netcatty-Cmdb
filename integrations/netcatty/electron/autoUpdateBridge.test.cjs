// Netcatty-Cmdb 集成版升级桥测试：只检查上游版本，下载与安装一律拒绝，错误不泄露响应头。
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const BRIDGE_PATH = require.resolve("./autoUpdateBridge.cjs");

function loadBridge(fakeUpdater) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron-updater") return { autoUpdater: fakeUpdater };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[BRIDGE_PATH];
  try {
    const bridge = require("./autoUpdateBridge.cjs");
    const handlers = new Map();
    const sent = [];
    const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn), on() {}, removeListener() {} };
    const app = { getPath: () => require("node:os").tmpdir(), isPackaged: true };
    const BrowserWindow = { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel, payload) => sent.push({ channel, payload }) } }] };
    bridge.init({ electronModule: { app, BrowserWindow } });
    bridge.registerHandlers(ipcMain);
    return { bridge, invoke: (channel, ...args) => handlers.get(channel)({}, ...args), sent };
  } finally {
    Module._load = originalLoad;
  }
}

function fakeUpdater(overrides = {}) {
  const calls = { download: 0, install: 0 };
  return {
    calls,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: undefined,
    on() {},
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: "1.1.86", releaseNotes: "notes", releaseDate: "2026-10-23" } }),
    downloadUpdate: async () => { calls.download += 1; },
    quitAndInstall: () => { calls.install += 1; },
    ...overrides,
  };
}

const withWindowsPackage = async (fn) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32" });
  try { await fn(); } finally { Object.defineProperty(process, "platform", platform); }
};

test("加载后固定关闭自动下载与退出时安装", () => withWindowsPackage(async () => {
  const updater = fakeUpdater();
  const { invoke } = loadBridge(updater);
  await invoke("netcatty:update:check");
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  await invoke("netcatty:update:setAutoUpdate", { enabled: true });
  assert.equal(updater.autoDownload, false);
}));

test("检查只返回上游新版本信息", () => withWindowsPackage(async () => {
  const { invoke } = loadBridge(fakeUpdater());
  const result = await invoke("netcatty:update:check");
  assert.equal(result.available, true);
  assert.equal(result.version, "1.1.86");
}));

test("下载与安装上游官方包被拒绝，不调用 electron-updater", () => withWindowsPackage(async () => {
  const updater = fakeUpdater();
  const { invoke, sent } = loadBridge(updater);
  await invoke("netcatty:update:check");
  const download = await invoke("netcatty:update:download");
  assert.equal(download.success, false);
  assert.match(download.error, /覆盖 Cmdb/);
  await invoke("netcatty:update:install");
  assert.equal(updater.calls.download, 0);
  assert.equal(updater.calls.install, 0);
  assert.ok(sent.some(({ channel, payload }) => channel === "netcatty:update:error" && /覆盖 Cmdb/.test(payload.error)));
}));

test("检查失败只显示简短原因，不泄露响应头和 cookie", () => withWindowsPackage(async () => {
  const leaked = "HttpError: 404 \n\"method: GET url: https://github.com/x/releases.atom\"\nHeaders: {\"set-cookie\":[\"_gh_sess=secret\"]}";
  const { invoke } = loadBridge(fakeUpdater({ checkForUpdates: async () => { throw new Error(leaked); } }));
  const result = await invoke("netcatty:update:check");
  assert.match(result.error, /HTTP 404/);
  assert.doesNotMatch(result.error, /set-cookie|_gh_sess|Headers/);
}));
