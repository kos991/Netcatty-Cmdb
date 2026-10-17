#!/usr/bin/env node
/**
 * Netcatty-CMDB 插件自安装器
 *
 * 用法（双击 install.bat 或命令行）：
 *   node install.mjs [--userData <path>] [--dry-run]
 *
 * 仅依赖 Node.js 22+ 内置模块（fs、crypto、zlib、path、os、sqlite）。
 * 不需要 npm install，不需要网络。
 *
 * 安装逻辑复刻自 Netcatty PackageStore.install()，与宿主兼容：
 *   1. 定位 .ncpkg 文件（与本脚本同目录）
 *   2. 计算 archiveSha256（整包哈希）
 *   3. 解压并计算 contentSha256（文件内容规范哈希）
 *   4. 写入 userData/plugins/packages/<pluginId>/<version>/ 目录
 *   5. 写 install.json
 *   6. 写 plugins.sqlite（schema v3，3 张表）
 */

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync, mkdirSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, writeFileSync, chmodSync,
} from "node:fs";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import zlib from "node:zlib";

// ── 常量 ──────────────────────────────────────────────────────────────────────

const PLUGIN_ID      = "com.netcatty.cmdb";
const SCHEMA_VERSION = 3;
const INSTALLER_DIR  = path.dirname(fileURLToPath(import.meta.url));

// ── CLI 参数 ──────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const dryRun     = args.includes("--dry-run");
const userDataIdx = args.indexOf("--userData");
const userDataOverride = userDataIdx >= 0 ? args[userDataIdx + 1] : null;

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function log(msg)   { process.stdout.write(`[CMDB Install] ${msg}\n`); }
function warn(msg)  { process.stdout.write(`[CMDB Install] ⚠  ${msg}\n`); }
function fatal(msg) { process.stderr.write(`[CMDB Install] ✗  ${msg}\n`); process.exit(1); }
function ok(msg)    { process.stdout.write(`[CMDB Install] ✓  ${msg}\n`); }

/** 读取 .ncpkg 并返回 archiveSha256 */
function hashFile(filePath) {
  const h = createHash("sha256");
  const buf = readFileSync(filePath);
  h.update(buf);
  return { sha256: h.digest("hex"), buf };
}

// ── ZIP 解析（内置，无第三方依赖）────────────────────────────────────────────

/**
 * 极简 ZIP 中央目录解析器 + 本地文件头读取。
 * 仅处理 .ncpkg 实际使用的无加密 ZIP（DEFLATE / STORED）。
 * 返回 { path, data: Buffer }[] 文件列表。
 */
