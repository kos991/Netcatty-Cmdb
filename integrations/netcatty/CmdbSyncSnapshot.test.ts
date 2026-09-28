import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeCmdbSnapshots,
  withCmdbSnapshotHash,
  type CmdbSyncSnapshot,
} from './CmdbSyncSnapshot';

function snapshot(
  records: Array<Record<string, unknown>>,
  tombstones: CmdbSyncSnapshot['tombstones'] = [],
): CmdbSyncSnapshot {
  return withCmdbSnapshotHash({
    schema_version: 1,
    project_sync_id: 'project-1',
    generated_at: '2026-09-21T10:00:00Z',
    base_hash: '',
    collections: { assets: records },
    tombstones,
  });
}

describe('CmdbSyncSnapshot', () => {
  it('合并不同设备新增的记录并生成稳定摘要', () => {
    const local = snapshot([{ sync_id: 'asset-a', revision: 1, asset_code: 'PC-A' }]);
    const remote = snapshot([{ sync_id: 'asset-b', revision: 1, asset_code: 'PC-B' }]);
    const merged = mergeCmdbSnapshots(undefined, local, remote);
    assert.deepEqual(
      merged.collections.assets.map((item) => item.sync_id),
      ['asset-a', 'asset-b'],
    );
    assert.equal(merged.base_hash.length, 64);
    assert.equal(withCmdbSnapshotHash({ ...merged, base_hash: '' }).base_hash, merged.base_hash);
  });

  it('墓碑阻止旧记录复活', () => {
    const local = snapshot([], [{ entity_type: 'assets', sync_id: 'asset-a', revision: 2, deleted_at: '2026-09-21T10:01:00Z' }]);
    const remote = snapshot([{ sync_id: 'asset-a', revision: 1, asset_code: 'PC-A' }]);
    const merged = mergeCmdbSnapshots(undefined, local, remote);
    assert.deepEqual(merged.collections.assets, []);
    assert.equal(merged.tombstones[0]?.revision, 2);
  });

  it('拒绝同一修订号的并发分叉', () => {
    const base = snapshot([{ sync_id: 'asset-a', revision: 1, asset_code: 'PC-OLD' }]);
    const local = snapshot([{ sync_id: 'asset-a', revision: 2, asset_code: 'PC-LOCAL' }]);
    const remote = snapshot([{ sync_id: 'asset-a', revision: 2, asset_code: 'PC-REMOTE' }]);
    assert.throws(() => mergeCmdbSnapshots(base, local, remote), /Cmdb 同步冲突.*assets\/asset-a/);
  });
});
