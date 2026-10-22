/**
 * Auto-Update Bridge
 *
 * Wraps electron-updater to provide IPC-driven update checks, downloads, and
 * install-on-quit. Designed around a "prompt" model: the renderer asks to
 * check, then explicitly triggers download and install.
 *
 * Linux packages use electron-updater's package-manager path when the
 * electron-builder package-type marker is present. Unmarked Linux builds
 * (including snap and development runs) get a graceful fallback so the
 * renderer can offer a manual "open GitHub releases" link.
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

/** Track whether a download is in progress to distinguish download errors from check errors */
let _isDownloading = false;

/** Track whether quitAndInstall has entered the package installation phase */
let _isInstalling = false;

/** Shared check/download promises prevent concurrent windows from racing. */
let _isChecking = false;
let _checkPromise = null;
let _downloadPromise = null;
let _lastStatus = { status: 'idle', percent: 0, error: null, checkError: null, version: null, releaseNotes: '', releaseDate: null, checkedAt: null, isChecking: false };

function releaseDetails(info) {
  return {
    version: info.version || null,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : Array.isArray(info.releaseNotes) ? info.releaseNotes.map(note => note.note || '').join('\n') : '',
    releaseDate: info.releaseDate || null,
  };
}

function updateError(err) {
  const message = err?.message || String(err);
  return `更新检查失败：${message}${/404|ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/.test(message) ? '（发布源不可访问或更新元数据缺失，不能据此判断已是最新版）' : ''}`;
}

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
      if (result.downloadPromise) {
        _downloadPromise = result.downloadPromise;
        void _downloadPromise.catch(() => {});
      }
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
    autoUpdater.autoDownload = readAutoUpdatePreference();
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
 * Register persistent global IPC event listeners for auto-download flow.
 * Called once in init(). Forwards electron-updater events to the renderer
 * even when no manual download was initiated.
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
    // Only track as downloading when autoDownload is enabled — otherwise no
    // download will actually start and the status would be stuck at 0%.
    // Use 'available' so late-opening windows can still hydrate the version.
    const willDownload = updater.autoDownload !== false;
    _isDownloading = willDownload;
    _lastStatus = { status: willDownload ? 'downloading' : 'available', percent: 0, error: null, checkError: null, ...releaseDetails(info), checkedAt: Date.now(), isChecking: false };
    broadcastToAllWindows("netcatty:update:update-available", releaseDetails(info));
  });

  updater.on("download-progress", (info) => {
    _lastStatus = { ..._lastStatus, status: 'downloading', percent: Math.round(info.percent ?? 0) };
    broadcastToAllWindows("netcatty:update:download-progress", {
      percent: info.percent ?? 0,
      bytesPerSecond: info.bytesPerSecond ?? 0,
      transferred: info.transferred ?? 0,
      total: info.total ?? 0,
    });
  });

  updater.on("update-downloaded", () => {
    _isDownloading = false;
    _lastStatus = { ..._lastStatus, status: 'ready', percent: 100 };
    broadcastToAllWindows("netcatty:update:downloaded");
  });

  updater.on("error", (err) => {
    _isChecking = false;
    if (!_isDownloading && !_isInstalling) {
      const error = updateError(err);
      _lastStatus = { ..._lastStatus, isChecking: false, checkError: error };
      broadcastToAllWindows('netcatty:update:error', { error });
      return;
    }
    _isDownloading = false;
    const errorMsg = updateError(err);
    if (_isInstalling) {
      _isInstalling = false;
      cancelQuittingForUpdateWatchdog();
      setQuittingForUpdate(false);
    }
    _lastStatus = { ..._lastStatus, status: 'error', error: errorMsg };
    broadcastToAllWindows("netcatty:update:error", {
      error: errorMsg,
    });
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
    // Respect autoDownload flag — the renderer may have disabled it via IPC
    // before this timer fires.
    if (updater.autoDownload === false) {
      console.log("[AutoUpdate] Auto-check skipped — autoDownload is disabled");
      return;
    }
    if (_isDownloading || _lastStatus.status === 'ready') return;
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
 * Flip the windowManager "quitting for update" flag, swallowing the case where
 * the window manager module isn't available. Used by the install handler to
 * commit the app to a clean quit before quitAndInstall, and to roll back if the
 * install never actually quits (#1215).
 */
function setQuittingForUpdate(enabled) {
  try {
    const windowManager = require("./windowManager.cjs");
    windowManager.setQuittingForUpdate(!!enabled);
  } catch {
    // ignore — window manager may not be available
  }
}

/**
 * The webContents for usable dirty-editor windows. Used by the install handler
 * to ask every renderer that can own editor tabs about unsaved work before
 * committing to a quit. Targets registered editor owners specifically (not
 * getAllWindows()[0]) so we never query tray/settings windows, whose renderers
 * don't participate in the dirty-editor protocol.
 */
function getDirtyEditorWebContentsList() {
  try {
    const windowManager = require("./windowManager.cjs");
    const windows = typeof windowManager.getDirtyEditorWindows === "function"
      ? windowManager.getDirtyEditorWindows()
      : typeof windowManager.getMainWindows === "function"
        ? windowManager.getMainWindows()
        : [windowManager.getMainWindow?.()].filter(Boolean);
    return windows
      .filter((win) => win && !win.isDestroyed?.())
      .map((win) => win.webContents)
      .filter((wc) => wc && !wc.isDestroyed?.() && !wc.isCrashed?.());
  } catch {
    return [];
  }
}

/**
 * Tell the renderer that the update can't install yet because there are unsaved
 * editors. The renderer surfaces a toast asking the user to save, then click
 * "Restart Now" again.
 *
 * Broadcast to ALL windows, not just the main one: the install can be triggered
 * from the Settings window's "Restart to Update" button, and that's the focused
 * window the user is looking at. Sending only to the (possibly hidden/behind)
 * main window would make the click appear to do nothing (#1215 review). The
 * unsaved editors live in the main window, but every window surfaces the same
 * "save first" notice so it lands wherever the user is.
 */
function notifyNeedsSave() {
  broadcastToAllWindows("netcatty:update:needs-save");
}

/** Max time to wait for the renderer's unsaved-editors reply before the install
 *  fails open and proceeds (matches the before-quit guard timeout). */
const INSTALL_DIRTY_CHECK_TIMEOUT_MS = 5000;

/**
 * Ask the main-window renderer whether it has unsaved editor changes, reusing
 * the shared dirty-editor round-trip. Resolves false (fail open) if the helper
 * is unavailable, so a missing module can never block an install. `ipcMain` is
 * the instance passed to registerHandlers; the helper needs it to listen for
 * the reply.
 */
function queryDirtyEditorsSafe(webContents, ipcMain) {
  try {
    const { queryDirtyEditors } = require("./dirtyEditorGuard.cjs");
    return queryDirtyEditors(webContents, INSTALL_DIRTY_CHECK_TIMEOUT_MS, { ipcMain });
  } catch (err) {
    console.warn("[AutoUpdate] dirty-editor guard unavailable:", err?.message || err);
    return Promise.resolve(false);
  }
}

/**
 * If quitAndInstall doesn't lead to the app actually quitting (it returns
 * without app.quit(), e.g. on a Squirrel.Mac follow-up error or a stale
 * downloaded file), the quitting-for-update flags would stay set and
 * permanently bypass close-to-tray + the dirty-editor quit guard. This
 * watchdog clears them if we're still running after a grace period.
 *
 * The grace period is deliberately long. On macOS quitAndInstall() can return
 * while Squirrel.Mac is still pulling the already-downloaded ZIP from the local
 * update server before it actually closes the windows; for a large/slow update
 * that second stage can take well over 10s. If the watchdog cleared isQuitting
 * during that window, the eventual native quit would hit a *non*-quitting
 * close-to-tray handler and get stranded again — the exact #1215 failure. So we
 * only roll back after a window long enough that the app is realistically stuck,
 * not merely slow. The cost of waiting longer is just that close-to-tray stays
 * bypassed a bit longer in the rare genuine-failure case (#1215 review).
 */
let _quittingForUpdateWatchdog = null;
const QUITTING_FOR_UPDATE_WATCHDOG_MS = 60000;

function cancelQuittingForUpdateWatchdog() {
  if (_quittingForUpdateWatchdog) {
    clearTimeout(_quittingForUpdateWatchdog);
    _quittingForUpdateWatchdog = null;
  }
}

function scheduleQuittingForUpdateWatchdog() {
  if (_quittingForUpdateWatchdog) {
    clearTimeout(_quittingForUpdateWatchdog);
  }
  _quittingForUpdateWatchdog = setTimeout(() => {
    _quittingForUpdateWatchdog = null;
    _isInstalling = false;
    // Still alive after the grace period — the install did not quit the app.
    console.warn("[AutoUpdate] App still running after quitAndInstall; clearing quitting-for-update state");
    setQuittingForUpdate(false);
  }, QUITTING_FOR_UPDATE_WATCHDOG_MS);
  // Don't let the watchdog keep the event loop (and thus the process) alive —
  // if the app is otherwise ready to quit, the timer must not block it.
  if (typeof _quittingForUpdateWatchdog.unref === "function") {
    _quittingForUpdateWatchdog.unref();
  }
}

/**
 * Cancel an install after the main quit guard finds unsaved editor changes.
 * The main process owns the dirty-editor decision, but the install lifecycle
 * state lives here and must be released together with the window-manager flag.
 */
function cancelPendingInstall() {
  if (!_isInstalling) return;
  _isInstalling = false;
  cancelQuittingForUpdateWatchdog();
  setQuittingForUpdate(false);
}

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

    // If a download is already in progress or the update is ready to install,
    // skip the check entirely — calling checkForUpdates() while downloading
    // can cause electron-updater to error, which corrupts the download state
    // and forces the user to download manually (GitHub issue #522).
    if (_isDownloading) {
      return { available: true, supported: true, ...releaseDetails(_lastStatus) };
    }
    if (_lastStatus.status === 'ready') {
      return { available: true, supported: true, ...releaseDetails(_lastStatus) };
    }

    return performUpdateCheck();
  });

  // ---- Download update ---------------------------------------------------
  ipcMain.handle("netcatty:update:download", async () => {
    if (_lastStatus.status === 'ready') return { success: true };
    if (_isDownloading && _downloadPromise) {
      try { await _downloadPromise; return { success: true }; }
      catch (err) { return { success: false, error: updateError(err) }; }
    }
    const updater = getAutoUpdater();
    if (!updater) {
      return { success: false, error: "Update module not available." };
    }
    try {
      _isDownloading = true;
      _lastStatus = { ..._lastStatus, status: 'downloading', percent: 0, error: null };
      _downloadPromise = updater.downloadUpdate();
      await _downloadPromise;
      return { success: true };
    } catch (err) {
      _isDownloading = false;
      _lastStatus = { ..._lastStatus, status: 'error', error: err?.message || "Download failed", percent: 0 };
      // Don't broadcast here — the global updater "error" listener already handles it
      console.error("[AutoUpdate] Download failed:", err?.message || err);
      return { success: false, error: err?.message || "Download failed" };
    }
  });

  // ---- Get current update status (for late-opening windows) ---------------
  ipcMain.handle("netcatty:update:getStatus", () => {
    return { ..._lastStatus };
  });

  // ---- Install (quit & install) ------------------------------------------
  ipcMain.handle("netcatty:update:install", async () => {
    const updater = getAutoUpdater();
    if (!updater) return;
    if (_isInstalling) return;

    // Check for unsaved editors BEFORE committing to a quit (#1215 review).
    //
    // On macOS quitAndInstall() closes windows first and only then fires
    // before-quit. Once setQuittingForUpdate(true) lets the main window
    // actually close (instead of hiding to tray), the before-quit dirty-editor
    // guard can run after the window is already gone — isReachableByUser is
    // false, so it commits the quit and silently drops unsaved SFTP edits.
    //
    // So we ask the renderer here, while the window and renderer are still
    // alive. If there's unsaved work in any main window, abort the install
    // (don't touch the quitting flags, don't quitAndInstall) and tell the
    // renderer to prompt the user to save; they can click "Restart Now" again
    // afterwards. If no main window is reachable (no window / crashed
    // renderer) there's no user to ask, so we install directly — matching the
    // before-quit fail-open path.
    const editorWebContents = getDirtyEditorWebContentsList();
    if (editorWebContents.length > 0) {
      const dirtyResults = await Promise.all(
        editorWebContents.map((webContents) => queryDirtyEditorsSafe(webContents, ipcMain)),
      );
      if (dirtyResults.some(Boolean)) {
        // Broadcast so the notice reaches whichever window the user clicked
        // from (main or Settings), not just the main window we queried.
        notifyNeedsSave();
        return;
      }
    }

    // Another request may have completed its dirty-editor check while this
    // request was waiting. Only one request may commit the app to a quit.
    if (_isInstalling) return;

    // Commit the app to a real quit BEFORE quitAndInstall fires app.quit().
    // Without this the in-place install silently fails (#1215): the main-window
    // close handler hides to tray when close-to-tray is on, so the process
    // stays alive and Squirrel.Mac's ShipIt helper — which waits on the parent
    // PID to die before swapping the bundle — ends up in launchd "pending
    // spawn" limbo and never installs. setQuittingForUpdate(true) sets
    // isQuitting so close-to-tray is bypassed and the window actually closes.
    _isInstalling = true;
    setQuittingForUpdate(true);

    // On macOS, the system tray keeps the app process alive even after all
    // windows are closed, which prevents quitAndInstall from completing.
    // Destroy the tray (and its panel window) before quitting so the app
    // can exit cleanly and the installer can proceed.
    if (process.platform === "darwin") {
      try {
        const globalShortcutBridge = require("./globalShortcutBridge.cjs");
        globalShortcutBridge.cleanup();
      } catch {
        // ignore — bridge may not be available
      }
    }

    try {
      updater.quitAndInstall(false, true);
    } catch (err) {
      // quitAndInstall threw synchronously — the app will NOT quit. Roll back
      // the quitting-for-update flags so later closes/quits behave normally
      // instead of permanently bypassing close-to-tray + the dirty-editor
      // guard (#1215 review).
      console.error("[AutoUpdate] quitAndInstall failed:", err?.message || err);
      _isInstalling = false;
      cancelQuittingForUpdateWatchdog();
      setQuittingForUpdate(false);
      return;
    }

    // Linux package-manager failures emit the updater error synchronously from
    // quitAndInstall(). The error listener clears _isInstalling in that case,
    // so do not install a watchdog after the failure has already been handled.
    if (!_isInstalling) return;

    // quitAndInstall can also fail to quit asynchronously (e.g. Squirrel.Mac's
    // follow-up check errors, or a stale/missing downloaded file) — it returns
    // without app.quit() ever firing. A watchdog clears the flags if we're
    // still alive shortly after, so the app doesn't get stuck in a state where
    // every window close bypasses close-to-tray and the dirty-editor guard.
    scheduleQuittingForUpdateWatchdog();
  });

  // ---- Get auto-update preference -----------------------------------------
  ipcMain.handle("netcatty:update:getAutoUpdate", () => {
    return { enabled: readAutoUpdatePreference() };
  });

  // ---- Enable/disable auto-update ----------------------------------------
  let _prevAutoDownloadEnabled = readAutoUpdatePreference();
  ipcMain.handle("netcatty:update:setAutoUpdate", (_event, { enabled }) => {
    const wasEnabled = _prevAutoDownloadEnabled;
    _prevAutoDownloadEnabled = !!enabled;
    const updater = getAutoUpdater();
    if (updater) {
      updater.autoDownload = !!enabled;
      console.log("[AutoUpdate] autoDownload set to:", !!enabled);
    }
    // Persist so the preference survives app restarts
    writeAutoUpdatePreference(!!enabled);
    if (!enabled) {
      cancelAutoCheck();
    } else if (!wasEnabled && !_isChecking) {
      // Only re-schedule when actually re-enabling (not on every mount sync),
      // to avoid duplicate checks from multiple windows initializing.
      // Skip if a check is already in flight to prevent concurrent calls.
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
