// 本地快速部署：装配 → 前端构建 → 替换已安装 app.asar（可选重启客户端）。
// 用法：node scripts/deploy-local-ui.mjs [--skip-prepare] [--skip-build] [--restart]
// 只替换 app.asar；不改动用户数据库、连接、密钥与设置。替换前自动备份到 %TEMP%。
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const root = resolve(import.meta.dirname, "..");
const netcatty = join(root, "build", "netcatty");
const installed = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "Netcatty", "resources", "app.asar");
const dist = join(netcatty, "dist");

if (!existsSync(installed)) throw new Error(`未找到已安装客户端：${installed}`);
if (!existsSync(netcatty)) throw new Error("缺少 build/netcatty：先运行 prepare-netcatty 并安装依赖");

const step = (label, command, commandArgs, options = {}) => {
  console.log(`\n[deploy] ${label}`);
  // 中文路径经 cmd 解析会被拆开，node 自身不需要 shell。
  execFileSync(command, commandArgs, { cwd: root, stdio: "inherit", shell: command === "npm" && process.platform === "win32", ...options });
};

if (!args.has("--skip-prepare")) step("装配 Netcatty 集成源码", process.execPath, [join(root, "scripts", "prepare-netcatty.mjs"), "--target", netcatty]);
if (!args.has("--skip-build")) step("构建前端", "npm", ["run", "build"], { cwd: netcatty });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(tmpdir(), `netcatty-app-asar-${stamp}.asar`);
copyFileSync(installed, backup);
console.log(`\n[deploy] 已备份原 app.asar -> ${backup}`);

const staged = join(tmpdir(), `netcatty-app-asar-${stamp}-new.asar`);
step("把最新 dist 写入 app.asar", process.execPath, [join(root, "scripts", "patch-asar-dist.cjs"), installed, dist, staged]);
// 客户端运行中时重命名可能被锁，直接原地覆盖同一路径。
copyFileSync(staged, installed);
const sha = (await import("node:crypto")).createHash("sha256").update(readFileSync(installed)).digest("hex");
writeFileSync(join(tmpdir(), "netcatty-last-deploy.json"), `${JSON.stringify({ at: new Date().toISOString(), installed, backup, sha256: sha }, null, 2)}\n`);
console.log(`[deploy] 完成 app.asar SHA256=${sha}`);

if (args.has("--restart")) {
  console.log("[deploy] 重启客户端（会结束当前窗口与会话）");
  const exe = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "Netcatty", "Netcatty.exe");
  try { execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Process Netcatty -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Stop-Process -Force"]); } catch {}
  spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
}
