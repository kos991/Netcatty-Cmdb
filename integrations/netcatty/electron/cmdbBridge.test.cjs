"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CMDB_CHANNELS,
  normalizeApiPath,
  requestCmdb,
  registerCmdbBridge,
} = require("./cmdbBridge.cjs");

function registerTestBridge(options = {}) {
  const handlers = new Map();
  registerCmdbBridge({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: options.dialog ?? {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    getService: options.getService ?? (() => ({ baseUrl: "http://127.0.0.1:18080" })),
    getStartupError: options.getStartupError,
    fetchImpl: options.fetchImpl ?? (async () => new Response("{}", { status: 200 })),
    readFile: options.readFile ?? (async () => Buffer.from("spreadsheet")),
    writeFile: options.writeFile ?? (async () => {}),
    createToken: options.createToken ?? (() => "selected-file-token"),
  });
  return handlers;
}

test("rejects absolute and escaped API paths", () => {
  assert.throws(() => normalizeApiPath("https://example.com/api/assets"), /CMDB API 路径/);
  assert.throws(() => normalizeApiPath("/api/../admin"), /CMDB API 路径/);
});

test("returns JSON responses through the service base URL", async () => {
  let requestedUrl;
  const result = await requestCmdb({
    service: { baseUrl: "http://127.0.0.1:18080" },
    path: "/api/assets?keyword=%E8%B5%84%E4%BA%A7",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response('{"items":[{"id":1}]}', { status: 200 });
    },
  });

  assert.equal(requestedUrl, "http://127.0.0.1:18080/api/assets?keyword=%E8%B5%84%E4%BA%A7");
  assert.deepEqual(result, { items: [{ id: 1 }] });
});

test("returns binary responses for main-process downloads", async () => {
  const result = await requestCmdb({
    service: { baseUrl: "http://127.0.0.1:18080" },
    path: "/api/export/assets",
    responseType: "binary",
    fetchImpl: async () => new Response(Uint8Array.from([1, 2, 3]), { status: 200 }),
  });

  assert.deepEqual([...result], [1, 2, 3]);
});

test("surfaces non-2xx response errors", async () => {
  await assert.rejects(
    requestCmdb({
      service: { baseUrl: "http://127.0.0.1:18080" },
      path: "/api/assets",
      fetchImpl: async () => new Response('{"error":"数据库忙"}', { status: 500 }),
    }),
    /数据库忙/,
  );
});

test("rejects requests when the service is not running", async () => {
  const handlers = registerTestBridge({ getService: () => null });
  await assert.rejects(
    handlers.get(CMDB_CHANNELS.request)({}, { path: "/api/assets" }),
    /CMDB 服务未启动/,
  );
});

test("returns the CMDB startup failure through the status response", async () => {
  const handlers = registerTestBridge({
    getService: () => null,
    getStartupError: () => "未找到 cmdb-server 可执行文件",
  });

  const result = await handlers.get(CMDB_CHANNELS.status)();

  assert.deepEqual(result, {
    available: false,
    error: "未找到 cmdb-server 可执行文件",
  });
});

test("reports a request timeout", async () => {
  await assert.rejects(
    requestCmdb({
      service: { baseUrl: "http://127.0.0.1:18080" },
      path: "/api/assets",
      timeoutMs: 5,
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    }),
    /CMDB 请求超时/,
  );
});

test("returns cancellation without uploading when import selection is cancelled", async () => {
  let requests = 0;
  const handlers = registerTestBridge({
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    fetchImpl: async () => {
      requests += 1;
      return new Response("{}", { status: 200 });
    },
  });

  const result = await handlers.get(CMDB_CHANNELS.importFile)({}, { path: "/api/import/sangfor" });

  assert.deepEqual(result, { cancelled: true });
  assert.equal(requests, 0);
});

test("rejects caller-supplied query parameters on import paths", async () => {
  const handlers = registerTestBridge({
    dialog: {
      showOpenDialog: async () => { throw new Error("不应打开文件选择框"); },
      showSaveDialog: async () => ({ canceled: true }),
    },
  });

  await assert.rejects(
    handlers.get(CMDB_CHANNELS.importFile)({}, {
      path: "/api/import/sangfor?commit=1",
      commit: false,
    }),
    /CMDB 导入路径不允许/,
  );
});

test("requires an import token before commit and never opens file selection", async () => {
  const handlers = registerTestBridge({
    dialog: {
      showOpenDialog: async () => { throw new Error("不应打开文件选择框"); },
      showSaveDialog: async () => ({ canceled: true }),
    },
  });

  await assert.rejects(
    handlers.get(CMDB_CHANNELS.importFile)({}, {
      path: "/api/cmdb/assets/import",
      commit: true,
    }),
    /CMDB 导入确认需要有效令牌/,
  );
});

test("keeps a selected import file behind an in-memory token until commit", async () => {
  const requestedUrls = [];
  const handlers = registerTestBridge({
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ["C:/imports/assets.xlsx"] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return new Response('{"imported":1}', { status: 200 });
    },
  });

  const preview = await handlers.get(CMDB_CHANNELS.importFile)({}, { path: "/api/cmdb/assets/import" });
  const committed = await handlers.get(CMDB_CHANNELS.importFile)({}, {
    path: "/api/cmdb/assets/import",
    commit: true,
    token: preview.token,
  });

  assert.equal(preview.token, "selected-file-token");
  assert.equal(preview.imported, 1);
  assert.equal(committed.imported, 1);
  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:18080/api/cmdb/assets/import",
    "http://127.0.0.1:18080/api/cmdb/assets/import?commit=1",
  ]);
});

test("allows native terminal asset import with preview and commit", async () => {
  const requestedUrls = [];
  const handlers = registerTestBridge({
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ["C:/imports/terminal-assets.xlsx"] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return new Response('{"valid":1}', { status: 200 });
    },
  });

  const preview = await handlers.get(CMDB_CHANNELS.importFile)({}, { path: "/api/import/assets" });
  await handlers.get(CMDB_CHANNELS.importFile)({}, {
    path: "/api/import/assets",
    commit: true,
    token: preview.token,
  });

  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:18080/api/import/assets",
    "http://127.0.0.1:18080/api/import/assets?commit=1",
  ]);
});

test("returns cancellation without writing when export selection is cancelled", async () => {
  let writes = 0;
  const handlers = registerTestBridge({
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    writeFile: async () => { writes += 1; },
    fetchImpl: async () => new Response(Uint8Array.from([9]), { status: 200 }),
  });

  const result = await handlers.get(CMDB_CHANNELS.exportFile)({}, {
    path: "/api/export/assets",
    suggestedName: "assets.xlsx",
  });

  assert.deepEqual(result, { cancelled: true });
  assert.equal(writes, 0);
});

test("writes downloaded binary only to the path accepted by the save dialog", async () => {
  const writes = [];
  const handlers = registerTestBridge({
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: false, filePath: "C:/exports/assets.xlsx" }),
    },
    writeFile: async (filePath, data) => writes.push({ filePath, data: [...data] }),
    fetchImpl: async () => new Response(Uint8Array.from([9, 8]), { status: 200 }),
  });

  const result = await handlers.get(CMDB_CHANNELS.exportFile)({}, {
    path: "/api/export/assets",
    suggestedName: "assets.xlsx",
  });

  assert.deepEqual(result, { cancelled: false, filePath: "C:/exports/assets.xlsx" });
  assert.deepEqual(writes, [{ filePath: "C:/exports/assets.xlsx", data: [9, 8] }]);
});
