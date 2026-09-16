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

cpSync(join(integrationRoot, "electron", "cmdbService.cjs"), join(target, "electron", "cmdbService.cjs"));
cpSync(join(integrationRoot, "electron", "cmdbService.test.cjs"), join(target, "electron", "cmdbService.test.cjs"));
cpSync(join(integrationRoot, "plugin"), join(target, "examples", "plugins", "cmdb-netcatty"), {
  recursive: true,
  force: true,
});

const cmdbMainBlock = `let cmdbService = null;

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
    console.warn("[CMDB] cmdb-server executable not found; CMDB plugin will remain unavailable");
    return null;
  }
  try {
    cmdbService = await startCmdbService({
      executablePath,
      databasePath: resolveCmdbDatabasePath(),
      port: 18080,
      cwd: path.dirname(executablePath),
    });
    console.info(\`[CMDB] Service ready at \${cmdbService.baseUrl}\`);
    return cmdbService;
  } catch (error) {
    console.error("[CMDB] Failed to start service:", error);
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
    "const effectiveDevServerUrl = isDev ? devServerUrl : undefined;",
    `const effectiveDevServerUrl = isDev ? devServerUrl : undefined;
if (!process.env.NETCATTY_PLUGIN_DEV && !process.env.NETCATTY_PLUGIN_HOST) {
  process.env.NETCATTY_PLUGIN_HOST = "1";
}`,
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
  return replaceOnce(
    output,
    '  app.on("will-quit", () => {',
    `  app.on("will-quit", () => {
    try {
      cmdbService?.stop?.();
      cmdbService = null;
    } catch (err) {
      console.warn("Error during CMDB cleanup:", err);
    }`,
    "electron/main.cjs",
  );
});

update("electron/main/registerBridges.cjs", (source) => {
  let output = replaceOnce(
    source,
    "    getWindowManager,\n    getVaultBackupBridge,",
    "    getWindowManager,\n    appPath,\n    getVaultBackupBridge,",
    "electron/main/registerBridges.cjs",
  );
  output = replaceOnce(
    output,
    "        return createPluginHostService({",
    "        const service = createPluginHostService({",
    "electron/main/registerBridges.cjs",
  );
  const serviceTail = `        });
        const archivePath = process.env.NETCATTY_CMDB_PLUGIN_ARCHIVE
          || (app.isPackaged
            ? require("node:path").join(process.resourcesPath, "cmdb", "cmdb-netcatty.ncpkg")
            : require("node:path").join(appPath || app.getAppPath(), "examples", "plugins", "cmdb-netcatty.ncpkg"));
        void service.manager.initialize().then(async () => {
          if (!fs.existsSync(archivePath)) {
            console.warn(\`[Plugins] Built-in CMDB package not found: \${archivePath}\`);
            return;
          }
          const existing = service.database.getActivePlugin("com.netcatty.cmdb");
          if (existing) {
            if (!existing.enabled) await service.manager.setEnabled("com.netcatty.cmdb", true);
            return;
          }
          await service.manager.install(archivePath, { enable: true });
        }).catch((error) => console.error("[Plugins] Failed to initialize built-in CMDB plugin:", error));
        return service;
      },
      registerShutdown:`;
  return replaceOnce(
    output,
    "        });\n      },\n      registerShutdown:",
    serviceTail,
    "electron/main/registerBridges.cjs",
  );
});

update("electron/plugins/constants.cjs", (source) => {
  let output = replaceOnce(
    source,
    'const PLUGIN_DEV_ENV = "NETCATTY_PLUGIN_DEV";',
    'const PLUGIN_DEV_ENV = "NETCATTY_PLUGIN_DEV";\nconst PLUGIN_HOST_ENV = "NETCATTY_PLUGIN_HOST";',
    "electron/plugins/constants.cjs",
  );
  output = replaceOnce(
    output,
    '  return env?.[PLUGIN_DEV_ENV] === "1";',
    '  return env?.[PLUGIN_DEV_ENV] === "1" || env?.[PLUGIN_HOST_ENV] === "1";',
    "electron/plugins/constants.cjs",
  );
  return replaceOnce(
    output,
    "  PLUGIN_DEV_ENV,\n  PLUGIN_LOG_MAX_BYTES,",
    "  PLUGIN_DEV_ENV,\n  PLUGIN_HOST_ENV,\n  PLUGIN_LOG_MAX_BYTES,",
    "electron/plugins/constants.cjs",
  );
});

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
    "        extraResources: [...moshExtraResources('darwin'), ...etExtraResources('darwin'), ...cmdbExtraResources('darwin'), { from: 'examples/plugins/cmdb-netcatty.ncpkg', to: 'cmdb/cmdb-netcatty.ncpkg' }]",
    "electron-builder.config.cjs",
  );
  output = replaceOnce(
    output,
    "            ...etExtraResources('win32'),",
    "            ...etExtraResources('win32'),\n            ...cmdbExtraResources('win32'),\n            { from: 'examples/plugins/cmdb-netcatty.ncpkg', to: 'cmdb/cmdb-netcatty.ncpkg' },",
    "electron-builder.config.cjs",
  );
  return replaceOnce(
    output,
    "        extraResources: [...moshExtraResources('linux'), ...etExtraResources('linux')]",
    "        extraResources: [...moshExtraResources('linux'), ...etExtraResources('linux'), ...cmdbExtraResources('linux'), { from: 'examples/plugins/cmdb-netcatty.ncpkg', to: 'cmdb/cmdb-netcatty.ncpkg' }]",
    "electron-builder.config.cjs",
  );
});

update("package.json", (source) => {
  const pkg = JSON.parse(source);
  pkg.scripts["build:plugin-packages"] += " && npm run build --workspace @netcatty/cmdb-plugin";
  return `${JSON.stringify(pkg, null, 2)}\n`;
});

console.log(`Prepared Netcatty CMDB integration at ${target}`);
