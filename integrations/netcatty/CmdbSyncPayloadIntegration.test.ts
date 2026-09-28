import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withCmdbSnapshotHash, type CmdbSyncSnapshot } from '../domain/CmdbSyncSnapshot';
import type { SyncPayload } from '../domain/sync';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

const { applySyncPayload, hasMeaningfulCloudSyncData } = await import('./syncPayload');
const { mergeSyncPayloads } = await import('../domain/syncMerge');

function snapshot(records: Array<Record<string, unknown>>): CmdbSyncSnapshot {
  return withCmdbSnapshotHash({
    schema_version: 1,
    project_sync_id: 'project-1',
    generated_at: '2026-09-21T10:00:00Z',
    collections: { assets: records },
    tombstones: [],
  });
}

function payload(cmdbSnapshot?: CmdbSyncSnapshot): SyncPayload {
  return {
    hosts: [],
    keys: [],
    snippets: [],
    customGroups: [],
    syncedAt: 1,
    ...(cmdbSnapshot ? { cmdbSnapshot } : {}),
  };
}

describe('Cmdb SyncPayload integration', () => {
  it('Cmdb 快照本身属于有效云同步数据', () => {
    assert.equal(hasMeaningfulCloudSyncData(payload(snapshot([]))), true);
  });

  it('旧版智能合并保留不同设备新增的 Cmdb 记录', () => {
    const merged = mergeSyncPayloads(
      null,
      payload(snapshot([{ sync_id: 'asset-a', revision: 1 }])),
      payload(snapshot([{ sync_id: 'asset-b', revision: 1 }])),
    );
    assert.deepEqual(
      merged.payload.cmdbSnapshot?.collections.assets.map((item) => item.sync_id),
      ['asset-a', 'asset-b'],
    );
  });

  it('下载载荷在导入保险库后应用 Cmdb，且失败会向上抛出', async () => {
    const events: string[] = [];
    await assert.rejects(
      applySyncPayload(payload(snapshot([])), {
        importVaultData: () => { events.push('vault'); },
      }, {
        applyCmdbSnapshot: () => {
          events.push('cmdb');
          throw new Error('Cmdb 应用失败');
        },
      }),
      /Cmdb 应用失败/,
    );
    assert.deepEqual(events, ['vault', 'cmdb']);
  });
});
