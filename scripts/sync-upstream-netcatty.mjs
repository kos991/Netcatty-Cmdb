// 读取上游 Netcatty 最新正式 Release，更新 integrations/netcatty/upstream.json。
// 用法：node scripts/sync-upstream-netcatty.mjs <已检出上游的目录> <mosh 版本> <et 版本>
// 输出 changed=true|false 与 release=<tag>，供工作流决定是否开 PR。
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [upstreamDir, moshRelease, etRelease] = process.argv.slice(2);
if (!upstreamDir || !moshRelease || !etRelease) {
  throw new Error("Usage: node scripts/sync-upstream-netcatty.mjs <upstream-dir> <mosh-release> <et-release>");
}
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstreamPath = join(repositoryRoot, "integrations", "netcatty", "upstream.json");
const current = JSON.parse(readFileSync(upstreamPath, "utf8"));

const git = (...args) => execFileSync("git", args, { cwd: resolve(upstreamDir), encoding: "utf8" }).trim();
const release = git("describe", "--tags", "--exact-match", "HEAD");
if (!/^v\d+\.\d+\.\d+$/.test(release)) throw new Error(`上游检出的不是正式版本 tag：${release}`);
const next = { ...current, release, commit: git("rev-parse", "HEAD"), moshRelease, etRelease };

const changed = JSON.stringify(next) !== JSON.stringify(current);
if (changed) writeFileSync(upstreamPath, `${JSON.stringify(next, null, 2)}\n`);
const summary = `changed=${changed}\nrelease=${release}\nprevious=${current.release}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, summary);
process.stdout.write(summary);
