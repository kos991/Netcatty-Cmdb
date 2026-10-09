import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  patchSettingsApplicationTab,
  patchSettingsPageWithCmdb,
  patchSettingsSystemTab,
  patchStartupUpdateAction,
  patchUpdateRepositoryConfig,
  patchUpdateTranslations,
} from "./netcatty-update-integration.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const integrationRoot = join(repositoryRoot, "integrations", "netcatty");
const upstream = JSON.parse(readFileSync(join(integrationRoot, "upstream.json"), "utf8"));
const netcattyVersion = String(upstream.release || "").replace(/^v/, "");
const targetFlag = process.argv.indexOf("--target");
const target = resolve(targetFlag >= 0 ? process.argv[targetFlag + 1] : "");

if (targetFlag < 0 || !process.argv[targetFlag + 1]) {
  throw new Error("Usage: node scripts/prepare-netcatty.mjs --target <netcatty-directory>");
}
if (!existsSync(join(target, "electron", "main.cjs"))) {
  throw new Error(`Netcatty source directory is invalid: ${target}`);
}

const actualCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: target,
  encoding: "utf8",
}).trim();
if (actualCommit !== upstream.commit) {
  throw new Error(`Netcatty commit mismatch: expected ${upstream.commit}, got ${actualCommit}`);
}

function update(relativePath, transform) {
  const filePath = join(target, relativePath);
  const before = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const after = transform(before);
  if (after === before) throw new Error(`No integration change was applied to ${relativePath}`);
  writeFileSync(filePath, after, "utf8");
}

function replaceOnce(source, search, replacement, fileName) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`Integration anchor is missing in ${fileName}`);
  if (source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Integration anchor is ambiguous in ${fileName}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function assertContainsOnce(relativePath, anchor) {
  const source = readFileSync(join(target, relativePath), "utf8").replace(/\r\n/g, "\n");
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(`Integration anchor is missing in ${relativePath}`);
  if (source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`Integration anchor is ambiguous in ${relativePath}`);
  }
}

[
  ["components/TopTabs.tsx", "{/* Fixed left tabs: Vaults and SFTP */}"],
  ["application/app/AppView.tsx", "<AppVaultThemeSurface VaultViewContainer={VaultViewContainer}>"],
  ["application/app/AppHandlers.ts", "export function handleGlobalHotkeyKeyDownImpl"],
  ["electron/preload/api.cjs", "function createPreloadApi"],
  ["global.d.ts", "interface NetcattyBridge {"],
].forEach(([file, anchor]) => assertContainsOnce(file, anchor));

cpSync(join(integrationRoot, "cmdb"), join(target, "components", "cmdb"), {
  recursive: true,
  force: true,
});
cpSync(join(integrationRoot, "CmdbSurface.tsx"), join(target, "components", "cmdb", "CmdbSurface.tsx"));
cpSync(join(integrationRoot, "CmdbSyncSnapshot.ts"), join(target, "domain", "CmdbSyncSnapshot.ts"));
cpSync(join(integrationRoot, "CmdbSyncSnapshot.test.ts"), join(target, "domain", "cmdbSyncSnapshot.test.ts"));
cpSync(join(integrationRoot, "CmdbSyncSnapshot.ts"), join(target, "application", "CmdbSyncSnapshot.ts"));
cpSync(join(integrationRoot, "CmdbCloudSync.ts"), join(target, "application", "CmdbCloudSync.ts"));
cpSync(join(integrationRoot, "CmdbCloudSync.test.ts"), join(target, "application", "cmdbCloudSync.test.ts"));
cpSync(join(integrationRoot, "CmdbSyncPayloadIntegration.test.ts"), join(target, "application", "cmdbSyncPayloadIntegration.test.ts"));
cpSync(join(integrationRoot, "electron", "cmdbService.cjs"), join(target, "electron", "cmdbService.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbService.test.cjs"), join(target, "electron", "cmdbService.test.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbBridge.cjs"), join(target, "electron", "bridges", "cmdbBridge.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbBridge.test.cjs"), join(target, "electron", "bridges", "cmdbBridge.test.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbAttachmentCloud.cjs"), join(target, "electron", "bridges", "cmdbAttachmentCloud.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbAttachmentCloud.test.cjs"), join(target, "electron", "bridges", "cmdbAttachmentCloud.test.cjs"));

