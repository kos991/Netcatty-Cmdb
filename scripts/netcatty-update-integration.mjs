const UPSTREAM_REPOSITORY = "binaricat/Netcatty";
const PROJECT_REPOSITORY = "kos991/Netcatty-Cmdb";

// 集成版客户端只从本仓库 Release 获取安装包和 latest.yml；指回上游会被替换成不含 Cmdb 的原版。
export function patchUpdateRepositoryConfig(source) {
  return source
    .replaceAll(`api.github.com/repos/${UPSTREAM_REPOSITORY}/releases/latest`, `api.github.com/repos/${PROJECT_REPOSITORY}/releases/latest`)
    .replaceAll(`github.com/${UPSTREAM_REPOSITORY}/releases`, `github.com/${PROJECT_REPOSITORY}/releases`)
    .replaceAll("owner: 'binaricat'", "owner: 'kos991'")
    .replaceAll("repo: 'Netcatty'", "repo: 'Netcatty-Cmdb'");
}

export function patchApplicationRepositoryLinks(source) {
  return source.replaceAll("https://github.com/binaricat/Netcatty", "https://github.com/kos991/Netcatty-Cmdb");
}

export function patchUpdateConsumers(path, source) {
  if (path.endsWith('SettingsApplicationTab.tsx')) {
    return source.replace('  isUpdateDemoMode: boolean;\n', '')
      .replace(', isUpdateDemoMode }', ' }')
      .replace('    // In demo mode, allow checking even for dev builds\n', '')
      .replace("if (!isUpdateDemoMode && (!appInfo.version || appInfo.version === '0.0.0'))", "if (!appInfo.version || appInfo.version === '0.0.0')")
      .replace('    if (result?.hasUpdate && result.latestRelease) {', "    if (result?.error) {\n      toast.error(result.error);\n    } else if (result?.hasUpdate && result.latestRelease) {");
  }
  if (path.endsWith('SettingsPage.tsx')) return source.replace(', isUpdateDemoMode }', ' }').replace('                                isUpdateDemoMode={isUpdateDemoMode}\n', '');
  if (path.endsWith('AppSideEffects.tsx')) return source.replace('updateState, dismissUpdate, installUpdate }', 'updateState, installUpdate, startDownload }').replace('    dismissUpdate,\n', '    startDownload,\n');
  if (path.endsWith('useAppStartupEffects.ts')) return source.replace('const {dismissUpdate, enabled = true,', 'const {enabled = true,');
  if (path.endsWith('storageKeys.ts')) return source.replace(/^export const STORAGE_KEY_UPDATE_DISMISSED_VERSION = .*\n/m, '').replace(/^export const STORAGE_KEY_UPDATE_LATEST_RELEASE = .*\n/m, '').replace(/^export const STORAGE_KEY_DEBUG_UPDATE_DEMO = .*\n/m, '');
  if (path.endsWith('netcatty-bridge-app.d.ts')) {
    return source.replace('declare global {', `export interface UpdateStatusSnapshot {
  status: 'idle' | 'available' | 'downloading' | 'ready' | 'error';
  percent: number;
  error: string | null;
  checkError: string | null;
  version: string | null;
  releaseNotes: string;
  releaseDate: string | null;
  checkedAt: number | null;
  isChecking: boolean;
}
declare global {`).replace(/    getUpdateStatus\?\(\): Promise<\{[^\n]+\}>;/, '    getUpdateStatus?(): Promise<UpdateStatusSnapshot>;');
  }
  if (path.endsWith('strictModeIdempotency.test.ts')) {
    source = source.replace(/\r\n/g, '\n');
    const start = source.indexOf("test('cancelled startup update check resets its latch instead of skipping forever'");
    const end = source.indexOf("test('terminal popup config", start);
    if (start < 0 || end < 0) throw new Error('更新 StrictMode 测试锚点不存在');
    return source.slice(0, start) + `test('update subscriptions cancel hydration on StrictMode cleanup', () => {
  assert.match(updateCheckSource, /cancelled = true; cleanups.forEach/);
  assert.doesNotMatch(updateCheckSource, /startupCheckTimeoutRef|fetch\\(/);
});

` + source.slice(end);
  }
  if (path.endsWith('autoUpdateBridge.test.cjs')) return source.replace('        updateInfo: {', '        isUpdateAvailable: true,\n        updateInfo: {').replace('      assert.deepEqual(await ipcMain.invoke("netcatty:update:getStatus"), {\n        status: "error",\n        percent: 100,\n        error: "authorization cancelled",\n        version: "1.1.18",\n        isChecking: false,\n      });', `      const status = await ipcMain.invoke("netcatty:update:getStatus");
      assert.equal(status.status, 'error');
      assert.equal(status.percent, 100);
      assert.match(status.error, /authorization cancelled/);
      assert.equal(status.version, '1.1.18');
      assert.equal(status.isChecking, false);`);
  throw new Error(`Unknown update consumer: ${path}`);
}

