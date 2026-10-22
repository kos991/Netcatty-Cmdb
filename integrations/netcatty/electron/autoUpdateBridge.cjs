/**
 * Auto-Update Bridge (Netcatty-Cmdb)
 *
 * 只检查上游 Netcatty 官方发布，用于提示有新版本；不下载、不安装。
 * 上游官方安装包不含 Cmdb，直接安装会覆盖集成版，所以下载和安装 IPC 一律拒绝，
 * 自动下载固定关闭。Cmdb 集成版通过本项目发布的安装包或离线补丁安装器升级。
 */

let _deps = null;

/**
 * Read the persisted auto-update preference from a JSON file in userData.
 * Returns true (default) if the file doesn't exist or is unreadable.
 */
function readAutoUpdatePreference() {
  try {
    const { app } = _deps?.electronModule || {};
    if (!app) return true;
    const path = require('path');
    const fs = require('fs');
    const prefPath = path.join(app.getPath('userData'), 'auto-update-pref.json');
    const data = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
    return data.enabled !== false;
  } catch {
    return true; // default to enabled
  }
}

/**
 * Persist the auto-update preference to a JSON file in userData.
 */
function writeAutoUpdatePreference(enabled) {
  try {
    const { app } = _deps?.electronModule || {};
    if (!app) return;
    const path = require('path');
    const fs = require('fs');
    const prefPath = path.join(app.getPath('userData'), 'auto-update-pref.json');
    fs.writeFileSync(prefPath, JSON.stringify({ enabled }), 'utf8');
  } catch (err) {
    console.warn('[AutoUpdate] Failed to write preference:', err?.message || err);
  }
}

const SUPPORTED_LINUX_PACKAGE_TYPES = new Set(["deb", "rpm", "pacman"]);

/**
 * Identify the Linux package format written by electron-builder into the
 * packaged resources directory. AppImage does not have this marker; its
 * runtime exposes the APPIMAGE environment variable instead.
 */
function getLinuxPackageType() {
  if (process.env.APPIMAGE) return "AppImage";
  if (typeof process.resourcesPath !== "string") return null;

  try {
    const fs = require("fs");
    const path = require("path");
    const packageType = fs.readFileSync(path.join(process.resourcesPath, "package-type"), "utf8").trim();
    return SUPPORTED_LINUX_PACKAGE_TYPES.has(packageType) ? packageType : null;
  } catch {
    return null;
  }
}

/**
 * Returns true when the current packaging format supports electron-updater
 * (macOS zip/dmg, Windows NSIS, Linux AppImage/deb/rpm/pacman).
 */
function isAutoUpdateSupported() {
  if (process.platform === "darwin" || process.platform === "win32") {
    return true;
  }
  return process.platform === "linux" && getLinuxPackageType() !== null;
}

/** Lazily resolved autoUpdater — avoids importing electron-updater in
 *  contexts where native modules might not be available. */
let _autoUpdater = null;

/** Guard against duplicate listener registration */
let _listenersRegistered = false;

/** Shared check promise prevents concurrent windows from racing. */
let _isChecking = false;
let _checkPromise = null;
let _lastStatus = { status: 'idle', percent: 0, error: null, checkError: null, version: null, releaseNotes: '', releaseDate: null, checkedAt: null, isChecking: false };

function releaseDetails(info) {
  return {
    version: info.version || null,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : Array.isArray(info.releaseNotes) ? info.releaseNotes.map(note => note.note || '').join('\n') : '',
    releaseDate: info.releaseDate || null,
  };
}

// 只保留简短原因：electron-updater 的错误消息会附带完整响应头（含 set-cookie），不能展示给用户。
function updateError(err) {
  const raw = String(err?.message || err || '');
  const status = /\b(404|403|401|5\d\d)\b/.exec(raw)?.[1];
  if (status === '404' || /ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/.test(raw)) {
    return '更新检查失败：上游发布源不可访问或更新元数据缺失（HTTP 404），不能据此判断已是最新版。';
  }
  if (status) return `更新检查失败：上游发布源返回 HTTP ${status}，请稍后重试。`;
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/.test(raw)) return '更新检查失败：无法连接上游发布源，请检查网络后重试。';
  return `更新检查失败：${raw.split('\n')[0].slice(0, 200) || '未知错误'}`;
}