const cmdbMainBlock = `let cmdbService = null;
let cmdbStartupError = null;

function normalizeCmdbStartupError(error) {
  if (error instanceof Error) return error.message.trim() || "Cmdb 服务启动失败";
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Cmdb 服务启动失败";
}

function resolveCmdbExecutablePath() {
  const executableName = process.platform === "win32" ? "cmdb-server.exe" : "cmdb-server";
  const candidates = [
    process.env.NETCATTY_CMDB_SERVER_PATH,
    process.env.NETCATTY_CMDB_EXECUTABLE,
    app.isPackaged ? path.join(process.resourcesPath, "cmdb", executableName) : null,
    !app.isPackaged ? path.join(appPath, "cmdb", executableName) : null,
    !app.isPackaged ? path.resolve(appPath, "..", executableName) : null,
    !app.isPackaged ? path.resolve(appPath, "..", "..", executableName) : null,
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || null;
}

function resolveCmdbDatabasePath() {
  if (process.env.NETCATTY_CMDB_DB_PATH) return process.env.NETCATTY_CMDB_DB_PATH;
  if (process.env.NETCATTY_CMDB_DB) return process.env.NETCATTY_CMDB_DB;
  if (!app.isPackaged) {
    const candidates = [
      path.resolve(appPath, "..", "assets.db"),
      path.resolve(appPath, "..", "..", "assets.db"),
    ];
    const projectDb = candidates.find((candidate) => fs.existsSync(candidate));
    if (projectDb) return projectDb;
  }
  return path.join(app.getPath("userData"), "assets.db");
}

async function startCmdbForApp() {
  const executablePath = resolveCmdbExecutablePath();
  if (!executablePath) {
    cmdbStartupError = "未找到 Cmdb 服务可执行文件";
    console.warn(\`[Cmdb] \${cmdbStartupError}\`);
    return null;
  }
  try {
    cmdbService = await startCmdbService({
      executablePath,
      databasePath: resolveCmdbDatabasePath(),
      port: 18080,
      cwd: path.dirname(executablePath),
    });
    cmdbStartupError = null;
    console.info(\`[Cmdb] Service ready at \${cmdbService.baseUrl}\`);
    return cmdbService;
  } catch (error) {
    cmdbStartupError = normalizeCmdbStartupError(error);
    console.error("[Cmdb] Failed to start service:", error);
    cmdbService = null;
    return null;
  }
}
`;

update("electron/main.cjs", (source) => {
  let output = replaceOnce(
    source,
    'const { runPluginShutdown } = require("./plugins/shutdownCoordinator.cjs");',
    'const { runPluginShutdown } = require("./plugins/shutdownCoordinator.cjs");\nconst { startCmdbService } = require("./cmdbService.cjs");',
    "electron/main.cjs",
  );
  output = replaceOnce(
    output,
    'const appPath = path.join(__dirname, "..");',
    `const appPath = path.join(__dirname, "..");\n${cmdbMainBlock}`,
    "electron/main.cjs",
  );
  output = replaceOnce(
    output,
    "    registerAppProtocol();",
    "    registerAppProtocol();\n    await startCmdbForApp();",
    "electron/main.cjs",
  );
  output = replaceOnce(
    output,
    "  getVaultBackupBridge,\n  getAppLockController: () => appLockController,",
    "  getVaultBackupBridge,\n  getCmdbService: () => cmdbService,\n  getCmdbStartupError: () => cmdbStartupError,\n  getAppLockController: () => appLockController,",
    "electron/main.cjs",
  );
  return replaceOnce(
    output,
    '  app.on("will-quit", () => {',
    `  app.on("will-quit", () => {
    try {
      if (cmdbService) {
        cmdbService.stop();
        cmdbService = null;
      }
    } catch (err) {
      console.warn("Error during Cmdb cleanup:", err);
    }`,
    "electron/main.cjs",
  );
});

update("electron/main/registerBridges.cjs", (source) => {
  let output = replaceOnce(
    source,
    'const { registerSystemNotificationHandlers } = require("../bridges/systemNotification.cjs");',
    'const { registerSystemNotificationHandlers } = require("../bridges/systemNotification.cjs");\nconst { registerCmdbBridge, requestCmdb } = require("../bridges/cmdbBridge.cjs");\nconst { registerCmdbAttachmentCloud } = require("../bridges/cmdbAttachmentCloud.cjs");',
    "electron/main/registerBridges.cjs",
  );
  output = replaceOnce(
    output,
    "    getVaultBackupBridge,\n    getAppLockController,",
    "    getVaultBackupBridge,\n    getCmdbService,\n    getCmdbStartupError,\n    getAppLockController,",
    "electron/main/registerBridges.cjs",
  );
  output = replaceOnce(
    output,
    "    const { ipcMain } = electronModule;",
    `    const { ipcMain } = electronModule;
    registerCmdbBridge({
      ipcMain,
      dialog: electronModule.dialog,
      getService: getCmdbService,
      getStartupError: getCmdbStartupError,
    });`,
    "electron/main/registerBridges.cjs",
  );
  return replaceOnce(
    output,
    "    const cloudSyncBridge = getCloudSyncBridge();",
    `    const cloudSyncBridge = getCloudSyncBridge();
    registerCmdbAttachmentCloud({
      ipcMain,
      buildS3Client: cloudSyncBridge.buildS3Client,
      requestCmdb,
      getService: getCmdbService,
    });`,
    "electron/main/registerBridges.cjs",
  );
});

update("components/TopTabs.tsx", (source) => {
  let output = replaceOnce(
    source,
    "import { Folder, FolderLock, Lock, Menu, MoreHorizontal, Plus, Settings, Sparkles } from 'lucide-react';",
    "import { Database, Folder, FolderLock, Lock, Menu, MoreHorizontal, Plus, Settings, Sparkles } from 'lucide-react';",
    "components/TopTabs.tsx",
  );
  return replaceOnce(
    output,
    "          {showSftpTab && (",
    `          <RootTopTab
            tabId="cmdb"
            label="Cmdb"
            icon={<Database size={14} />}
            className="rounded-t-md"
            compact={rootTabsCompact}
          />
          {showSftpTab && (`,
    "components/TopTabs.tsx",
  );
});