function parseZip(buf) {
  // 找 End-of-Central-Directory (EOCD) 签名 0x06054b50
  const EOCD_SIG = 0x06054b50;
  const CD_SIG   = 0x02014b50;
  const LFH_SIG  = 0x04034b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error("ZIP: EOCD not found");

  const cdSize   = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const files = [];
  let pos = cdOffset;
  while (pos < cdOffset + cdSize) {
    if (buf.readUInt32LE(pos) !== CD_SIG) break;
    const method        = buf.readUInt16LE(pos + 10);
    const compSize      = buf.readUInt32LE(pos + 20);
    const uncompSize    = buf.readUInt32LE(pos + 24);
    const fnLen         = buf.readUInt16LE(pos + 28);
    const extraLen      = buf.readUInt16LE(pos + 30);
    const commentLen    = buf.readUInt16LE(pos + 32);
    const localOffset   = buf.readUInt32LE(pos + 42);
    const name          = buf.toString("utf8", pos + 46, pos + 46 + fnLen);
    pos += 46 + fnLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // directory entry

    // 读本地文件头以确定实际数据偏移
    const lfhFnLen    = buf.readUInt16LE(localOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart   = localOffset + 30 + lfhFnLen + lfhExtraLen;
    const compData    = buf.slice(dataStart, dataStart + compSize);

    let data;
    if (method === 0) {
      data = compData; // STORED
    } else if (method === 8) {
      data = zlib.inflateRawSync(compData); // DEFLATE
    } else {
      throw new Error(`ZIP: unsupported compression method ${method} for ${name}`);
    }
    if (data.length !== uncompSize) {
      throw new Error(`ZIP: size mismatch for ${name}: expected ${uncompSize}, got ${data.length}`);
    }
    files.push({ path: name, data });
  }
  return files;
}

/**
 * 计算 contentSha256：对所有文件按路径 UTF-8 排序后，
 * 对 "<path>\0<data>" 链式哈希，与 plugin-cli 保持一致。
 */
function contentSha256(files) {
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const h = createHash("sha256");
  for (const f of sorted) {
    h.update(f.path, "utf8");
    h.update("\0", "utf8");
    h.update(f.data);
  }
  return h.digest("hex");
}

// ── userData 定位 ─────────────────────────────────────────────────────────────

/**
 * 按 Netcatty 优先级定位 userData：
 *  1. --userData CLI 参数（覆盖）
 *  2. Portable 模式：<exe目录>/data/  （若存在）
 *  3. 安装版 Windows：%APPDATA%\Netcatty
 *  4. macOS：~/Library/Application Support/Netcatty
 *  5. Linux：~/.config/Netcatty
 *
 * 返回路径字符串，不检查是否存在（由调用方处理）。
 */
function resolveUserData() {
  if (userDataOverride) return path.resolve(userDataOverride);

  // Portable 模式：找同目录或父目录中的 Netcatty.exe，检测旁边的 data/
  const candidates = [
    path.join(INSTALLER_DIR, "data"),
    path.join(INSTALLER_DIR, "..", "data"),
    path.join(INSTALLER_DIR, "..", "..", "data"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) {
      log(`检测到 Portable data 目录: ${c}`);
      return c;
    }
  }

  // 安装版
  const { platform } = process;
  if (platform === "win32") {
    return path.join(process.env.APPDATA ?? os.homedir(), "Netcatty");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Netcatty");
  }
  // Linux
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "Netcatty");
}

// ── SQLite 操作 ───────────────────────────────────────────────────────────────

/**
 * 打开（或创建）插件数据库，确保 schema v3 存在。
 * 仅追加/升级，不破坏已有数据。
 */
function openPluginDatabase(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");

  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);

  if (version > SCHEMA_VERSION) {
    db.close();
    fatal(`插件数据库 schema 版本 ${version} 高于本安装器支持的 ${SCHEMA_VERSION}，请升级安装器`);
  }

  if (version === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        active_version TEXT,
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plugin_versions (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        archive_sha256 TEXT NOT NULL,
        package_relative_path TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, version)
      );
      CREATE TABLE IF NOT EXISTS plugin_runtime_state (
        plugin_id TEXT NOT NULL,
        plugin_version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'stopped',
        runtime_kind TEXT,
        last_error TEXT,
        quarantined_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, plugin_version),
        FOREIGN KEY (plugin_id, plugin_version)
          REFERENCES plugin_versions(plugin_id, version) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS plugin_crashes (
        plugin_id TEXT NOT NULL,
        plugin_version TEXT NOT NULL,
        crashed_at INTEGER NOT NULL,
        FOREIGN KEY (plugin_id, plugin_version)
          REFERENCES plugin_versions(plugin_id, version) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS plugin_crashes_lookup
        ON plugin_crashes(plugin_id, plugin_version, crashed_at);
      CREATE TABLE IF NOT EXISTS plugin_kv (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, key)
      );
      CREATE TABLE IF NOT EXISTS plugin_settings (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        setting_id TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        scope_id TEXT,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, setting_id, scope, scope_id)
      );
      CREATE TABLE IF NOT EXISTS plugin_view_state (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        view_id TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, view_id, scope_id)
      );
      CREATE TABLE IF NOT EXISTS plugin_permission_grants (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        declaration_hash TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, permission, resource)
      );
      CREATE TABLE IF NOT EXISTS plugin_secrets (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        secret_ref TEXT,
        ciphertext TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, key)
      );
      CREATE TABLE IF NOT EXISTS plugin_security_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        event TEXT NOT NULL,
        details_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plugin_sync_sidecars (
        plugin_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, kind, key)
      );
      CREATE TABLE IF NOT EXISTS plugin_sync_provider_bindings (
        provider_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, plugin_id)
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
    log("插件数据库 schema 已初始化（v3）");
  } else if (version < SCHEMA_VERSION) {
    // 仅补充缺失表，不删旧数据
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_sync_sidecars (
        plugin_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, kind, key)
      );
      CREATE TABLE IF NOT EXISTS plugin_sync_provider_bindings (
        provider_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, plugin_id)
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
    log(`插件数据库已从 v${version} 升级到 v${SCHEMA_VERSION}`);
  } else {
    log(`插件数据库 schema v${version} 已就绪`);
  }

  return db;
}

