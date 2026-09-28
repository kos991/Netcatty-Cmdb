import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  applyCmdbCloudSnapshot,
  collectCmdbCloudSnapshot,
  readCmdbCloudSyncSettings,
  scheduleCmdbCloudSync,
  writeCmdbCloudSyncSettings,
} from './CmdbCloudSync';
import type { CmdbSyncSnapshot } from './CmdbSyncSnapshot';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

const snapshot: CmdbSyncSnapshot = {
  schema_version: 1,
  project_sync_id: 'project-1',
  generated_at: '2026-09-21T10:00:00Z',
  base_hash: 'a'.repeat(64),
  collections: { assets: [] },
  tombstones: [],
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });
});

describe('CmdbCloudSync', () => {
  it('默认关闭，不调用导出接口', async () => {
    let called = false;
    const result = await collectCmdbCloudSnapshot(async () => {
      called = true;
      return snapshot;
    });
    assert.equal(result, undefined);
    assert.equal(called, false);
  });

  it('启用后按隐私设置导出规范快照', async () => {
    writeCmdbCloudSyncSettings({ enabled: true, includeContacts: true, includeHistory: false });
    const calls: Array<{ path: string; body?: string }> = [];
    const result = await collectCmdbCloudSnapshot(async (request) => {
      calls.push(request);
      return snapshot;
    });
    assert.equal(result, snapshot);
    assert.deepEqual(calls, [{
      path: '/api/cmdb/sync/export',
      method: 'POST',
      body: JSON.stringify({ include_contacts: true, include_history: false }),
    }]);
  });

  it('下载快照必须先预检再应用，并记录成功状态', async () => {
    writeCmdbCloudSyncSettings({ enabled: true });
    const calls: string[] = [];
    await applyCmdbCloudSnapshot(snapshot, async (request) => {
      calls.push(request.path);
      if (request.path.endsWith('/preflight')) {
        return { conflicts: 0, unresolved_references: 0 };
      }
      return { base_hash: snapshot.base_hash };
    });
    assert.deepEqual(calls, ['/api/cmdb/sync/preflight', '/api/cmdb/sync/apply']);
    assert.equal(readCmdbCloudSyncSettings().lastStatus, 'success');
  });

  it('预检冲突时禁止应用并暴露错误', async () => {
    writeCmdbCloudSyncSettings({ enabled: true });
    const calls: string[] = [];
    await assert.rejects(
      applyCmdbCloudSnapshot(snapshot, async (request) => {
        calls.push(request.path);
        return { conflicts: 1, unresolved_references: 0 };
      }),
      /Cmdb 同步预检未通过/,
    );
    assert.deepEqual(calls, ['/api/cmdb/sync/preflight']);
    assert.equal(readCmdbCloudSyncSettings().lastStatus, 'error');
  });

  it('Cmdb 写操作可防抖触发 Netcatty 同步', async () => {
    writeCmdbCloudSyncSettings({ enabled: true });
    let triggered = 0;
    window.addEventListener('netcatty:cmdb-cloud-sync-request', () => { triggered += 1; });
    scheduleCmdbCloudSync(0);
    scheduleCmdbCloudSync(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(triggered, 1);
  });
});
