import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export interface CmdbSyncTombstone {
  entity_type: string;
  sync_id: string;
  revision: number;
  deleted_at: string;
}

export interface CmdbSyncSnapshot {
  schema_version: 1;
  project_sync_id: string;
  generated_at: string;
  base_hash: string;
  collections: Record<string, Array<Record<string, unknown>>>;
  tombstones: CmdbSyncTombstone[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const child = (value as Record<string, unknown>)[key];
        if (child !== undefined) result[key] = stableValue(child);
        return result;
      }, {});
  }
  return value;
}

function fingerprint(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function recordRevision(record: Record<string, unknown> | undefined): number {
  const revision = Number(record?.revision);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

function recordsBySyncID(
  records: Array<Record<string, unknown>> | undefined,
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const record of records ?? []) {
    const syncID = typeof record.sync_id === 'string' ? record.sync_id : '';
    if (!syncID || recordRevision(record) < 1) {
      throw new Error('Cmdb 同步快照包含无效的稳定标识或修订号');
    }
    result.set(syncID, record);
  }
  return result;
}

function tombstoneKey(item: Pick<CmdbSyncTombstone, 'entity_type' | 'sync_id'>): string {
  return `${item.entity_type}\0${item.sync_id}`;
}

function mergeTombstones(
  local: CmdbSyncTombstone[],
  remote: CmdbSyncTombstone[],
): CmdbSyncTombstone[] {
  const merged = new Map<string, CmdbSyncTombstone>();
  for (const item of [...local, ...remote]) {
    if (!item.entity_type || !item.sync_id || !Number.isSafeInteger(item.revision) || item.revision < 1) {
      throw new Error(`Cmdb 同步快照包含无效墓碑: ${item.entity_type}/${item.sync_id}`);
    }
    const key = tombstoneKey(item);
    const current = merged.get(key);
    if (
      !current
      || item.revision > current.revision
      || (item.revision === current.revision && item.deleted_at > current.deleted_at)
    ) {
      merged.set(key, item);
    }
  }
  return [...merged.values()].sort((left, right) => (
    left.entity_type.localeCompare(right.entity_type)
    || left.sync_id.localeCompare(right.sync_id)
  ));
}

function chooseRecord(
  collection: string,
  syncID: string,
  base: Record<string, unknown> | undefined,
  local: Record<string, unknown> | undefined,
  remote: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!local) return remote;
  if (!remote) return local;

  const localRevision = recordRevision(local);
  const remoteRevision = recordRevision(remote);
  if (localRevision > remoteRevision) return local;
  if (remoteRevision > localRevision) return remote;
  if (fingerprint(local) === fingerprint(remote)) return local;

  if (base) {
    const baseFingerprint = fingerprint(base);
    if (fingerprint(local) === baseFingerprint) return remote;
    if (fingerprint(remote) === baseFingerprint) return local;
  }
  throw new Error(`Cmdb 同步冲突: ${collection}/${syncID} 同一修订号内容不一致`);
}

function assertCompatibleSnapshots(
  base: CmdbSyncSnapshot | undefined,
  local: CmdbSyncSnapshot,
  remote: CmdbSyncSnapshot,
): void {
  for (const snapshot of [base, local, remote]) {
    if (!snapshot) continue;
    if (snapshot.schema_version !== 1) {
      throw new Error(`不支持的 Cmdb 同步快照版本: ${snapshot.schema_version}`);
    }
    if (!snapshot.project_sync_id) throw new Error('Cmdb 同步快照缺少项目稳定标识');
  }
  if (
    local.project_sync_id !== remote.project_sync_id
    || (base && base.project_sync_id !== local.project_sync_id)
  ) {
    throw new Error('Cmdb 同步快照不属于同一项目');
  }
}

export function withCmdbSnapshotHash(
  snapshot: Omit<CmdbSyncSnapshot, 'base_hash'> & { base_hash?: string },
): CmdbSyncSnapshot {
  const collectionNames = Object.keys(snapshot.collections).sort();
  const collections = collectionNames.reduce<CmdbSyncSnapshot['collections']>((result, name) => {
    result[name] = [...(snapshot.collections[name] ?? [])]
      .sort((left, right) => String(left.sync_id ?? '').localeCompare(String(right.sync_id ?? '')))
      .map((record) => stableValue(record) as Record<string, unknown>);
    return result;
  }, {});
  const tombstones = [...snapshot.tombstones].sort((left, right) => (
    left.entity_type.localeCompare(right.entity_type)
    || left.sync_id.localeCompare(right.sync_id)
  ));
  const canonical = {
    schema_version: snapshot.schema_version,
    project_sync_id: snapshot.project_sync_id,
    collections: collectionNames.map((name) => ({ name, data: collections[name] })),
    tombstones,
  };
  return {
    ...snapshot,
    collections,
    tombstones,
    base_hash: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(canonical)))),
  };
}

export function mergeCmdbSnapshots(
  base: CmdbSyncSnapshot | undefined,
  local: CmdbSyncSnapshot,
  remote: CmdbSyncSnapshot,
): CmdbSyncSnapshot {
  assertCompatibleSnapshots(base, local, remote);
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones);
  const tombstoneByKey = new Map(tombstones.map((item) => [tombstoneKey(item), item]));
  const collectionNames = [...new Set([
    ...Object.keys(base?.collections ?? {}),
    ...Object.keys(local.collections),
    ...Object.keys(remote.collections),
  ])].sort();
  const collections: CmdbSyncSnapshot['collections'] = {};

  for (const name of collectionNames) {
    const baseRecords = recordsBySyncID(base?.collections[name]);
    const localRecords = recordsBySyncID(local.collections[name]);
    const remoteRecords = recordsBySyncID(remote.collections[name]);
    const syncIDs = [...new Set([...localRecords.keys(), ...remoteRecords.keys()])].sort();
    const records: Array<Record<string, unknown>> = [];
    for (const syncID of syncIDs) {
      const record = chooseRecord(
        name,
        syncID,
        baseRecords.get(syncID),
        localRecords.get(syncID),
        remoteRecords.get(syncID),
      );
      if (!record) continue;
      const tombstone = tombstoneByKey.get(`${name}\0${syncID}`);
      if (tombstone && tombstone.revision >= recordRevision(record)) continue;
      records.push(record);
    }
    collections[name] = records;
  }

  return withCmdbSnapshotHash({
    schema_version: 1,
    project_sync_id: local.project_sync_id,
    generated_at: new Date().toISOString(),
    collections,
    tombstones,
  });
}

export function mergeOptionalCmdbSnapshots(
  base: CmdbSyncSnapshot | undefined,
  local: CmdbSyncSnapshot | undefined,
  remote: CmdbSyncSnapshot | undefined,
): CmdbSyncSnapshot | undefined {
  if (local && remote) return mergeCmdbSnapshots(base, local, remote);
  return local ?? remote ?? base;
}
