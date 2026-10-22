// 生成 Cmdb 离线补丁包：只含 app.asar 与 cmdb-server.exe，安装脚本按 build-info 校验宿主版本后覆盖。
// 用法：node scripts/build-cmdb-patch.mjs <win-unpacked 目录> <build-info.json> <输出 zip>
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [unpackedArg, buildInfoArg, outputArg] = process.argv.slice(2);
if (!unpackedArg || !buildInfoArg || !outputArg) {
  throw new Error("Usage: node scripts/build-cmdb-patch.mjs <win-unpacked> <build-info.json> <output.zip>");
}
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const unpacked = resolve(unpackedArg);
// Windows PowerShell 写出的 JSON 可能带 BOM，统一去掉后再解析。
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const buildInfo = readJson(resolve(buildInfoArg));
const output = resolve(outputArg);

// 补丁覆盖的文件；路径相对于安装目录，不包含 app.asar.unpacked 等宿主文件。
const PATCH_FILES = ["resources/app.asar", "resources/cmdb/cmdb-server.exe", "resources/cmdb/build-info.json"];

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const staging = mkdtempSync(join(tmpdir(), "cmdb-patch-"));
try {
  const files = PATCH_FILES.map((relative) => {
    const source = join(unpacked, relative);
    if (!existsSync(source)) throw new Error(`补丁源文件缺失：${source}`);
    const destination = join(staging, "payload", relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    return { path: relative, size: statSync(source).size, sha256: sha256(source) };
  });
  const installed = readJson(join(unpacked, "resources/cmdb/build-info.json"));
  if (installed.cmdbVersion !== buildInfo.cmdbVersion || installed.upstreamCommit !== buildInfo.upstreamCommit) {
    throw new Error("win-unpacked 内的 build-info.json 与本次构建信息不一致");
  }
  writeFileSync(join(staging, "patch-manifest.json"), `${JSON.stringify({ ...buildInfo, files }, null, 2)}\n`);
  for (const name of ["install-cmdb-patch.ps1", "install-cmdb-patch.cmd", "README.txt"]) {
    copyFileSync(join(repositoryRoot, "integrations", "netcatty", "patch", name), join(staging, name));
  }
  rmSync(output, { force: true });
  // Windows runner 与本地都自带 PowerShell Compress-Archive；不引入额外打包依赖。
  execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Compress-Archive -Path '${join(staging, "*").replaceAll("'", "''")}' -DestinationPath '${output.replaceAll("'", "''")}' -CompressionLevel Optimal`], { stdio: "inherit" });
  console.log(`${basename(output)} ${(statSync(output).size / 2 ** 20).toFixed(1)} MB`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
