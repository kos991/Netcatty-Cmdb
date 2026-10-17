const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');

const { AttachmentSyncScheduler, requestCmdb } = require('./attachment_sync');

const HASH = 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890';

/**
 * 启动一个模拟 CMDB 本地服务，routes 以 `METHOD /path` 为键。
 * 处理函数可返回 `{ status, data }` 或直接返回 `data`，也支持异步。
 * 返回 `calls` 记录每次请求，便于断言请求是否真实发生。
 */
async function fakeCmdbServer(routes) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const { pathname, search } = new URL(req.url, 'http://127.0.0.1');
    calls.push({ method: req.method, path: pathname, search, body: null });
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : null;
      calls[calls.length - 1].body = body;
      const route = routes[`${req.method} ${pathname}`];
      let status = 200;
      let data = {};
      try {
        if (typeof route === 'function') {
          const result = await route(body);
          status = result?.status ?? 200;
          data = result?.data;
        } else if (route) {
          data = route;
        } else {
          status = 404;
        }
      } catch (err) {
        status = 500;
        data = { error: err.message };
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, calls };
}

function freePort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function attachment(overrides = {}) {
  return {
    id: 11,
    file_name: '证据.txt',
    content_hash: HASH,
    s3_status: 'pending',
    s3_key: `attachments/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.bin`,
    content_type: 'text/plain',
    ...overrides,
  };
}

test('requestCmdb 解析 JSON 响应并携带状态码', async (t) => {
  const { server, port } = await fakeCmdbServer({
    'GET /ping': { ok: true },
  });
  t.after(() => server.close());
  const result = await requestCmdb('/ping', 'GET', null, port);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.data, { ok: true });
});

test('requestCmdb 发送 JSON 请求体并回读响应', async (t) => {
  const received = [];
  const { server, port } = await fakeCmdbServer({
    'PUT /state': (body) => {
      received.push(body);
      return { status: 200, data: { saved: body.s3_status } };
    },
  });
  t.after(() => server.close());
  const result = await requestCmdb('/state', 'PUT', { s3_status: 'synced' }, port);
  assert.deepEqual(received, [{ s3_status: 'synced' }]);
  assert.deepEqual(result.data, { saved: 'synced' });
});

test('requestCmdb 对非 JSON 响应返回原始文本', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('not-json');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const result = await requestCmdb('/raw', 'GET', null, server.address().port);
  assert.equal(result.statusCode, 200);
  assert.equal(result.raw, 'not-json');
  assert.equal(result.data, undefined);
});

test('requestCmdb 连接失败时拒绝', async () => {
  const port = await freePort();
  await assert.rejects(requestCmdb('/nope', 'GET', null, port));
});

test('未连接 S3 或缺少 IPC 时不发起任何请求', async () => {
  const invoke = [];
  const ipc = { invoke: async (...args) => invoke.push(args) };

  const noS3 = new AttachmentSyncScheduler({ ipc, getS3Config: () => null });
  await noS3.syncPendingAttachments();

  const noIpc = new AttachmentSyncScheduler({ ipc: null, getS3Config: () => ({}) });
  await noIpc.syncPendingAttachments();

  assert.equal(invoke.length, 0);
});

test('成功路径：检测本地文件存在后流式上传并回写 synced', async (t) => {
  const s3Config = { endpoint: 'https://s3.local', bucket: 'czfy' };
  const uploads = [];
  const { server, port, calls } = await fakeCmdbServer({
    'GET /api/cmdb/work-orders': { list: [{ id: 7 }] },
    'GET /api/cmdb/work-orders/7/attachments': { list: [attachment()] },
    'GET /api/cmdb/attachments/hash/a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890/status': {
      local_exists: true,
      local_path: 'C:/tmp/cas/a1b2c3d4.bin',
    },
    'PUT /api/cmdb/work-orders/7/attachments/11/s3-status': { ok: '1' },
  });
  t.after(() => server.close());

  const scheduler = new AttachmentSyncScheduler({
    ipc: { invoke: async (...args) => uploads.push(args) },
    getS3Config: () => s3Config,
    port,
  });
  await scheduler.syncPendingAttachments();

  assert.equal(uploads.length, 1);
  const [channel, payload] = uploads[0];
  assert.equal(channel, 'netcatty:cloudSync:s3:uploadAttachment');
  assert.deepEqual(payload, {
    config: s3Config,
    subKey: `attachments/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.bin`,
    localFilePath: 'C:/tmp/cas/a1b2c3d4.bin',
    contentType: 'text/plain',
  });

  const statusCalls = calls.filter((call) => call.method === 'PUT');
  assert.equal(statusCalls.length, 1);
  assert.deepEqual(statusCalls[0].body, {
    s3_status: 'synced',
    s3_key: `attachments/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.bin`,
  });
  assert.equal(scheduler.isSyncing, false);
});