update("application/app/workTabSurface.ts", (source) => {
  const legacy = "return activeTabId === 'vault' || activeTabId === 'sftp';";
  if (source.includes(legacy)) {
    return source.replace(legacy, "return activeTabId === 'vault' || activeTabId === 'cmdb' || activeTabId === 'sftp';");
  }
  if (source.includes("activeTabId === 'cmdb'")) return `${source}\n`;
  throw new Error("Integration anchor is missing in application/app/workTabSurface.ts");
});

update("application/app/AppActiveTabChrome.tsx", (source) => replaceOnce(
  source,
  "    if (activeTabId === 'sftp') return 'SFTP';",
  "    if (activeTabId === 'sftp') return 'SFTP';\n    if (activeTabId === 'cmdb') return 'Cmdb';",
  "application/app/AppActiveTabChrome.tsx",
));

update("application/app/AppView.tsx", (source) => {
  let output = replaceOnce(
    source,
    "import { VaultView } from '../../components/VaultView';",
    "import { VaultView } from '../../components/VaultView';\nimport { CmdbSurface } from '../../components/cmdb/CmdbSurface';",
    "application/app/AppView.tsx",
  );
  return replaceOnce(
    output,
    "        </AppVaultThemeSurface>\n\n        <SftpViewMount",
    "        </AppVaultThemeSurface>\n\n        <CmdbSurface onConnectHost={handleHostConnectWithProtocolCheck} />\n\n        <SftpViewMount",
    "application/app/AppView.tsx",
  );
});

update("application/app/AppHandlers.ts", (source) => replaceOnce(
  source,
  `export function handleGlobalHotkeyKeyDownImpl(getCtx: AppContextGetter, e: KeyboardEvent) {
  const { HOTKEY_DEBUG, closeTabKeyStr, executeHotkeyAction, hotkeyScheme, keyBindings, matchesKeyBinding } = getCtx();
{`,
  `export function handleGlobalHotkeyKeyDownImpl(getCtx: AppContextGetter, e: KeyboardEvent) {
  const { HOTKEY_DEBUG, closeTabKeyStr, executeHotkeyAction, hotkeyScheme, keyBindings, matchesKeyBinding } = getCtx();
{
    const visibleCmdb = document.querySelector<HTMLElement>('[data-section="cmdb-view"]');
    const isCmdbSearchHotkey = Boolean(
      visibleCmdb?.getClientRects().length
      && (e.ctrlKey || e.metaKey)
      && !e.altKey
      && !e.shiftKey
      && e.key.toLowerCase() === 'k',
    );
    if (isCmdbSearchHotkey) return;`,
  "application/app/AppHandlers.ts",
));

update("electron/preload/api.cjs", (source) => replaceOnce(
  source,
  '  getPluginRuntimeStatus: () => ipcRenderer.invoke("netcatty:plugins:status"),',
  `  getPluginRuntimeStatus: () => ipcRenderer.invoke("netcatty:plugins:status"),
  cmdbStatus: () => ipcRenderer.invoke("netcatty:cmdb:status"),
  cmdbRequest: (payload) => ipcRenderer.invoke("netcatty:cmdb:request", payload),
  cmdbImportFile: (payload) => ipcRenderer.invoke("netcatty:cmdb:import-file", payload),
  cmdbUploadFile: (payload) => ipcRenderer.invoke("netcatty:cmdb:upload-file", payload),
  cmdbExportFile: (payload) => ipcRenderer.invoke("netcatty:cmdb:export-file", payload),
  cmdbSelectAttachmentDirectory: () => ipcRenderer.invoke("netcatty:cmdb:select-attachment-directory"),
  cmdbSyncAttachments: (payload) => ipcRenderer.invoke("netcatty:cmdb:sync-attachments", payload),
  cmdbDownloadAttachment: (payload) => ipcRenderer.invoke("netcatty:cmdb:download-attachment", payload),`,
  "electron/preload/api.cjs",
));

update("global.d.ts", (source) => replaceOnce(
  source,
  "  interface NetcattyBridge {",
  `  interface NetcattyBridge {
    cmdbStatus?(): Promise<{ available: boolean; error?: string }>;
    cmdbRequest?(payload: { path: string; method?: string; headers?: Record<string, string>; body?: unknown }): Promise<unknown>;
    cmdbImportFile?(payload: { path: string; commit?: boolean; token?: string }): Promise<unknown>;
    cmdbUploadFile?(payload: { path: string; fileName?: string; bytes?: Uint8Array }): Promise<unknown>;
    cmdbExportFile?(payload: { path: string; suggestedName?: string }): Promise<{ cancelled: boolean; filePath?: string }>;
    cmdbSelectAttachmentDirectory?(): Promise<{ cancelled: boolean; directoryPath?: string }>;
    cmdbSyncAttachments?(payload: unknown): Promise<unknown>;
    cmdbDownloadAttachment?(payload: unknown): Promise<unknown>;`,
  "global.d.ts",
));

const builderPrelude = `/* global process */
const fs = require('node:fs');

function cmdbExtraResources(targetPlatform) {
    const executableName = targetPlatform === 'win32' ? 'cmdb-server.exe' : 'cmdb-server';
    const source = process.env.NETCATTY_CMDB_SERVER_SOURCE || null;
    return source && fs.existsSync(source)
        ? [{ from: source, to: \`cmdb/\${executableName}\` }]
        : [];
}
`;

