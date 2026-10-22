import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAttachmentKeyEnvelope,
  createCmdbAttachmentCloudSync,
  resolveCmdbAttachmentS3Config,
  unwrapAttachmentKey,
} from './CmdbAttachmentCloudSync.ts';

const keyBytes = new Uint8Array(32).fill(7);
const unlockedKey = { derivedKey: await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']) };

const connectedState = () => ({
  securityState: 'UNLOCKED',
  unlockedKey,
  projectId: 1,
  providers: {
    s3: {
      status: 'connected',
      config: {
        endpoint: 'https://s3.example',
        region: 'cn',
        bucket: 'cmdb',
        accessKeyId: 'a',
        secretAccessKey: 'b',
      },
    },
  },
});

describe('CmdbAttachmentCloudSync', () => {
  it('does not expose attachment sync when Netcatty is locked or S3 is disconnected', () => {
    assert.deepEqual(resolveCmdbAttachmentS3Config({ securityState: 'LOCKED', unlockedKey: null, providers: {} }), {
      available: false,
      reason: 'vault-locked',
    });
    assert.deepEqual(resolveCmdbAttachmentS3Config({ securityState: 'UNLOCKED', unlockedKey, providers: { s3: { status: 'disconnected' } } }), {
      available: false,
      reason: 's3-unavailable',
    });
  });

  it('wraps a random content key and recovers it only with the unlocked key', async () => {
    const envelope = await createAttachmentKeyEnvelope(unlockedKey.derivedKey);
    assert.equal(envelope.metadata.encryption_version, 1);
    assert.equal(typeof envelope.metadata.wrapped_key, 'string');
    assert.equal(typeof envelope.metadata.wrapped_key_iv, 'string');
    assert.equal(typeof envelope.metadata.data_iv, 'string');
    assert.equal(JSON.stringify(envelope.metadata).includes(envelope.contentKey), false);
    const recovered = await unwrapAttachmentKey(unlockedKey.derivedKey, envelope.metadata);
    assert.deepEqual([...recovered], [...envelope.contentKeyBytes]);
    await assert.rejects(
      unwrapAttachmentKey(await crypto.subtle.importKey('raw', new Uint8Array(32).fill(8), 'AES-GCM', false, ['decrypt']), envelope.metadata),
    );
  });

  it('serializes one pending attachment, uploads it once, then marks it synced', async () => {
    const calls: Array<{ path: string; method?: string; headers?: Record<string, string>; suppressCloudSync?: boolean; body?: string }> = [];
    let uploaded = 0;
    let attachmentStatus = 'pending';
    const request = async (input: { path: string; method?: string; headers?: Record<string, string>; suppressCloudSync?: boolean; body?: string }) => {
      calls.push(input);
      if (input.path === '/api/cmdb/projects') return { list: [{ id: 1, sync_id: 'project-1' }] };
      if (input.path === '/api/cmdb/attachments/pending') return attachmentStatus === 'synced'
        ? { list: [] }
        : { list: [{ id: 9, project_id: 1, work_order_id: 4, file_name: '现场.txt', local_exists: true, local_path: 'C:/attachments/file.bin', s3_status: 'pending' }] };
      if (input.path.endsWith('/s3-status')) attachmentStatus = JSON.parse(input.body || '{}').s3_status;
      return { ok: true };
    };
    const sync = createCmdbAttachmentCloudSync({
      getState: () => ({ securityState: 'UNLOCKED', unlockedKey, providers: { s3: { status: 'connected', config: { endpoint: 'https://s3.example', region: 'cn', bucket: 'cmdb', accessKeyId: 'a', secretAccessKey: 'b', prefix: 'court' } } } }),
      request,
      bridge: {
        cmdbSyncAttachments: async (payload: { subKey: string }) => { uploaded += 1; assert.match(payload.subKey, /^attachments\/project-1\//); return { ok: true }; },
      },
      uuid: () => 'cloud-object-1',
    });
    const result = await sync.syncPending();
    assert.equal(result.uploaded, 1);
    assert.equal(uploaded, 1);
    assert.equal(calls.filter((item) => item.path.endsWith('/s3-status')).length, 2);
    const syncedBody = JSON.parse(calls.at(-1)?.body || '{}');
    assert.equal(syncedBody.s3_status, 'synced');
    assert.equal(syncedBody.cloud_object_id, 'cloud-object-1');
    assert.equal(calls.filter((item) => item.path.endsWith('/s3-status')).every((item) => item.suppressCloudSync === true), true);
    const second = await sync.syncPending();
    assert.equal(second.uploaded, 0);
    assert.equal(uploaded, 1);
  });

  it('reports a missing project sync_id without requesting pending attachments', async () => {
    const paths: string[] = [];
    const sync = createCmdbAttachmentCloudSync({
      getState: connectedState,
      request: async ({ path }) => {
        paths.push(path);
        if (path === '/api/cmdb/projects') return { list: [{ id: 1, sync_id: '' }] };
        throw new Error(`unexpected request: ${path}`);
      },
      bridge: { cmdbSyncAttachments: async () => ({ ok: true }) },
    });

    const result = await sync.syncPending();
    assert.equal(result.failed, 1);
    assert.equal(result.reason, 'project-unavailable');
    assert.equal(result.failures[0]?.code, 'project-sync-id-missing');
    assert.deepEqual(paths, ['/api/cmdb/projects']);
  });

  it('marks an attachment with a missing local file as failed', async () => {
    const statuses: Array<{
      input: { path: string; headers?: Record<string, string>; suppressCloudSync?: boolean };
      body: Record<string, unknown>;
    }> = [];
    let bridgeCalls = 0;
    const sync = createCmdbAttachmentCloudSync({
      getState: connectedState,
      request: async (input) => {
        if (input.path === '/api/cmdb/projects') return { list: [{ id: 1, sync_id: 'project-1' }] };
        if (input.path === '/api/cmdb/attachments/pending') return {
          list: [{ id: 12, work_order_id: 4, local_exists: false, local_path: '' }],
        };
        if (input.path.endsWith('/s3-status')) statuses.push({ input, body: JSON.parse(input.body || '{}') });
        return { ok: true };
      },
      bridge: { cmdbSyncAttachments: async () => { bridgeCalls += 1; } },
    });

    const result = await sync.syncPending();
    assert.equal(result.failed, 1);
    assert.equal(result.failures[0]?.code, 'local-file-missing');
    assert.equal(bridgeCalls, 0);
    assert.equal(statuses.at(-1)?.body.s3_status, 'failed');
    assert.equal(statuses.at(-1)?.input.headers?.['X-Cmdb-Project'], '1');
    assert.equal(statuses.at(-1)?.input.suppressCloudSync, true);
  });

  it('records bridge upload failures and exposes status update failures', async () => {
    let statusWrites = 0;
    const failedStatusBodies: Record<string, unknown>[] = [];
    const sync = createCmdbAttachmentCloudSync({
      getState: connectedState,
      request: async (input) => {
        if (input.path === '/api/cmdb/projects') return { list: [{ id: 1, sync_id: 'project-1' }] };
        if (input.path === '/api/cmdb/attachments/pending') return {
          list: [{ id: 13, work_order_id: 4, local_exists: true, local_path: 'C:/attachments/file.bin' }],
        };
        if (input.path.endsWith('/s3-status')) {
          statusWrites += 1;
          const body = JSON.parse(input.body || '{}');
          if (body.s3_status === 'failed') {
            failedStatusBodies.push(body);
            throw new Error('status database unavailable');
          }
        }
        return { ok: true };
      },
      bridge: { cmdbSyncAttachments: async () => { throw new Error('S3 upload rejected'); } },
      uuid: () => 'cloud-object-failed',
    });

    const result = await sync.syncPending();
    assert.equal(result.failed, 1);
    assert.equal(result.failures[0]?.code, 's3-upload-failed');
    assert.equal(result.failures[0]?.attachmentId, 13);
    assert.equal(result.failures[0]?.statusUpdateError, 'status database unavailable');
    assert.equal(statusWrites, 2);
    assert.equal(failedStatusBodies[0]?.s3_status, 'failed');
    assert.equal(failedStatusBodies[0]?.cloud_object_id, 'cloud-object-failed');
  });

  it('reports project list request failures', async () => {
    const sync = createCmdbAttachmentCloudSync({
      getState: connectedState,
      request: async ({ path }) => {
        if (path === '/api/cmdb/projects') throw new Error('project service unavailable');
        throw new Error(`unexpected request: ${path}`);
      },
      bridge: { cmdbSyncAttachments: async () => ({ ok: true }) },
    });

    const result = await sync.syncPending();
    assert.equal(result.reason, 'project-unavailable');
    assert.equal(result.failures[0]?.code, 'project-unavailable');
    assert.match(result.failures[0]?.message || '', /project service unavailable/);
  });

  it('reuses the same promise for concurrent sync calls', async () => {
    let releasePending!: () => void;
    const pendingGate = new Promise<void>((resolve) => { releasePending = resolve; });
    let pendingRequests = 0;
    const sync = createCmdbAttachmentCloudSync({
      getState: connectedState,
      request: async ({ path }) => {
        if (path === '/api/cmdb/projects') return { list: [{ id: 1, sync_id: 'project-1' }] };
        if (path === '/api/cmdb/attachments/pending') {
          pendingRequests += 1;
          await pendingGate;
          return { list: [] };
        }
        return { ok: true };
      },
      bridge: { cmdbSyncAttachments: async () => ({ ok: true }) },
    });

    const first = sync.syncPending();
    const second = sync.syncPending();
    assert.strictEqual(first, second);
    releasePending();
    await Promise.all([first, second]);
    assert.equal(pendingRequests, 1);
  });
});
