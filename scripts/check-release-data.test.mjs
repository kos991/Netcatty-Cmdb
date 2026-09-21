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
