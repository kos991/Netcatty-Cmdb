"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { startCmdbService } = require("./cmdbService.cjs");

function fakeChild() {
  const listeners = new Map();
  return {
    pid: 1234,
    exitCode: null,
    signalCode: null,
    once(event, listener) {
      listeners.set(event, listener);
      if (event === "spawn") queueMicrotask(listener);
    },
    removeListener(event) { listeners.delete(event); },
    kill() { this.signalCode = "SIGTERM"; },
  };
}

test("starts CMDB with fixed port and waits for health", async () => {
  const calls = [];
  let healthChecks = 0;
  let healthUrl;
  const service = await startCmdbService({
    executablePath: "C:/cmdb-server.exe",
    databasePath: "C:/assets.db",
    port: 18080,
    spawn(executable, args, options) {
      calls.push({ executable, args, options });
      return fakeChild();
    },
    fetch: async (url) => {
      healthChecks += 1;
      healthUrl = url;
      return { ok: true, status: 200, url };
    },
  });

  assert.equal(service.baseUrl, "http://127.0.0.1:18080");
  assert.deepEqual(calls[0].args, ["-port", "18080", "-db", "C:/assets.db", "-api-only"]);
  assert.equal(healthUrl, "http://127.0.0.1:18080/api/health");
  assert.equal(healthChecks, 1);
  service.stop();
});

test("stops the child when health check fails", async () => {
  let child;
  await assert.rejects(
    startCmdbService({
      executablePath: "cmdb-server.exe",
      port: 18080,
      timeoutMs: 1,
      pollIntervalMs: 1,
      spawn() {
        child = fakeChild();
        return child;
      },
      fetch: async () => { throw new Error("connection refused"); },
      kill: (process) => process.kill(),
    }),
    /CMDB 服务启动超时/,
  );
  assert.equal(child.signalCode, "SIGTERM");
});

test("reports and stops when CMDB exits before becoming healthy", async () => {
  let child;
  await assert.rejects(
    startCmdbService({
      executablePath: "cmdb-server.exe",
      port: 18080,
      timeoutMs: 100,
      pollIntervalMs: 1,
      spawn() {
        child = fakeChild();
        child.exitCode = 1;
        return child;
      },
      fetch: async () => ({ ok: true, status: 200 }),
      kill: (process) => process.kill(),
    }),
    /CMDB 服务提前退出/,
  );
  assert.equal(child.exitCode, 1);
});
