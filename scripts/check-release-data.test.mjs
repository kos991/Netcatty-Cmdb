import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { scanTargets } from "./check-release-data.mjs";

test("打包前输入扫描可拦截被压缩 Portable 掩盖的数据", () => {
  const directory = mkdtempSync(join(tmpdir(), "cmdb-release-data-"));
  try {
    const inputDirectory = join(directory, "app-input");
    mkdirSync(inputDirectory);
    const inputFile = join(inputDirectory, "cmdb-server.exe");
    writeFileSync(inputFile, "2025100002017773");

    const portableFile = join(directory, "portable.exe");
    writeFileSync(portableFile, gzipSync(readFileSync(inputFile)));

    assert.deepEqual(scanTargets([portableFile]), []);
    assert.deepEqual(
      scanTargets([inputDirectory, portableFile]).map(([ruleName]) => ruleName),
      ["known_asset_code"],
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("发布目录出现任意数据库文件时拒绝打包", () => {
  const directory = mkdtempSync(join(tmpdir(), "cmdb-release-database-"));
  try {
    writeFileSync(join(directory, "assets.db"), "unknown test rows");
    assert.deepEqual(scanTargets([directory]).map(([ruleName]) => ruleName), ["database_file"]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