update("electron-builder.config.cjs", (source) => {
  let output = `${builderPrelude}${source}`;
  output = replaceOnce(
    output,
    "        extraResources: [...moshExtraResources('darwin'), ...etExtraResources('darwin')]",
    "        extraResources: [...moshExtraResources('darwin'), ...etExtraResources('darwin'), ...cmdbExtraResources('darwin')]",
    "electron-builder.config.cjs",
  );
  output = replaceOnce(
    output,
    "            ...etExtraResources('win32'),",
    "            ...etExtraResources('win32'),\n            ...cmdbExtraResources('win32'),",
    "electron-builder.config.cjs",
  );
  return replaceOnce(
    output,
    "        extraResources: [...moshExtraResources('linux'), ...etExtraResources('linux')]",
    "        extraResources: [...moshExtraResources('linux'), ...etExtraResources('linux'), ...cmdbExtraResources('linux')]",
    "electron-builder.config.cjs",
  );
});

update("infrastructure/services/updateService.ts", patchUpdateRepositoryConfig);
update("electron-builder.config.cjs", patchUpdateRepositoryConfig);
update("components/SettingsApplicationTab.tsx", (source) => patchSettingsApplicationTab(source, netcattyVersion));
update("components/SettingsPage.tsx", patchSettingsPageWithCmdb);
update("components/settings/tabs/SettingsSystemTab.tsx", patchSettingsSystemTab);
update("application/app/useAppStartupEffects.ts", patchStartupUpdateAction);
update("application/i18n/locales/zh-CN/core.ts", patchUpdateTranslations);

update("eslint.config.js", (source) => replaceOnce(
  source,
  'export default [',
  `export default [
  {
    files: ["components/cmdb/**/*.{js,jsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks, "unused-imports": unusedImports },
    rules: {
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },`,
  "eslint.config.js",
));

update("domain/sync.ts", (source) => replaceOnce(
  source,
  "  pluginSidecars?: import('./pluginSyncSidecar').PluginSyncSidecarBundle;\n\n  // Sync metadata",
  "  pluginSidecars?: import('./pluginSyncSidecar').PluginSyncSidecarBundle;\n\n  /** Cmdb project snapshot carried inside the existing encrypted cloud payload. */\n  cmdbSnapshot?: import('./CmdbSyncSnapshot').CmdbSyncSnapshot;\n\n  // Sync metadata",
  "domain/sync.ts",
));

update("application/syncPayload.ts", (source) => {
  let output = replaceOnce(
    source,
    "import { prepareRestoredPayloadConvergentWrites } from './convergentSyncReplica';",
    "import { prepareRestoredPayloadConvergentWrites } from './convergentSyncReplica';\nimport {\n  applyCmdbCloudSnapshot,\n  collectCmdbCloudSnapshot,\n} from './CmdbCloudSync';",
    "application/syncPayload.ts",
  );
  output = replaceOnce(
    output,
    "  if (hasSyncPayloadEntityData(payload, CLOUD_SYNC_PAYLOAD_ENTITY_KEYS)) return true;\n\n  if (\n    payload.settings",
    "  if (hasSyncPayloadEntityData(payload, CLOUD_SYNC_PAYLOAD_ENTITY_KEYS)) return true;\n\n  if (payload.cmdbSnapshot) return true;\n\n  if (\n    payload.settings",
    "application/syncPayload.ts",
  );
  output = replaceOnce(
    output,
    "  /** Called after synced settings have been written to localStorage. */\n  onSettingsApplied?: () => void;\n}\n\n// ---------------------------------------------------------------------------\n// Settings sync helpers",
    "  /** Called after synced settings have been written to localStorage. */\n  onSettingsApplied?: () => void;\n}\n\nexport type CmdbSnapshotCollector = () => Promise<SyncPayload['cmdbSnapshot'] | undefined>;\nexport type CmdbSnapshotApplier = (\n  snapshot: NonNullable<SyncPayload['cmdbSnapshot']>,\n) => Promise<void> | void;\n\n// ---------------------------------------------------------------------------\n// Settings sync helpers",
    "application/syncPayload.ts",
  );
  output = replaceOnce(
    output,
    "  options?: {\n    collectPluginSidecars?: PluginSyncSidecarCollector;\n  },\n): Promise<SyncPayload> {",
    "  options?: {\n    collectPluginSidecars?: PluginSyncSidecarCollector;\n    collectCmdbSnapshot?: CmdbSnapshotCollector;\n  },\n): Promise<SyncPayload> {",
    "application/syncPayload.ts",
  );
  output = replaceOnce(
    output,
    "  const collect = options?.collectPluginSidecars ?? defaultCollectPluginSyncSidecars;\n  const sidecars = await collect();\n  return withPluginSyncSidecars(base, sidecars);",
    "  const collect = options?.collectPluginSidecars ?? defaultCollectPluginSyncSidecars;\n  const sidecars = await collect();\n  const payload = withPluginSyncSidecars(base, sidecars);\n  const collectCmdb = options?.collectCmdbSnapshot ?? collectCmdbCloudSnapshot;\n  const cmdbSnapshot = await collectCmdb();\n  return cmdbSnapshot ? { ...payload, cmdbSnapshot } : payload;",
    "application/syncPayload.ts",
  );
  output = replaceOnce(
    output,
    "    includeLocalOnlyData: boolean;\n    applyPluginSidecars?: PluginSyncSidecarApplier;\n    currentHosts?: Host[];",
    "    includeLocalOnlyData: boolean;\n    applyPluginSidecars?: PluginSyncSidecarApplier;\n    applyCmdbSnapshot?: CmdbSnapshotApplier;\n    currentHosts?: Host[];",
    "application/syncPayload.ts",
  );
  output = replaceOnce(
    output,
    "      await applySidecars(sanitizedPayload.pluginSidecars ?? { version: 1, entries: [] });\n    }\n  });",
    "      await applySidecars(sanitizedPayload.pluginSidecars ?? { version: 1, entries: [] });\n    }\n\n    if (sanitizedPayload.cmdbSnapshot) {\n      const applyCmdb = options.applyCmdbSnapshot ?? applyCmdbCloudSnapshot;\n      await applyCmdb(sanitizedPayload.cmdbSnapshot);\n    }\n  });",
    "application/syncPayload.ts",
  );
  output = replaceOnce(
    output,
    "  options?: {\n    applyPluginSidecars?: PluginSyncSidecarApplier;\n    currentHosts?: Host[];",
    "  options?: {\n    applyPluginSidecars?: PluginSyncSidecarApplier;\n    applyCmdbSnapshot?: CmdbSnapshotApplier;\n    currentHosts?: Host[];",
    "application/syncPayload.ts",
  );
  return replaceOnce(
    output,
    "    includeLocalOnlyData: false,\n    applyPluginSidecars: options?.applyPluginSidecars,\n    currentHosts: options?.currentHosts,",
    "    includeLocalOnlyData: false,\n    applyPluginSidecars: options?.applyPluginSidecars,\n    applyCmdbSnapshot: options?.applyCmdbSnapshot,\n    currentHosts: options?.currentHosts,",
    "application/syncPayload.ts",
  );
});

