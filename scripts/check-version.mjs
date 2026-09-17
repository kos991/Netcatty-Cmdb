import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected = readFileSync(join(root, "VERSION"), "utf8").trim();
const sources = [
  ["web/package.json", JSON.parse(readFileSync(join(root, "web/package.json"), "utf8")).version],
  ["netcatty/package.json", JSON.parse(readFileSync(join(root, "netcatty/package.json"), "utf8")).version],
];

for (const [file, actual] of sources) {
  if (actual !== expected) throw new Error(`${file} version ${actual} does not match VERSION ${expected}`);
}

const tagIndex = process.argv.indexOf("--tag");
if (tagIndex >= 0) {
  const tag = process.argv[tagIndex + 1];
  if (tag !== `v${expected}`) throw new Error(`Tag ${tag} does not match v${expected}`);
}

console.log(`Version ${expected} is consistent`);
