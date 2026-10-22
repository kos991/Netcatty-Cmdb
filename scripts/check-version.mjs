import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 版本格式固定为 1.0.YYYYMMDDHHmm：VERSION 是唯一来源，发布 tag 必须为 v<VERSION>。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected = readFileSync(join(root, "VERSION"), "utf8").trim();

const match = /^1\.0\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(expected);
if (!match) throw new Error(`VERSION ${expected} must use 1.0.YYYYMMDDHHmm`);
const [, year, month, day, hour, minute] = match.map(Number);
const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) {
  throw new Error(`VERSION ${expected} contains an invalid date or time`);
}

const pluginVersion = JSON.parse(readFileSync(join(root, "netcatty/package.json"), "utf8")).version;
if (pluginVersion !== expected) throw new Error(`netcatty/package.json version ${pluginVersion} does not match VERSION ${expected}`);

const tagIndex = process.argv.indexOf("--tag");
if (tagIndex >= 0) {
  const tag = process.argv[tagIndex + 1];
  if (tag !== `v${expected}`) throw new Error(`Tag ${tag} does not match v${expected}`);
}

console.log(`Version ${expected} is consistent`);