update("domain/syncMerge.ts", (source) => {
  let output = replaceOnce(
    source,
    "import { mergePluginSyncSidecarsThreeWay } from './pluginSyncSidecar';",
    "import { mergePluginSyncSidecarsThreeWay } from './pluginSyncSidecar';\nimport { mergeOptionalCmdbSnapshots } from './CmdbSyncSnapshot';",
    "domain/syncMerge.ts",
  );
  output = replaceOnce(
    output,
    "  const anySideHadPluginSidecars = baseHasSidecars || localHasSidecars || remoteHasSidecars;\n\n  const payload:",
    "  const anySideHadPluginSidecars = baseHasSidecars || localHasSidecars || remoteHasSidecars;\n  const cmdbSnapshot = mergeOptionalCmdbSnapshots(\n    b.cmdbSnapshot,\n    local.cmdbSnapshot,\n    remote.cmdbSnapshot,\n  );\n\n  const payload:",
    "domain/syncMerge.ts",
  );
  return replaceOnce(
    output,
    "      ? { pluginSidecars: { version: 1 as const, entries: mergedSidecarEntries } }\n      : {}),\n    syncedAt:",
    "      ? { pluginSidecars: { version: 1 as const, entries: mergedSidecarEntries } }\n      : {}),\n    ...(cmdbSnapshot ? { cmdbSnapshot } : {}),\n    syncedAt:",
    "domain/syncMerge.ts",
  );
});

update("domain/convergentSync/legacy.ts", (source) => {
  let output = replaceOnce(
    source,
    "    ...CONVERGENT_STRING_COLLECTIONS,\n    'settings',",
    "    ...CONVERGENT_STRING_COLLECTIONS,\n    'settings',\n    'cmdbSnapshot',",
    "domain/convergentSync/legacy.ts",
  );
  return replaceOnce(
    output,
    "      pluginSidecars: sanitized.pluginSidecars ?? { version: 1, entries: [] },",
    "      pluginSidecars: sanitized.pluginSidecars ?? { version: 1, entries: [] },\n      cmdbSnapshot: sanitized.cmdbSnapshot ?? null,",
    "domain/convergentSync/legacy.ts",
  );
});

update("domain/convergentSync/payload.ts", (source) => {
  let output = replaceOnce(
    source,
    "    /** Opaque plugin sidecars travel with the encrypted blob outside CRDT fields. */\n    pluginSidecars?: SyncPayload['pluginSidecars'];",
    "    /** Opaque plugin sidecars travel with the encrypted blob outside CRDT fields. */\n    pluginSidecars?: SyncPayload['pluginSidecars'];\n    /** Cmdb remains an independently merged snapshot inside the encrypted blob. */\n    cmdbSnapshot?: SyncPayload['cmdbSnapshot'];",
    "domain/convergentSync/payload.ts",
  );
  output = replaceOnce(
    output,
    "      }\n      : {}),\n  };\n}\n\nfunction materializedEntity",
    "      }\n      : {}),\n    ...(options.cmdbSnapshot ? { cmdbSnapshot: options.cmdbSnapshot } : {}),\n  };\n}\n\nfunction materializedEntity",
    "domain/convergentSync/payload.ts",
  );
  return replaceOnce(
    output,
    "    syncMeta?: SyncReliabilityMeta;\n    pluginSidecars?: SyncPayload['pluginSidecars'];\n  },\n): SyncPayload {",
    "    syncMeta?: SyncReliabilityMeta;\n    pluginSidecars?: SyncPayload['pluginSidecars'];\n    cmdbSnapshot?: SyncPayload['cmdbSnapshot'];\n  },\n): SyncPayload {",
    "domain/convergentSync/payload.ts",
  );
});