const UPSTREAM_INSTALL_BLOCKED = '当前为 Netcatty-Cmdb 集成版：上游官方安装包不含 Cmdb，安装会覆盖 Cmdb，已阻止。请等待 Cmdb 集成版适配后，使用项目发布的安装包升级。';

async function performUpdateCheck() {
  if (_checkPromise) return _checkPromise;
  const updater = getAutoUpdater();
  if (!updater) throw new Error('Update module failed to load.');
  _isChecking = true;
  _lastStatus = { ..._lastStatus, isChecking: true, checkError: null };
  _checkPromise = (async () => {
    try {
      const result = await updater.checkForUpdates();
      if (!result?.updateInfo || typeof result.isUpdateAvailable !== 'boolean') throw new Error('更新检查未返回有效结果，请确认运行的是已安装的客户端。');
      return { available: result.isUpdateAvailable, supported: true, ...releaseDetails(result.updateInfo) };
    } catch (err) {
      const error = updateError(err);
      _lastStatus = { ..._lastStatus, checkError: error, isChecking: false };
      broadcastToAllWindows('netcatty:update:error', { error });
      return { available: false, supported: true, error };
    } finally {
      _isChecking = false;
      _lastStatus.isChecking = false;
      _checkPromise = null;
    }
  })();
  return _checkPromise;
}
function getAutoUpdater() {
  if (_autoUpdater) return _autoUpdater;
  try {
    const { autoUpdater } = require("electron-updater");
    // 固定只检查：不自动下载、不在退出时安装上游官方包。
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // Silence the default electron-log transport (we log ourselves).
    autoUpdater.logger = null;
    _autoUpdater = autoUpdater;
    return autoUpdater;
  } catch (err) {
    console.error("[AutoUpdate] Failed to load electron-updater:", err?.message || err);
    return null;
  }
}

/**
 * Register persistent listeners that forward check results to every window.
 * Download events never fire: autoDownload is fixed off and download IPC is blocked.
 */
function setupGlobalListeners() {
  if (_listenersRegistered) return;
  const updater = getAutoUpdater();
  if (!updater) return;
  _listenersRegistered = true;

  updater.on("update-not-available", (info) => {
    _isChecking = false;
    _lastStatus = { status: 'idle', percent: 0, error: null, checkError: null, ...releaseDetails(info), checkedAt: Date.now(), isChecking: false };
    broadcastToAllWindows("netcatty:update:update-not-available", {});
  });

  updater.on("update-available", (info) => {
    _isChecking = false;
    // 只提示上游有新版本，不进入下载状态。
    _lastStatus = { status: 'available', percent: 0, error: null, checkError: null, ...releaseDetails(info), checkedAt: Date.now(), isChecking: false };
    broadcastToAllWindows("netcatty:update:update-available", releaseDetails(info));
  });

  updater.on("error", (err) => {
    _isChecking = false;
    const error = updateError(err);
    _lastStatus = { ..._lastStatus, isChecking: false, checkError: error };
    broadcastToAllWindows('netcatty:update:error', { error });
  });

  console.log("[AutoUpdate] Global listeners registered");
}

/**
 * Trigger an automatic update check after a delay.
 * No-op on platforms that don't support auto-update (for example Linux snap
 * or an unmarked development build).
 * Called from main process after the main window is created.
 *
 * @param {number} delayMs - Milliseconds to wait before checking (default: 5000)
 */
let _autoCheckTimer = null;

function startAutoCheck(delayMs = 5000) {
  if (!isAutoUpdateSupported()) {
    console.log("[AutoUpdate] Platform does not support auto-update, skipping auto-check");
    return;
  }
  // Cancel any existing timer to avoid duplicate concurrent checks
  // (e.g. from multiple windows initializing or re-enable toggle).
  cancelAutoCheck();
  _autoCheckTimer = setTimeout(async () => {
    _autoCheckTimer = null;
    const updater = getAutoUpdater();
    if (!updater) {
      console.warn("[AutoUpdate] Auto-check skipped — updater not available");
      return;
    }
    // 自动检查只做提示，与“自动更新”开关无关的下载已固定关闭；开关关闭时不自动检查。
    if (!readAutoUpdatePreference()) {
      console.log("[AutoUpdate] Auto-check skipped — disabled by preference");
      return;
    }
    if (_isChecking) return;
    await performUpdateCheck();
  }, delayMs);
}

