import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const integrationRoot = join(repositoryRoot, "integrations", "netcatty");
const upstream = JSON.parse(readFileSync(join(integrationRoot, "upstream.json"), "utf8"));
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
  ["application/app/workTabSurface.ts", "return activeTabId === 'vault' || activeTabId === 'sftp';"],
  ["electron/preload/api.cjs", "function createPreloadApi"],
  ["global.d.ts", "interface NetcattyBridge {"],
].forEach(([file, anchor]) => assertContainsOnce(file, anchor));

cpSync(join(repositoryRoot, "web", "src"), join(target, "components", "cmdb"), {
  recursive: true,
  force: true,
});
cpSync(join(integrationRoot, "electron", "cmdbService.cjs"), join(target, "electron", "cmdbService.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbService.test.cjs"), join(target, "electron", "cmdbService.test.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbBridge.cjs"), join(target, "electron", "bridges", "cmdbBridge.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbBridge.test.cjs"), join(target, "electron", "bridges", "cmdbBridge.test.cjs"));

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
    'const { registerSystemNotificationHandlers } = require("../bridges/systemNotification.cjs");\nconst { registerCmdbBridge } = require("../bridges/cmdbBridge.cjs");',
    "electron/main/registerBridges.cjs",
  );
  output = replaceOnce(
    output,
    "    getVaultBackupBridge,\n    getAppLockController,",
    "    getVaultBackupBridge,\n    getCmdbService,\n    getCmdbStartupError,\n    getAppLockController,",
    "electron/main/registerBridges.cjs",
  );
  return replaceOnce(
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

update("application/app/workTabSurface.ts", (source) => replaceOnce(
  source,
  "return activeTabId === 'vault' || activeTabId === 'sftp';",
  "return activeTabId === 'vault' || activeTabId === 'cmdb' || activeTabId === 'sftp';",
  "application/app/workTabSurface.ts",
));

update("application/app/AppActiveTabChrome.tsx", (source) => replaceOnce(
  source,
  "    if (activeTabId === 'sftp') return 'SFTP';",
  "    if (activeTabId === 'sftp') return 'SFTP';\n    if (activeTabId === 'cmdb') return 'Cmdb';",
  "application/app/AppActiveTabChrome.tsx",
));

update("application/app/AppView.tsx", (source) => {
  let output = replaceOnce(
    source,
    "import { activeTabStore, toEditorTabId, useIsEditorTabActive } from '../state/activeTabStore';",
    "import { activeTabStore, toEditorTabId, useIsEditorTabActive, useIsTabActive } from '../state/activeTabStore';",
    "application/app/AppView.tsx",
  );
  output = replaceOnce(
    output,
    "import { VaultView } from '../../components/VaultView';",
    "import { VaultView } from '../../components/VaultView';\nimport CmdbWorkspace from '../../components/cmdb/CmdbWorkspace';",
    "application/app/AppView.tsx",
  );
  output = replaceOnce(
    output,
    "\n\n/** Plugin keybinding host with locally derived theme tokens and locale. */",
    `

const CmdbSurface = React.memo(() => {
  const active = useIsTabActive('cmdb');
  return (
    <section className={active ? 'absolute inset-0 z-20 flex min-h-0' : 'hidden'} aria-hidden={!active}>
      <CmdbWorkspace />
    </section>
  );
});

/** Plugin keybinding host with locally derived theme tokens and locale. */`,
    "application/app/AppView.tsx",
  );
  return replaceOnce(
    output,
    "        </AppVaultThemeSurface>\n\n        <SftpViewMount",
    "        </AppVaultThemeSurface>\n\n        <CmdbSurface />\n\n        <SftpViewMount",
    "application/app/AppView.tsx",
  );
});

update("electron/preload/api.cjs", (source) => replaceOnce(
  source,
  '  getPluginRuntimeStatus: () => ipcRenderer.invoke("netcatty:plugins:status"),',
  `  getPluginRuntimeStatus: () => ipcRenderer.invoke("netcatty:plugins:status"),
  cmdbStatus: () => ipcRenderer.invoke("netcatty:cmdb:status"),
  cmdbRequest: (payload) => ipcRenderer.invoke("netcatty:cmdb:request", payload),
  cmdbImportFile: (payload) => ipcRenderer.invoke("netcatty:cmdb:import-file", payload),
  cmdbExportFile: (payload) => ipcRenderer.invoke("netcatty:cmdb:export-file", payload),`,
  "electron/preload/api.cjs",
));

update("global.d.ts", (source) => replaceOnce(
  source,
  "  interface NetcattyBridge {",
  `  interface NetcattyBridge {
    cmdbStatus?(): Promise<{ available: boolean; error?: string }>;
    cmdbRequest?(payload: { path: string; method?: string; headers?: Record<string, string>; body?: unknown }): Promise<unknown>;
    cmdbImportFile?(payload: { path: string; commit?: boolean; token?: string }): Promise<unknown>;
    cmdbExportFile?(payload: { path: string; suggestedName?: string }): Promise<{ cancelled: boolean; filePath?: string }>;`,
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

update("package.json", (source) => {
  const pkg = JSON.parse(source);
  pkg.dependencies = {
    ...pkg.dependencies,
    "@ant-design/icons": "^5.5.1",
    "@ant-design/v5-patch-for-react-19": "^1.0.3",
    antd: "^5.21.6",
    dayjs: "^1.11.13",
  };
  pkg.scripts["build:plugin-packages"] = pkg.scripts["build:plugin-packages"]
    .replace(" && npm run build --workspace @netcatty/cmdb-plugin", "");
  return `${JSON.stringify(pkg, null, 2)}\n`;
});

console.log(`Prepared Netcatty Cmdb integration at ${target}`);