update("domain/convergentSync/migration.ts", (source) => {
  let output = replaceOnce(
    source,
    "} from '../pluginSyncSidecar';\n\n/** LWW-union plugin sidecars",
    `} from '../pluginSyncSidecar';
import { mergeOptionalCmdbSnapshots } from '../CmdbSyncSnapshot';

function mergeMigrationCmdbSnapshots(options: {
  local: SyncPayload['cmdbSnapshot'];
  localBaseline: SyncPayload['cmdbSnapshot'];
  sources: Array<{
    remote: SyncPayload['cmdbSnapshot'];
    baseline: SyncPayload['cmdbSnapshot'];
  }>;
}): SyncPayload['cmdbSnapshot'] {
  let merged = options.local;
  for (const source of options.sources) {
    merged = mergeOptionalCmdbSnapshots(source.baseline ?? options.localBaseline, merged, source.remote);
  }
  return merged;
}

/** LWW-union plugin sidecars`,
    "domain/convergentSync/migration.ts",
  );
  output = replaceOnce(
    output,
    "  return trustedBaseline !== null\n    || hasSyncPayloadEntityData(payload, CLOUD_SYNC_PAYLOAD_ENTITY_KEYS);",
    "  return trustedBaseline !== null\n    || hasSyncPayloadEntityData(payload, CLOUD_SYNC_PAYLOAD_ENTITY_KEYS)\n    || payload.cmdbSnapshot !== undefined;",
    "domain/convergentSync/migration.ts",
  );
  output = replaceOnce(
    output,
    "        syncMeta: merged.syncMeta,\n        ...(migrationSidecars ? { pluginSidecars: migrationSidecars } : {}),",
    "        syncMeta: merged.syncMeta,\n        ...(migrationSidecars ? { pluginSidecars: migrationSidecars } : {}),\n        ...(merged.cmdbSnapshot ? { cmdbSnapshot: merged.cmdbSnapshot } : {}),",
    "domain/convergentSync/migration.ts",
  );
  output = replaceOnce(
    output,
    "    const joinedPayload = materializeSyncPayloadFromConvergentState(state, {\n      syncedAt: options.now,\n      ...(joinedSidecars ? { pluginSidecars: joinedSidecars } : {}),",
    `    const joinedCmdbSnapshot = mergeMigrationCmdbSnapshots({
      local: options.localPayload.cmdbSnapshot,
      localBaseline: options.localTrustedBaseline?.cmdbSnapshot,
      sources: [
        ...v2Inputs.map((input) => ({
          remote: input.payload.cmdbSnapshot,
          baseline: input.trustedBaseline?.cmdbSnapshot,
        })),
        ...v1Inputs.map((input) => ({
          remote: input.payload.cmdbSnapshot,
          baseline: input.trustedBaseline?.cmdbSnapshot,
        })),
      ],
    });
    const joinedPayload = materializeSyncPayloadFromConvergentState(state, {
      syncedAt: options.now,
      ...(joinedSidecars ? { pluginSidecars: joinedSidecars } : {}),
      ...(joinedCmdbSnapshot ? { cmdbSnapshot: joinedCmdbSnapshot } : {}),`,
    "domain/convergentSync/migration.ts",
  );
  output = replaceOnce(
    output,
    "        syncedAt: options.now,\n        ...(joinedSidecars ? { pluginSidecars: joinedSidecars } : {}),\n      });",
    "        syncedAt: options.now,\n        ...(joinedSidecars ? { pluginSidecars: joinedSidecars } : {}),\n        ...(joinedCmdbSnapshot ? { cmdbSnapshot: joinedCmdbSnapshot } : {}),\n      });",
    "domain/convergentSync/migration.ts",
  );
  return replaceOnce(
    output,
    "      ...(materialized?.pluginSidecars\n        ? { pluginSidecars: materialized.pluginSidecars }\n        : {}),",
    "      ...(materialized?.pluginSidecars\n        ? { pluginSidecars: materialized.pluginSidecars }\n        : {}),\n      ...(materialized?.cmdbSnapshot\n        ? { cmdbSnapshot: materialized.cmdbSnapshot }\n        : {}),",
    "domain/convergentSync/migration.ts",
  );
});

