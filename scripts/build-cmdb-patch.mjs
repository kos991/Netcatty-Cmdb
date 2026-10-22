// 生成 Cmdb 离线补丁图形安装器：只含 app.asar 与 resources/cmdb，安装器按 build-info 校验宿主版本后覆盖。
// 用法：node scripts/build-cmdb-patch.mjs <win-unpacked 目录> <build-info.json> <输出 exe>
// makensis 路径：环境变量 MAKENSIS，否则使用 electron-builder 缓存中的 NSIS（构建安装包时已下载）。
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [unpackedArg, buildInfoArg, outputArg] = process.argv.slice(2);
if (!unpackedArg || !buildInfoArg || !outputArg) {
  throw new Error("Usage: node scripts/build-cmdb-patch.mjs <win-unpacked> <build-info.json> <output.exe>");
}
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patchSource = join(repositoryRoot, "integrations", "netcatty", "patch");
const unpacked = resolve(unpackedArg);
// Windows PowerShell 写出的 JSON 可能带 BOM，统一去掉后再解析。
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const buildInfo = readJson(resolve(buildInfoArg));
const output = resolve(outputArg);

// 补丁覆盖的文件；路径相对于安装目录，不包含 app.asar.unpacked 等宿主文件，也不涉及用户数据目录。
const PATCH_FILES = ["resources/app.asar", "resources/cmdb/cmdb-server.exe", "resources/cmdb/build-info.json"];

function findMakensis() {
  if (process.env.MAKENSIS) return process.env.MAKENSIS;
  const cache = process.env.ELECTRON_BUILDER_CACHE || join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "electron-builder", "Cache");
  for (const version of existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("nsis-") && !name.startsWith("nsis-resources")) : []) {
    for (const entry of readdirSync(join(cache, version))) {
      const candidate = join(cache, version, entry, "Bin", "makensis.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("未找到 makensis：请先用 electron-builder 构建 NSIS 安装包，或设置 MAKENSIS 环境变量");
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const staging = mkdtempSync(join(tmpdir(), "cmdb-patch-"));
try {
  const installed = readJson(join(unpacked, "resources/cmdb/build-info.json"));
  if (installed.cmdbVersion !== buildInfo.cmdbVersion || installed.upstreamCommit !== buildInfo.upstreamCommit) {
    throw new Error("win-unpacked 内的 build-info.json 与本次构建信息不一致");
  }
  const files = PATCH_FILES.map((relative) => {
    const source = join(unpacked, relative);
    if (!existsSync(source)) throw new Error(`补丁源文件缺失：${source}`);
    const destination = join(staging, "payload", relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    return { path: relative, size: statSync(source).size, sha256: sha256(source) };
  });
  writeFileSync(join(staging, "patch-manifest.json"), `${JSON.stringify({ ...buildInfo, files }, null, 2)}\n`);
  copyFileSync(join(patchSource, "patch-helper.ps1"), join(staging, "patch-helper.ps1"));
  rmSync(output, { force: true });
  execFileSync(findMakensis(), [
    "-V2", "-INPUTCHARSET", "UTF8",
    `-DPATCH_VERSION=${buildInfo.cmdbVersion}`,
    `-DUPSTREAM_RELEASE=${buildInfo.upstreamRelease}`,
    `-DSTAGING=${staging}`,
    `-DOUTFILE=${output}`,
    join(patchSource, "cmdb-patch-installer.nsi"),
  ], { stdio: "inherit" });
  console.log(`${basename(output)} ${(statSync(output).size / 2 ** 20).toFixed(1)} MB`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