export function patchUpdateTranslations(source) {
  return source
    .replace("  'settings.update.currentVersion': '当前版本',", "  'settings.update.currentVersion': '当前版本',\n  'settings.update.latestVersion': '最新版本',\n  'settings.update.releaseDate': '发布日期',\n  'settings.update.releaseNotes': '更新说明',\n  'settings.update.upgradeTo': '升级到 {version}',\n  'settings.update.retry': '重新尝试',")
    .replace("  'settings.update.hint': 'Netcatty 从 GitHub Releases 检查更新。',", "  'settings.update.hint': 'Netcatty 从官方 GitHub Releases 检查更新。',")
    .replace("  'settings.update.manualDownloadHint': '当前平台不支持自动更新，请前往 GitHub 下载最新版本。',", "  'settings.update.manualDownloadHint': '当前平台不支持自动更新，请前往 Netcatty 发布页下载最新版本。',")
    .replace("  'update.available.message': '新版本 {version} 已发布，点击前往下载。',", "  'update.available.message': '新版本 {version} 已发布，点击即可开始升级。',\n  'update.available.details': '当前版本 {currentVersion}，发布日期 {date}',\n  'update.upgradeTo': '升级到 {version}',")
    .replace("  'update.downloadFailed.message': '下载更新失败，可前往 GitHub 手动下载。',", "  'update.downloadFailed.message': '下载更新失败，请重试或前往项目发布页手动下载。',");
}

export function patchStartupUpdateAction(source) {
  source = source.replace(/\r\n/g, "\n");
  const oldImport = "    hasRuntimeTunnel, installUpdate, isVaultInitialized, keys, knownHosts, openSettingsWindow, portForwardingRules, proxyProfiles, sessions, setKeyboardInteractiveQueue,";
  const newImport = "    hasRuntimeTunnel, installUpdate, startDownload, isVaultInitialized, keys, knownHosts, openSettingsWindow, portForwardingRules, proxyProfiles, sessions, setKeyboardInteractiveQueue,";
  if (!source.includes(oldImport)) throw new Error("启动更新入口导入锚点不存在");
  let output = source.replace(oldImport, newImport);
  const toastStart = output.indexOf("toast.info(\n        t('update.available.message', { version }),");
  const newToast = `      const release = updateState.latestRelease;
      const publishedAt = release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : '';
      toast.info(
        [
          t('update.available.message', { version }),
          t('update.available.details', { currentVersion: updateState.currentVersion || '-', date: publishedAt || '-' }),
          release.body ? release.body.slice(0, 160) : '',
        ].filter(Boolean).join('\\n'),
        {
          title: t('update.available.title'),
          duration: 0,
          onClick: () => { void startDownload(); },
          actionLabel: t('update.upgradeTo', { version }),
        }
      );`;
  const toastEnd = toastStart >= 0 ? output.indexOf("      );", toastStart) + "      );".length : -1;
  if (toastStart < 0 || toastEnd < toastStart) throw new Error("启动更新通知锚点不存在");
  return (output.slice(0, toastStart) + newToast + output.slice(toastEnd)).replace(
    "}, [enabled, updateState.hasUpdate, updateState.latestRelease, updateState.autoDownloadStatus, t, openSettingsWindow, dismissUpdate]);",
    "}, [enabled, updateState.hasUpdate, updateState.latestRelease, updateState.autoDownloadStatus, updateState.currentVersion, t, startDownload]);",
  );
}

