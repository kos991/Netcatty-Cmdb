"use strict";

const { spawn: defaultSpawn } = require("node:child_process");

const DEFAULT_PORT = 18080;
const DEFAULT_HEALTH_PATH = "/api/health";
const DEFAULT_START_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 200;

function assertPort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new TypeError("CMDB port must be an integer between 1 and 65535");
  }
  return value;
}

function normalizeExecutablePath(executablePath) {
  if (typeof executablePath !== "string" || executablePath.trim() === "") {
    throw new TypeError("CMDB executable path is required");
  }
  return executablePath.trim();
}

function normalizeBaseUrl(port) {
  return `http://127.0.0.1:${assertPort(port)}`;
}

function waitForChildSpawn(child) {
  return new Promise((resolve, reject) => {
    const onSpawn = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      child.removeListener("spawn", onSpawn);
      child.removeListener("error", onError);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitForHealth({ fetchImpl, url, child, timeoutMs, pollIntervalMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`CMDB 服务提前退出（code=${child.exitCode ?? "null"}, signal=${child.signalCode ?? "none"}）`);
    }
    try {
      const response = await fetchImpl(url, { method: "GET" });
      if (response && response.ok) return;
      lastError = new Error(`CMDB 健康检查返回 HTTP ${response?.status ?? "unknown"}`);
    } catch (error) {
      lastError = error;
    }
    await wait(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`CMDB 服务启动超时：${lastError?.message ?? "健康检查未通过"}`);
}

function terminateChild(child, { kill = defaultKill } = {}) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try { kill(child); } catch {}
}

function defaultKill(child) {
  if (process.platform === "win32" && Number.isInteger(child.pid)) {
    try {
      defaultSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch {
      // Fall through to child.kill if taskkill is unavailable.
    }
  }
  child.kill();
}

/**
 * Start the Go CMDB server on a fixed loopback port and wait until its API is ready.
 * The returned handle is intentionally small so the Electron main process can own
 * the child lifetime without coupling this module to Electron APIs.
 */
async function startCmdbService(options = {}) {
  const executablePath = normalizeExecutablePath(options.executablePath);
  const port = assertPort(options.port ?? DEFAULT_PORT);
  const baseUrl = normalizeBaseUrl(port);
  const databasePath = typeof options.databasePath === "string" && options.databasePath.trim()
    ? options.databasePath.trim()
    : null;
  const args = ["-port", String(port), ...(databasePath ? ["-db", databasePath] : []), "-api-only"];
  const spawnImpl = options.spawn ?? defaultSpawn;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("CMDB health check requires fetch");

  const child = spawnImpl(executablePath, args, {
    windowsHide: true,
    stdio: options.stdio ?? "ignore",
    cwd: options.cwd,
    env: options.env,
  });
  await waitForChildSpawn(child);
  try {
    await waitForHealth({
      fetchImpl,
      url: `${baseUrl}${options.healthPath ?? DEFAULT_HEALTH_PATH}`,
      child,
      timeoutMs: options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });
  } catch (error) {
    terminateChild(child, options);
    throw error;
  }

  let stopped = false;
  return Object.freeze({
    child,
    executablePath,
    args: Object.freeze([...args]),
    port,
    baseUrl,
    stop() {
      if (stopped) return;
      stopped = true;
      terminateChild(child, options);
    },
  });
}

module.exports = {
  DEFAULT_HEALTH_PATH,
  DEFAULT_PORT,
  assertPort,
  normalizeBaseUrl,
  startCmdbService,
  terminateChild,
  waitForHealth,
};
