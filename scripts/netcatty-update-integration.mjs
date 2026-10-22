// 宿主“软件更新”只检查上游 Netcatty 官方发布并提示，不下载、不安装：上游官方安装包不含 Cmdb，安装会覆盖集成版。
// 因此不改写 electron-builder publish 配置和应用页的项目链接，宿主版本号保持上游版本。
const INTEGRATED_UPDATE_NOTICE = "当前为 Netcatty-Cmdb 集成版，上游新版本需等待 Cmdb 集成版适配后，使用项目发布的安装包升级。";

export function patchUpdateConsumers(path, source) {
  if (path.endsWith('SettingsApplicationTab.tsx')) {
    return source.replace('  isUpdateDemoMode: boolean;\n', '')
      .replace(', isUpdateDemoMode }', ' }')
      .replace('    // In demo mode, allow checking even for dev builds\n', '')
      .replace("if (!isUpdateDemoMode && (!appInfo.version || appInfo.version === '0.0.0'))", "if (!appInfo.version || appInfo.version === '0.0.0')")
      .replace('    if (result?.hasUpdate && result.latestRelease) {', "    if (result?.error) {\n      toast.error(result.error);\n    } else if (result?.hasUpdate && result.latestRelease) {");
  }
  if (path.endsWith('SettingsPage.tsx')) return source.replace(', isUpdateDemoMode }', ' }').replace('                                isUpdateDemoMode={isUpdateDemoMode}\n', '');
  if (path.endsWith('AppSideEffects.tsx')) return source.replace('updateState, dismissUpdate, installUpdate }', 'updateState, installUpdate }').replace('    dismissUpdate,\n', '');
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
  throw new Error(`Unknown update consumer: ${path}`);
}

export function patchUpdateTranslations(source, locale = 'en') {
  const zh = locale === 'zh-CN';
  const text = zh ? {
    latest: '上游最新版本', date: '发布日期', notes: '更新说明', notice: INTEGRATED_UPDATE_NOTICE,
    available: '上游 Netcatty {version} 已发布，等待 Cmdb 集成版适配。', hint: '从 Netcatty 官方 GitHub Releases 检查上游版本，仅作提示。',
    auto: '启动时检查上游版本', autoDesc: '启动后检查上游 Netcatty 是否有新版本，只提示，不下载。', message: '上游 Netcatty {version} 已发布，等待 Cmdb 集成版适配后再升级。',
  } : {
    latest: 'Latest upstream version', date: 'Release date', notes: 'Release notes',
    notice: 'This is the Netcatty-Cmdb integrated build. Upstream installers do not include Cmdb and are blocked. Wait for an adapted Cmdb release, then use its installer.',
    available: 'Upstream Netcatty {version} is available. Wait for an adapted Cmdb release.', hint: 'Checks the official Netcatty GitHub Releases for information only.',
    auto: 'Check upstream version at startup', autoDesc: 'Checks for upstream Netcatty releases at startup. It never downloads them.', message: 'Upstream Netcatty {version} is available. Wait for an adapted Cmdb release before upgrading.',
  };
  return source
    .replace(/  'settings\.update\.currentVersion': ([^\n]+)\n/, (line) => `${line}  'settings.update.latestVersion': '${text.latest}',\n  'settings.update.releaseDate': '${text.date}',\n  'settings.update.releaseNotes': '${text.notes}',\n  'settings.update.integratedNotice': '${text.notice}',\n`)
    .replace(/  'settings\.update\.available': '[^']*',/, `  'settings.update.available': '${text.available}',`)
    .replace(/  'settings\.update\.hint': '[^']*',/, `  'settings.update.hint': '${text.hint}',`)
    .replace(/  'settings\.update\.autoUpdateEnabled': '[^']*',/, `  'settings.update.autoUpdateEnabled': '${text.auto}',`)
    .replace(/  'settings\.update\.autoUpdateEnabledDesc': '[^']*',/, `  'settings.update.autoUpdateEnabledDesc': '${text.autoDesc}',`)
    .replace(/  'update\.available\.message': '[^']*',/, `  'update.available.message': '${text.message}',`);
}

// 启动通知只提示，点击打开设置；不提供下载入口。
export function patchStartupUpdateAction(source) {
  source = source.replace(/\r\n/g, "\n");
  const toastStart = source.indexOf("toast.info(\n        t('update.available.message', { version }),");
  const toastEnd = toastStart >= 0 ? source.indexOf("      );", toastStart) + "      );".length : -1;
  if (toastStart < 0 || toastEnd < toastStart) throw new Error("启动更新通知锚点不存在");
  const newToast = `toast.info(
        t('update.available.message', { version }),
        {
          title: t('update.available.title'),
          duration: 8000,
          onClick: () => { void openSettingsWindow(); },
          actionLabel: t('update.viewInSettings'),
        }
      );`;
  const deps = "}, [enabled, updateState.hasUpdate, updateState.latestRelease, updateState.autoDownloadStatus, t, openSettingsWindow, dismissUpdate]);";
  if (!source.includes(deps)) throw new Error("启动更新通知依赖锚点不存在");
  return (source.slice(0, toastStart) + newToast + source.slice(toastEnd))
    .replace(deps, "}, [enabled, updateState.hasUpdate, updateState.latestRelease, updateState.autoDownloadStatus, t, openSettingsWindow]);");
}

// 应用页：版本号保持宿主（上游）版本；去掉“立即下载 / 立即重启”徽章按钮，只显示上游新版本号。
export function patchSettingsApplicationTab(source) {
  source = source.replace(/\r\n/g, "\n");
  const badgeStart = source.indexOf("                {/* Update badge - reflects auto-download state */}");
  const closing = "                  </button>\n                )}\n";
  const closingAt = badgeStart >= 0 ? source.indexOf(closing, badgeStart) : -1;
  if (badgeStart < 0 || closingAt < 0) throw new Error("应用设置更新徽章锚点不存在");
  const badgeEnd = closingAt + closing.length;
  const badge = `                {/* 集成版只提示上游新版本，不提供下载或安装 */}
                {updateState.hasUpdate && updateState.latestRelease && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300" title={t('settings.update.integratedNotice')}>
                    <ArrowUpCircle size={12} />
                    v{updateState.latestRelease.version}
                  </span>
                )}
`;
  return source.slice(0, badgeStart) + badge + source.slice(badgeEnd);
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

              {updateState.manualCheckStatus === 'up-to-date' && !updateState.hasUpdate && <p className="text-sm text-green-600 dark:text-green-400">{t('settings.update.upToDate')}</p>}
              {updateState.hasUpdate && <p className="text-sm text-blue-600 dark:text-blue-400">{t('settings.update.available').replace('{version}', updateState.latestRelease?.version ?? '')}</p>}
              {updateState.manualCheckStatus === 'error' && <p className="text-sm text-destructive">{updateState.error || t('settings.update.error')}</p>}
              <p className="text-xs text-muted-foreground">{t('settings.update.integratedNotice')}</p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => void checkNow()} disabled={updateState.isChecking || updateState.manualCheckStatus === 'checking'}>
                  <RefreshCw size={14} className="mr-1.5" />
                  {updateState.isChecking ? t('settings.update.checking') : t('settings.update.checkForUpdates')}
                </Button>
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
