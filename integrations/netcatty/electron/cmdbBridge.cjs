"use strict";

const { randomUUID } = require("node:crypto");
const { readFile, writeFile } = require("node:fs/promises");
const { basename } = require("node:path");

const CMDB_REQUEST_TIMEOUT_MS = 30_000;
const API_ORIGIN = "http://cmdb.invalid";
const IMPORT_PATHS = new Set([
  "/api/import/sangfor",
  "/api/cmdb/assets/import",
]);

const CMDB_CHANNELS = Object.freeze({
  status: "netcatty:cmdb:status",
  request: "netcatty:cmdb:request",
  importFile: "netcatty:cmdb:import-file",
  exportFile: "netcatty:cmdb:export-file",
});

function normalizeApiPath(path) {
  if (typeof path !== "string") throw new TypeError("CMDB API 路径必须是字符串");
  const value = path.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("#")) {
    throw new TypeError("CMDB API 路径必须是以 /api/ 开头的相对路径");
  }

  let url;
  try {
    url = new URL(value, API_ORIGIN);
  } catch {
    throw new TypeError("CMDB API 路径必须是以 /api/ 开头的相对路径");
  }
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/api/")) {
    throw new TypeError("CMDB API 路径必须是以 /api/ 开头的相对路径");
  }
  return `${url.pathname}${url.search}`;
}

function resolveServiceBaseUrl(service) {
  if (!service || typeof service.baseUrl !== "string" || service.baseUrl.trim() === "") {
    throw new Error("CMDB 服务未启动");
  }
  return service.baseUrl.trim().replace(/\/+$/, "");
}

async function readError(response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    if (payload && Object.prototype.hasOwnProperty.call(payload, "error")) {
      return typeof payload.error === "string" ? payload.error : JSON.stringify(payload.error);
    }
  } catch {}
  return text || `HTTP ${response.status}`;
}

async function requestCmdb({
  service,
  path,
  method = "GET",
  headers,
  body,
  responseType = "json",
  fetchImpl = globalThis.fetch,
  timeoutMs = CMDB_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("CMDB 请求通道不可用");
  const normalizedPath = normalizeApiPath(path);
  const baseUrl = resolveServiceBaseUrl(service);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}${normalizedPath}`, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    if (!response?.ok) {
      if (!response) throw new Error("CMDB 请求未返回响应");
      throw new Error(await readError(response));
    }
    if (responseType === "binary") return Buffer.from(await response.arrayBuffer());
    return response.status === 204 ? null : response.json();
  } catch (error) {
    if (timedOut || controller.signal.aborted) {
      throw new Error("CMDB 请求超时（30 秒）");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function requireService(getService) {
  const service = getService();
  if (!service) throw new Error("CMDB 服务未启动");
  return service;
}

function importUrl(path, commit) {
  const normalizedPath = normalizeApiPath(path);
  const url = new URL(normalizedPath, API_ORIGIN);
  if (!IMPORT_PATHS.has(url.pathname)) {
    throw new Error("CMDB 导入路径不允许");
  }
  if (commit) url.searchParams.set("commit", "1");
  return `${url.pathname}${url.search}`;
}

function createImportForm(filePath, file) {
  const form = new FormData();
  form.append("file", new Blob([file]), basename(filePath));
  return form;
}

function registerCmdbBridge({
  ipcMain,
  dialog,
  getService,
  fetchImpl = globalThis.fetch,
  readFile: readFileImpl = readFile,
  writeFile: writeFileImpl = writeFile,
  createToken = randomUUID,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("CMDB IPC 注册需要 ipcMain.handle");
  if (!dialog || typeof dialog.showOpenDialog !== "function" || typeof dialog.showSaveDialog !== "function") {
    throw new TypeError("CMDB IPC 注册需要文件对话框");
  }
  if (typeof getService !== "function") throw new TypeError("CMDB IPC 注册需要 getService");

  const importFiles = new Map();

  ipcMain.handle(CMDB_CHANNELS.status, async () => {
    const service = getService();
    return service ? { available: true } : { available: false, error: "CMDB 服务未启动" };
  });

  ipcMain.handle(CMDB_CHANNELS.request, async (_event, payload = {}) => requestCmdb({
    service: requireService(getService),
    path: payload.path,
    method: payload.method,
    headers: payload.headers,
    body: payload.body,
    fetchImpl,
  }));

  ipcMain.handle(CMDB_CHANNELS.importFile, async (_event, payload = {}) => {
    const path = importUrl(payload.path, Boolean(payload.commit));
    const service = requireService(getService);
    let filePath;
    let token = typeof payload.token === "string" ? payload.token : null;
    if (token) {
      filePath = importFiles.get(token);
      if (!filePath) throw new Error("CMDB 导入文件令牌无效");
    } else {
      const selection = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Excel", extensions: ["xls", "xlsx"] }],
      });
      if (selection.canceled || !selection.filePaths?.[0]) return { cancelled: true };
      filePath = selection.filePaths[0];
      token = createToken();
      importFiles.set(token, filePath);
    }

    const response = await requestCmdb({
      service,
      path,
      method: "POST",
      body: createImportForm(filePath, await readFileImpl(filePath)),
      fetchImpl,
    });
    if (payload.commit) importFiles.delete(token);
    return { ...(response && typeof response === "object" ? response : { result: response }), token, cancelled: false };
  });

  ipcMain.handle(CMDB_CHANNELS.exportFile, async (_event, payload = {}) => {
    const binary = await requestCmdb({
      service: requireService(getService),
      path: payload.path,
      responseType: "binary",
      fetchImpl,
    });
    const suggestedName = typeof payload.suggestedName === "string" && payload.suggestedName.trim()
      ? basename(payload.suggestedName.trim())
      : "cmdb-export.bin";
    const target = await dialog.showSaveDialog({ defaultPath: suggestedName });
    if (target.canceled || !target.filePath) return { cancelled: true };
    await writeFileImpl(target.filePath, binary);
    return { cancelled: false, filePath: target.filePath };
  });
}

module.exports = {
  CMDB_CHANNELS,
  normalizeApiPath,
  requestCmdb,
  registerCmdbBridge,
};
