import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rules = [
  ["seed_v2.json", "seed_v2.json"],
  ["known_asset_code", "2025100002017773"],
  ["known_person_name", "邹婷婷"],
  ["known_real_ip", "138.64.8.129"],
];

function collectFiles(target) {
  const absolutePath = resolve(target);
  const stat = lstatSync(absolutePath);
  if (!stat.isDirectory()) return [absolutePath];

  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(absolutePath, entry.name);
    if (entry.isDirectory()) return collectFiles(child);
    return entry.isFile() ? [child] : [];
  });
}

export function scanTargets(targets) {
  const matches = [];
  for (const target of targets) {
    for (const file of collectFiles(target)) {
      const contents = readFileSync(file);
      for (const [ruleName, value] of rules) {
        if (contents.includes(Buffer.from(value))) matches.push([ruleName, file]);
      }
    }
  }
  return matches;
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    throw new Error("Usage: node scripts/check-release-data.mjs <artifact> [...artifact]");
  }

  const matches = scanTargets(targets);
  if (matches.length > 0) {
    for (const [ruleName, file] of matches) console.error(`发布数据扫描命中规则 ${ruleName}: ${file}`);
    process.exitCode = 1;
    return;
  }
  console.log("发布数据扫描通过");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