update("infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts", (source) => {
  let output = replaceOnce(
    source,
    "import type { CloudAdapter } from '../adapters';",
    "import type { CloudAdapter } from '../adapters';\nimport { mergeOptionalCmdbSnapshots } from '../../../domain/CmdbSyncSnapshot';",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "  pluginSidecars?: SyncPayload['pluginSidecars'],\n): SyncPayload {",
    "  pluginSidecars?: SyncPayload['pluginSidecars'],\n  cmdbSnapshot?: SyncPayload['cmdbSnapshot'],\n): SyncPayload {",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "      ? { pluginSidecars }\n      : {}),\n  });",
    "      ? { pluginSidecars }\n      : {}),\n    ...(cmdbSnapshot ? { cmdbSnapshot } : {}),\n  });",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "  const cycleBaseByProvider = new Map<CloudProvider, NonNullable<SyncPayload['pluginSidecars']>['entries']>();",
    "  const cycleBaseByProvider = new Map<CloudProvider, NonNullable<SyncPayload['pluginSidecars']>['entries']>();\n  const cycleCmdbBaseByProvider = new Map<CloudProvider, NonNullable<SyncPayload['cmdbSnapshot']>>();",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "        const baseBundle = baseline?.materializedPayload?.pluginSidecars;\n        if (!baseBundle || !Array.isArray(baseBundle.entries)) continue;\n        cycleBaseByProvider.set(runtime.provider, baseBundle.entries);",
    "        const baseBundle = baseline?.materializedPayload?.pluginSidecars;\n        if (baseBundle && Array.isArray(baseBundle.entries)) {\n          cycleBaseByProvider.set(runtime.provider, baseBundle.entries);\n        }\n        const baseCmdb = baseline?.materializedPayload?.cmdbSnapshot;\n        if (baseCmdb) cycleCmdbBaseByProvider.set(runtime.provider, baseCmdb);",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "    const pluginSidecars = mergedSidecars.length > 0\n      || Object.prototype.hasOwnProperty.call(inputPayload, 'pluginSidecars')\n      ? { version: 1 as const, entries: mergedSidecars }\n      : inputPayload.pluginSidecars;\n    const sidecarFingerprint",
    `    const pluginSidecars = mergedSidecars.length > 0
      || Object.prototype.hasOwnProperty.call(inputPayload, 'pluginSidecars')
      ? { version: 1 as const, entries: mergedSidecars }
      : inputPayload.pluginSidecars;
    let cmdbSnapshot = inputPayload.cmdbSnapshot;
    for (const runtime of usable) {
      if (runtime.error) continue;
      const remoteCmdb = preflightVerified.get(runtime.provider)?.payload?.cmdbSnapshot
        ?? runtime.latestRemotePayload?.cmdbSnapshot;
      cmdbSnapshot = mergeOptionalCmdbSnapshots(
        cycleCmdbBaseByProvider.get(runtime.provider),
        cmdbSnapshot,
        remoteCmdb,
      );
    }
    const sidecarFingerprint`,
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "    const needsUpload = usable.some((runtime) => (\n      !runtime.error && !preflightVerified.has(runtime.provider)\n    )) || remoteSidecarMismatch;",
    `    const providerCmdbMismatch = (runtime: { provider: string }) => {
      const decoded = preflightVerified.get(runtime.provider);
      if (!decoded) return true;
      return (decoded.payload?.cmdbSnapshot?.base_hash ?? null)
        !== (cmdbSnapshot?.base_hash ?? null);
    };
    const remoteCmdbMismatch = usable.some((runtime) => (
      !runtime.error && providerCmdbMismatch(runtime)
    ));
    const needsUpload = usable.some((runtime) => (
      !runtime.error && !preflightVerified.has(runtime.provider)
    )) || remoteSidecarMismatch || remoteCmdbMismatch;`,
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "        syncedAt: now(),\n        pluginSidecars,\n      })",
    "        syncedAt: now(),\n        pluginSidecars,\n        cmdbSnapshot,\n      })",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "      if (preflightVerified.has(runtime.provider) && !providerSidecarMismatch(runtime)) return;",
    "      if (\n        preflightVerified.has(runtime.provider)\n        && !providerSidecarMismatch(runtime)\n        && !providerCmdbMismatch(runtime)\n      ) return;",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "  const mergedPayloadBase = materializedPayload(canonical, now());\n  const mergedPayload: SyncPayload = {\n    ...mergedPayloadBase,\n    ...(finalPluginSidecars ? { pluginSidecars: finalPluginSidecars } : {}),",
    `  let finalCmdbSnapshot = inputPayload.cmdbSnapshot;
  for (const runtime of successfulRuntimes) {
    finalCmdbSnapshot = mergeOptionalCmdbSnapshots(
      cycleCmdbBaseByProvider.get(runtime.provider),
      finalCmdbSnapshot,
      runtime.verifiedPayload?.cmdbSnapshot ?? runtime.latestRemotePayload?.cmdbSnapshot,
    );
  }
  const mergedPayloadBase = materializedPayload(canonical, now());
  const mergedPayload: SyncPayload = {
    ...mergedPayloadBase,
    ...(finalPluginSidecars ? { pluginSidecars: finalPluginSidecars } : {}),
    ...(finalCmdbSnapshot ? { cmdbSnapshot: finalCmdbSnapshot } : {}),`,
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "    const [first, ...rest] = remoteStates;\n    return materializedPayload(mergeStates(first, rest), Date.now());",
    `    const [first, ...rest] = remoteStates;
    let cmdbSnapshot: SyncPayload['cmdbSnapshot'];
    for (const runtime of runtimes) {
      cmdbSnapshot = mergeOptionalCmdbSnapshots(
        undefined,
        cmdbSnapshot,
        runtime.verifiedPayload?.cmdbSnapshot ?? runtime.latestRemotePayload?.cmdbSnapshot,
      );
    }
    return materializedPayload(mergeStates(first, rest), Date.now(), undefined, cmdbSnapshot);`,
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "  pluginSidecars?: SyncPayload['pluginSidecars'],\n): Promise<{ state:",
    "  pluginSidecars?: SyncPayload['pluginSidecars'],\n  cmdbSnapshot?: SyncPayload['cmdbSnapshot'],\n): Promise<{ state:",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "    payload: materializedPayload(resolved, now, pluginSidecars),",
    "    payload: materializedPayload(resolved, now, pluginSidecars, cmdbSnapshot),",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "  options?: {\n    pluginSidecars?: SyncPayload['pluginSidecars'];\n  },\n): Promise<{ payload:",
    "  options?: {\n    pluginSidecars?: SyncPayload['pluginSidecars'];\n    cmdbSnapshot?: SyncPayload['cmdbSnapshot'];\n  },\n): Promise<{ payload:",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "      Date.now(),\n      options?.pluginSidecars,\n    );",
    "      Date.now(),\n      options?.pluginSidecars,\n      options?.cmdbSnapshot,\n    );",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "      Date.now(),\n      sidecarBundleFromPayload(prepared.payload),\n    );",
    "      Date.now(),\n      sidecarBundleFromPayload(prepared.payload),\n      prepared.payload.cmdbSnapshot,\n    );",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "    let downgradeSidecars = localSidecars;\n    {",
    "    let downgradeSidecars = localSidecars;\n    let downgradeCmdbSnapshot = localPayload.cmdbSnapshot;\n    {",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  output = replaceOnce(
    output,
    "    const withLocalWrites = applyLegacySyncPayload(\n      replica.state,\n      materializedPayload(replica.state, now, downgradeSidecars),",
    `    for (const runtime of runtimes) {
      let baselineCmdb: SyncPayload['cmdbSnapshot'];
      if (typeof this.loadConvergentProviderBaseline === 'function') {
        try {
          const baseline = await this.loadConvergentProviderBaseline(runtime.provider) as {
            materializedPayload?: SyncPayload;
          } | null;
          baselineCmdb = baseline?.materializedPayload?.cmdbSnapshot;
        } catch {
          // First cycle or missing baseline is fine.
        }
      }
      downgradeCmdbSnapshot = mergeOptionalCmdbSnapshots(
        baselineCmdb,
        downgradeCmdbSnapshot,
        runtime.verifiedPayload?.cmdbSnapshot ?? runtime.latestRemotePayload?.cmdbSnapshot,
      );
    }
    const withLocalWrites = applyLegacySyncPayload(
      replica.state,
      materializedPayload(replica.state, now, downgradeSidecars, downgradeCmdbSnapshot),`,
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
  return replaceOnce(
    output,
    "    const outgoing = materializedPayload(canonical, now, downgradeSidecars);",
    "    const outgoing = materializedPayload(canonical, now, downgradeSidecars, downgradeCmdbSnapshot);",
    "infrastructure/services/cloudSync/convergentSyncRuntimeMethods.ts",
  );
});

update("infrastructure/services/CloudSyncManager.ts", (source) => replaceOnce(
  source,
  "    options?: {\n      pluginSidecars?: SyncPayload['pluginSidecars'];\n    },\n  ): Promise<{ payload:",
  "    options?: {\n      pluginSidecars?: SyncPayload['pluginSidecars'];\n      cmdbSnapshot?: SyncPayload['cmdbSnapshot'];\n    },\n  ): Promise<{ payload:",
  "infrastructure/services/CloudSyncManager.ts",
));

update("application/state/useCloudSync.ts", (source) => replaceOnce(
  source,
  "    return manager.resolveConvergentConflict(addressKey, candidateDot, applyPayload, {\n      pluginSidecars,\n    });",
  "    const { collectCmdbCloudSnapshot } = await import('../CmdbCloudSync');\n    const cmdbSnapshot = await collectCmdbCloudSnapshot();\n    return manager.resolveConvergentConflict(addressKey, candidateDot, applyPayload, {\n      pluginSidecars,\n      cmdbSnapshot,\n    });",
  "application/state/useCloudSync.ts",
));

update("application/app/AppSideEffects.tsx", (source) => replaceOnce(
  source,
  "  const handleSyncNowManual = useCallback(() => {\n    return handleSyncNow({ trigger: 'manual' });\n  }, [handleSyncNow]);\n\n  // Update check hook",
  `  const handleSyncNowManual = useCallback(() => {
    return handleSyncNow({ trigger: 'manual' });
  }, [handleSyncNow]);

  useEffect(() => {
    const handleCmdbSyncRequest = () => { void handleSyncNowManual(); };
    window.addEventListener('netcatty:cmdb-cloud-sync-request', handleCmdbSyncRequest);
    const unsubscribe = netcattyBridge.get()?.onSettingsChanged?.((payload) => {
      if (payload?.key === 'netcatty.cmdb.cloudSync.request') handleCmdbSyncRequest();
    });
    return () => {
      window.removeEventListener('netcatty:cmdb-cloud-sync-request', handleCmdbSyncRequest);
      unsubscribe?.();
    };
  }, [handleSyncNowManual]);

  // Update check hook`,
  "application/app/AppSideEffects.tsx",
));

console.log(`Prepared Netcatty Cmdb integration at ${target}`);