/** 将插件版本写入数据库（UPSERT） */
function upsertPlugin(db, { pluginId, version, manifestJson, archiveSha256, packageRelativePath }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO plugins(id, enabled, active_version, installed_at, updated_at)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      active_version = excluded.active_version,
      enabled = 1,
      updated_at = excluded.updated_at
  `).run(pluginId, version, now, now);

  db.prepare(`
    INSERT INTO plugin_versions(plugin_id, version, manifest_json, archive_sha256, package_relative_path, installed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(plugin_id, version) DO UPDATE SET
      manifest_json = excluded.manifest_json,
      archive_sha256 = excluded.archive_sha256,
      package_relative_path = excluded.package_relative_path,
      installed_at = excluded.installed_at
  `).run(pluginId, version, manifestJson, archiveSha256, packageRelativePath, now);

  db.prepare(`
    INSERT INTO plugin_runtime_state(plugin_id, plugin_version, status, updated_at)
    VALUES (?, ?, 'stopped', ?)
    ON CONFLICT(plugin_id, plugin_version) DO NOTHING
  `).run(pluginId, version, now);
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  log("=".repeat(60));
  log("Netcatty-CMDB 插件安装器 v1.3.1");
  if (dryRun) warn("DRY RUN 模式：不写入任何文件");
  log("=".repeat(60));

  // 1. 找 .ncpkg 文件
  const ncpkgs = readdirSync(INSTALLER_DIR).filter(f => f.endsWith(".ncpkg"));
  if (ncpkgs.length === 0) fatal(`未在 ${INSTALLER_DIR} 找到 .ncpkg 文件`);
  if (ncpkgs.length > 1)   warn(`找到多个 .ncpkg，使用第一个: ${ncpkgs[0]}`);
  const ncpkgPath = path.join(INSTALLER_DIR, ncpkgs[0]);
  log(`插件包: ${ncpkgPath}`);

  // 2. 读取并哈希整包
  log("正在计算包哈希...");
  const { sha256: archiveSha, buf } = hashFile(ncpkgPath);
  log(`archiveSha256: ${archiveSha}`);

  // 3. 解压并解析 manifest
  log("正在解压插件包...");
  let files;
  try {
    files = parseZip(buf);
  } catch (e) {
    fatal(`ZIP 解析失败: ${e.message}`);
  }
  log(`共 ${files.length} 个文件`);

  const manifestFile = files.find(f => f.path === "netcatty.plugin.json");
  if (!manifestFile) fatal("插件包中未找到 netcatty.plugin.json");
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.data.toString("utf8"));
  } catch (e) {
    fatal(`manifest 解析失败: ${e.message}`);
  }

  const pluginId = manifest.id;
  const version  = manifest.version;
  if (!pluginId || !version) fatal("manifest 缺少 id 或 version");
  if (pluginId !== PLUGIN_ID) warn(`manifest id "${pluginId}" 与预期 "${PLUGIN_ID}" 不符，继续安装`);

  log(`插件: ${pluginId}@${version}`);

  // 4. 计算 contentSha256
  const contentSha = contentSha256(files);
  log(`contentSha256: ${contentSha}`);

  // 5. 定位 userData
  const userData = resolveUserData();
  log(`userData 目录: ${userData}`);
  if (!existsSync(userData)) {
    warn(`userData 目录不存在，将自动创建（Netcatty 未曾启动过或路径不对）`);
    warn(`若 Netcatty 安装在非标准路径，请用 --userData <路径> 指定`);
  }

  // 6. 计算目标路径
  const pluginsRoot    = path.join(userData, "plugins");
  const packagesDir    = path.join(pluginsRoot, "packages");
  const pluginDir      = path.join(packagesDir, pluginId);
  const versionDir     = path.join(pluginDir, version);
  const packageDir     = path.join(versionDir, "package");
  const archiveFile    = path.join(versionDir, "package.ncpkg");
  const metaFile       = path.join(versionDir, "install.json");
  const dbPath         = path.join(pluginsRoot, "plugins.sqlite");
  const stagingDir     = path.join(pluginsRoot, "staging", `install-${randomUUID()}`);
  const pkgRelPath     = path.relative(packagesDir, packageDir);

  log(`安装目标: ${versionDir}`);

  // 7. 检测已安装版本
  if (existsSync(metaFile)) {
    try {
      const existing = JSON.parse(readFileSync(metaFile, "utf8"));
      if (existing.archiveSha256 === archiveSha) {
        ok(`插件 ${pluginId}@${version} 已是最新版本，无需重装`);
        process.exit(0);
      }
      warn(`检测到已安装版本 archiveSha256 不同，将覆盖安装`);
    } catch { /* 损坏，继续覆盖 */ }
  }

  if (dryRun) {
    log("[DRY RUN] 将写入以下路径:");
    log(`  ${packageDir}/<解压文件>`);
    log(`  ${archiveFile}`);
    log(`  ${metaFile}`);
    log(`  ${dbPath}`);
    ok("DRY RUN 完成，未写入任何文件");
    process.exit(0);
  }

  // 8. 写文件（先写 staging，再 rename，与 PackageStore 一致）
  log("正在写入文件...");
  mkdirSync(stagingDir, { recursive: true });

  try {
    const stagingPkg = path.join(stagingDir, "package");
    mkdirSync(stagingPkg, { recursive: true });

    // 解压全部文件到 staging/package/
    for (const f of files) {
      const dest = path.join(stagingPkg, f.path);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, f.data);
      // Linux/macOS：确保 .sh / 无扩展名二进制可执行
      if (process.platform !== "win32" && (f.path.endsWith(".sh") || !path.extname(f.path))) {
        try { chmodSync(dest, 0o755); } catch {}
      }
    }

    // 复制 .ncpkg 到 staging/
    writeFileSync(path.join(stagingDir, "package.ncpkg"), buf);

    // 写 install.json
    const meta = { pluginId, version, archiveSha256: archiveSha, contentSha256: contentSha };
    writeFileSync(
      path.join(stagingDir, "install.json"),
      JSON.stringify(meta, null, 2) + "\n",
      "utf8",
    );

    // 创建目标父目录（plugin 目录），rename staging -> versionDir
    mkdirSync(pluginDir, { recursive: true });
    if (existsSync(versionDir)) rmSync(versionDir, { recursive: true, force: true });
    renameSync(stagingDir, versionDir);
    log(`文件已写入: ${versionDir}`);

  } catch (e) {
    // 清理 staging
    try { rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    fatal(`文件写入失败: ${e.message}`);
  }

  // 9. 写 SQLite
  log("正在写入插件数据库...");
  let db;
  try {
    db = openPluginDatabase(dbPath);
    upsertPlugin(db, {
      pluginId,
      version,
      manifestJson: JSON.stringify(manifest),
      archiveSha256: archiveSha,
      packageRelativePath: pkgRelPath,
    });
    db.close();
    log(`数据库已更新: ${dbPath}`);
  } catch (e) {
    if (db) { try { db.close(); } catch {} }
    fatal(`数据库写入失败: ${e.message}`);
  }

  log("=".repeat(60));
  ok(`插件 ${pluginId}@${version} 安装成功！`);
  ok(`userData: ${userData}`);
  log("请重启 Netcatty，侧边栏将出现 CMDB 标签。");
  log("=".repeat(60));
}

main().catch((e) => fatal(e?.message ?? String(e)));