/**
 * Cancel a pending startAutoCheck timer.  Called when the renderer triggers
 * a manual check to avoid racing with the queued auto-check.
 */
function cancelAutoCheck() {
  if (_autoCheckTimer) {
    clearTimeout(_autoCheckTimer);
    _autoCheckTimer = null;
  }
}

/**
 * 宿主主进程在关闭前会调用此函数取消进行中的安装。集成版从不进入安装流程，
 * 保留导出以兼容上游调用点。
 */
function cancelPendingInstall() {}

function init(deps) {
  _deps = deps;
  setupGlobalListeners();
}

/**
 * Broadcast an IPC event to all non-destroyed BrowserWindows.
 * Ensures both the main window and settings window always receive
 * auto-update events.
 * @param {string} channel
 * @param {unknown} [payload]
 */
function broadcastToAllWindows(channel, payload) {
  try {
    const { BrowserWindow } = _deps?.electronModule || {};
    if (!BrowserWindow) return;
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        if (payload !== undefined) {
          win.webContents.send(channel, payload);
        } else {
          win.webContents.send(channel);
        }
      }
    }
  } catch (err) {
    console.warn("[AutoUpdate] broadcastToAllWindows failed:", err?.message || err);
  }
}

function registerHandlers(ipcMain) {
  // ---- Check for updates ------------------------------------------------
  ipcMain.handle("netcatty:update:check", async () => {
    // Cancel any pending auto-check to prevent concurrent checkForUpdates()
    // calls — electron-updater rejects them and surfaces false errors.
    cancelAutoCheck();

    if (!isAutoUpdateSupported()) {
      return {
        available: false,
        supported: false,
        error: "Auto-update is not supported on this platform/package format.",
      };
    }

    const updater = getAutoUpdater();
    if (!updater) {
      return {
        available: false,
        supported: false,
        error: "Update module failed to load.",
      };
    }

    // Share the in-flight result instead of reporting a false 'up to date'.
    if (_checkPromise) return _checkPromise;
    return performUpdateCheck();
  });

  // ---- Download update ---------------------------------------------------
  // 集成版不下载上游官方安装包，避免覆盖 Cmdb。
  ipcMain.handle("netcatty:update:download", async () => {
    return { success: false, error: UPSTREAM_INSTALL_BLOCKED };
  });

  // ---- Get current update status (for late-opening windows) ---------------
  ipcMain.handle("netcatty:update:getStatus", () => {
    return { ..._lastStatus };
  });

  // ---- Install (quit & install) ------------------------------------------
  // 集成版不安装上游官方安装包；即使存在已下载的包也不执行 quitAndInstall。
  ipcMain.handle("netcatty:update:install", async () => {
    _lastStatus = { ..._lastStatus, status: 'error', error: UPSTREAM_INSTALL_BLOCKED };
    broadcastToAllWindows("netcatty:update:error", { error: UPSTREAM_INSTALL_BLOCKED });
  });

  // ---- Get auto-update preference -----------------------------------------
  ipcMain.handle("netcatty:update:getAutoUpdate", () => {
    return { enabled: readAutoUpdatePreference() };
  });

  // ---- Enable/disable auto-update ----------------------------------------
  let _prevAutoCheckEnabled = readAutoUpdatePreference();
  ipcMain.handle("netcatty:update:setAutoUpdate", (_event, { enabled }) => {
    const wasEnabled = _prevAutoCheckEnabled;
    _prevAutoCheckEnabled = !!enabled;
    // 开关只控制启动时是否自动检查；下载始终关闭。
    writeAutoUpdatePreference(!!enabled);
    if (!enabled) {
      cancelAutoCheck();
    } else if (!wasEnabled && !_isChecking) {
      startAutoCheck(2000);
    }
    return { success: true };
  });

  console.log("[AutoUpdate] Handlers registered");
}

module.exports = {
  init,
  registerHandlers,
  isAutoUpdateSupported,
  startAutoCheck,
  cancelPendingInstall,
};