export function patchSettingsApplicationTab(source, netcattyVersion) {
  const old = `const REPO_URL = "https://github.com/binaricat/Netcatty";`;
  if (!source.includes(old)) throw new Error("应用设置仓库地址锚点不存在");
  const versionDisplay = `{appInfo.version ? appInfo.version : " "}`;
  if (!source.includes(versionDisplay)) throw new Error("应用设置版本号锚点不存在");
  return source
    .replace(old, `const REPO_URL = "https://github.com/kos991/Netcatty-Cmdb";`)
    .replace(versionDisplay, `{appInfo.version ? "${netcattyVersion}" : " "}`);
}

export function patchSettingsPageWithCmdb(source) {
  const usesCRLF = source.includes('\r\n');
  source = source.replace(/\r\n/g, '\n');
  const replace = (anchor, replacement) => {
    if (!source.includes(anchor) || source.indexOf(anchor) !== source.lastIndexOf(anchor)) {
      throw new Error('Netcatty 设置页锚点不存在或不唯一');
    }
    source = source.replace(anchor, replacement);
  };
  replace(
    'import { AppWindow, Cloud, FileType, HardDrive, Keyboard, Palette, Puzzle, Sparkles, TerminalSquare, X } from "lucide-react";',
    'import { AppWindow, Cloud, Database, FileType, HardDrive, Keyboard, Palette, Puzzle, Sparkles, TerminalSquare, X } from "lucide-react";',
  );
  replace(
    'const LazySettingsApplicationTab = lazy(() => import("./SettingsApplicationTab"));',
    'const LazySettingsApplicationTab = lazy(() => import("./SettingsApplicationTab"));\nconst LazyCmdbConfigCenter = lazy(() => import("./cmdb/ConfigCenter"));',
  );
  replace(
    '                        {pluginRuntimeAvailable && (',
    `                        <TabsTrigger value="cmdb" className={settingsTabTriggerClassName}>
                            <Database size={14} className={settingsTabIconClassName} />
                            <span className={settingsTabLabelClassName}>Cmdb</span>
                        </TabsTrigger>
                        {pluginRuntimeAvailable && (`,
  );
  replace(
    '                    {mountedTabs.has("appearance") && (',
    `                    {mountedTabs.has("cmdb") && (
                        <SettingsLazyTab value="cmdb">
                            <LazyCmdbConfigCenter />
                        </SettingsLazyTab>
                    )}

                    {mountedTabs.has("appearance") && (`,
  );
  replace(
    '        // Nested tabs (AI / Sync) read `request` to switch sub-tabs. Keep it until',
    `        // Cmdb owns its nested destination and retains the request across lazy loading.
        if (request.tab === "cmdb") return;
        // Nested tabs (AI / Sync) read \`request\` to switch sub-tabs. Keep it until`,
  );
  replace(
    'className="flex-1 h-full flex flex-col min-h-0 bg-muted/10"',
    'className="flex-1 h-full flex min-w-0 flex-col min-h-0 bg-muted/10"',
  );
  return usesCRLF ? source.replace(/\n/g, '\r\n') : source;
}