test('缺少 s3_key 时按内容哈希推导默认对象键', async (t) => {
  const uploads = [];
  const { server, port } = await fakeCmdbServer({
    'GET /api/cmdb/work-orders': { list: [{ id: 7 }] },
    'GET /api/cmdb/work-orders/7/attachments': { list: [attachment({ s3_key: '' })] },
    'GET /api/cmdb/attachments/hash/a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890/status': {
      local_exists: true,
      local_path: 'C:/tmp/cas/a1b2c3d4.bin',
    },
    'PUT /api/cmdb/work-orders/7/attachments/11/s3-status': { ok: '1' },
  });
  t.after(() => server.close());

  await new AttachmentSyncScheduler({
    ipc: { invoke: async (...args) => uploads.push(args) },
    getS3Config: () => ({}),
    port,
  }).syncPendingAttachments();

  assert.equal(uploads[0][1].subKey, `attachments/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.bin`);
});

test('已同步附件跳过上传和状态回写', async (t) => {
  const uploads = [];
  const { server, port, calls } = await fakeCmdbServer({
    'GET /api/cmdb/work-orders': { list: [{ id: 7 }] },
    'GET /api/cmdb/work-orders/7/attachments': { list: [attachment({ s3_status: 'synced' })] },
  });
  t.after(() => server.close());

  await new AttachmentSyncScheduler({
    ipc: { invoke: async (...args) => uploads.push(args) },
    getS3Config: () => ({}),
    port,
  }).syncPendingAttachments();

  assert.equal(uploads.length, 0);
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 0);
  assert.equal(calls.filter((call) => call.path.includes('/attachments/hash/')).length, 0);
});

test('本地文件缺失时不上传', async (t) => {
  const uploads = [];
  const { server, port } = await fakeCmdbServer({
    'GET /api/cmdb/work-orders': { list: [{ id: 7 }] },
    'GET /api/cmdb/work-orders/7/attachments': { list: [attachment()] },
    'GET /api/cmdb/attachments/hash/a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890/status': {
      local_exists: false,
      local_path: '',
    },
  });
  t.after(() => server.close());

  await new AttachmentSyncScheduler({
    ipc: { invoke: async (...args) => uploads.push(args) },
    getS3Config: () => ({}),
    port,
  }).syncPendingAttachments();

  assert.equal(uploads.length, 0);
});

test('单个附件上传失败不影响后续附件，且不误标 synced', async (t) => {
  const uploads = [];
  const { server, port, calls } = await fakeCmdbServer({
    'GET /api/cmdb/work-orders': { list: [{ id: 7 }] },
    'GET /api/cmdb/work-orders/7/attachments': {
      list: [attachment({ id: 1, s3_key: 'k1' }), attachment({ id: 2, s3_key: 'k2' })],
    },
    'GET /api/cmdb/attachments/hash/a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890/status': {
      local_exists: true,
      local_path: 'C:/tmp/cas/a1b2c3d4.bin',
    },
    'PUT /api/cmdb/work-orders/7/attachments/2/s3-status': { ok: '1' },
  });
  t.after(() => server.close());

  await new AttachmentSyncScheduler({
    ipc: {
      invoke: async (channel, payload) => {
        uploads.push(payload.subKey);
        if (payload.subKey === 'k1') throw new Error('模拟 S3 上传失败');
      },
    },
    getS3Config: () => ({}),
    port,
  }).syncPendingAttachments();

  assert.deepEqual(uploads, ['k1', 'k2']);
  const statusBodies = calls.filter((call) => call.method === 'PUT').map((call) => call.body);
  assert.deepEqual(statusBodies, [{ s3_status: 'synced', s3_key: 'k2' }]);
  assert.equal(calls.filter((call) => call.path.endsWith('/1/s3-status')).length, 0);
});

test('工单列表响应缺少 list 时提前返回，不继续拉取附件', async (t) => {
  const { server, port, calls } = await fakeCmdbServer({
    'GET /api/cmdb/work-orders': { data: {} },
  });
  t.after(() => server.close());

  await new AttachmentSyncScheduler({
    ipc: { invoke: async () => {} },
    getS3Config: () => ({}),
    port,
  }).syncPendingAttachments();

  assert.equal(calls.filter((call) => call.path.includes('/attachments')).length, 0);
});

test('并发同步通过 isSyncing 串行化，不重复处理', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { server, port, calls } = await fakeCmdbServer({
    'GET /api/cmdb/work-orders': () => gate.then(() => ({ list: [] })),
  });
  t.after(() => server.close());

  const scheduler = new AttachmentSyncScheduler({
    ipc: { invoke: async () => {} },
    getS3Config: () => ({}),
    port,
  });
  const first = scheduler.syncPendingAttachments();
  const second = scheduler.syncPendingAttachments();
  release();
  await Promise.all([first, second]);

  assert.equal(calls.filter((call) => call.path === '/api/cmdb/work-orders').length, 1);
  assert.equal(scheduler.isSyncing, false);
});

test('start 注册定时器并在启动后触发一次同步，stop 清除定时器', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let runs = 0;
  const scheduler = new AttachmentSyncScheduler({
    ipc: { invoke: async () => {} },
    getS3Config: () => null,
    syncIntervalMs: 60000,
  });
  scheduler.syncPendingAttachments = () => {
    runs += 1;
    return Promise.resolve();
  };

  scheduler.start();
  assert.ok(scheduler.timer);
  t.mock.timers.tick(5000);
  assert.equal(runs, 1);

  scheduler.stop();
  assert.equal(scheduler.timer, null);
  scheduler.stop();
  assert.equal(scheduler.timer, null);

  t.mock.timers.tick(120000);
  assert.equal(runs, 1);
  t.mock.timers.reset();
});