export function patchSettingsSystemTab(source) {
  const start = source.indexOf("<SectionHeader title={t('settings.update.title')} anchorId=\"system-update\" />");
  const end = source.indexOf('<SectionHeader title={t("settings.autoLaunch.title")} />', start);
  if (start < 0 || end < 0) throw new Error("系统更新区块锚点不存在");
  const replacement = `          <SectionHeader title={t('settings.update.title')} anchorId="system-update" />
            <SettingCard className="space-y-4 py-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-border/60 p-3">
                  <div className="text-xs text-muted-foreground">{t('settings.update.currentVersion')}</div>
                  <div className="mt-1 font-mono text-sm">{updateState.currentVersion || appVersion || '...'}</div>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <div className="text-xs text-muted-foreground">{t('settings.update.latestVersion')}</div>
                  <div className="mt-1 font-mono text-sm">{updateState.latestRelease ? 'v' + updateState.latestRelease.version : '-'}</div>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <div className="text-xs text-muted-foreground">{t('settings.update.releaseDate')}</div>
                  <div className="mt-1 text-sm">{updateState.latestRelease?.publishedAt ? new Date(updateState.latestRelease.publishedAt).toLocaleDateString() : '-'}</div>
                </div>
              </div>

              {updateState.latestRelease?.body && (
                <div>
                  <div className="mb-2 text-xs text-muted-foreground">{t('settings.update.releaseNotes')}</div>
                  <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/20 p-3 text-sm leading-6">
                    {updateState.latestRelease.body}
                  </div>
                </div>
              )}

              {updateState.autoDownloadStatus === 'downloading' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{t('settings.update.downloading').replace('{percent}', String(updateState.downloadPercent))}</span>
                    <span>{updateState.downloadPercent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all duration-300" style={{ width: String(updateState.downloadPercent) + '%' }} />
                  </div>
                </div>
              )}
              {updateState.autoDownloadStatus === 'ready' && <p className="text-sm text-green-600 dark:text-green-400">{t('settings.update.readyToInstall')}</p>}
              {updateState.autoDownloadStatus === 'error' && <p className="text-sm text-destructive">{updateState.downloadError || t('settings.update.error')}</p>}
              {updateState.autoDownloadStatus === 'idle' && updateState.manualCheckStatus === 'up-to-date' && <p className="text-sm text-green-600 dark:text-green-400">{t('settings.update.upToDate')}</p>}
              {updateState.autoDownloadStatus === 'idle' && updateState.hasUpdate && <p className="text-sm text-blue-600 dark:text-blue-400">{t('settings.update.available').replace('{version}', updateState.latestRelease?.version ?? '')}</p>}
              {updateState.manualCheckStatus === 'error' && <p className="text-sm text-destructive">{updateState.error || t('settings.update.error')}</p>}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => void checkNow()} disabled={updateState.isChecking || updateState.manualCheckStatus === 'checking' || updateState.autoDownloadStatus === 'downloading'}>
                  <RefreshCw size={14} className="mr-1.5" />
                  {updateState.isChecking ? t('settings.update.checking') : t('settings.update.checkForUpdates')}
                </Button>
                {updateState.hasUpdate && updateState.latestRelease && updateState.autoDownloadStatus === 'idle' && (
                  <Button variant="default" size="sm" onClick={startDownload}>
                    <Download size={14} className="mr-1.5" />
                    {t('settings.update.upgradeTo', { version: 'v' + updateState.latestRelease.version })}
                  </Button>
                )}
                {updateState.autoDownloadStatus === 'ready' && <Button variant="default" size="sm" onClick={installUpdate}><RotateCcw size={14} className="mr-1.5" />{t('settings.update.restartNow')}</Button>}
                {updateState.autoDownloadStatus === 'error' && <Button variant="outline" size="sm" onClick={startDownload}><RefreshCw size={14} className="mr-1.5" />{t('settings.update.retry')}</Button>}
                {(updateState.autoDownloadStatus === 'error' || updateState.manualCheckStatus === 'error') && <Button variant="ghost" size="sm" onClick={openReleasePage}><ExternalLink size={14} className="mr-1.5" />{t('settings.update.manualDownload')}</Button>}
              </div>

              <SettingRow anchorId="system-auto-update" label={t('settings.update.autoUpdateEnabled')} description={t('settings.update.autoUpdateEnabledDesc')}>
                <Toggle checked={autoUpdateEnabled} onChange={setAutoUpdateEnabled} />
              </SettingRow>
            </SettingCard>
            <SettingHint>
              {updateState.lastCheckedAt && <span>{t('settings.update.lastCheckedPrefix')}{formatLastChecked(updateState.lastCheckedAt, t)}{'　'}</span>}
              {t('settings.update.hint')}
            </SettingHint>

`;
  return source.slice(0, start) + replacement + source.slice(end);
}
