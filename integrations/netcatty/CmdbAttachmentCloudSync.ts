const ENCRYPTION_VERSION = 1;
const CONTENT_KEY_BYTES = 32;
const IV_BYTES = 12;

type AttachmentMetadata = {
  cloud_object_id: string;
  encryption_version: number;
  wrapped_key: string;
  wrapped_key_iv: string;
  data_iv: string;
  s3_key?: string;
  s3_status?: string;
};

type CloudState = {
  securityState?: string;
  unlockedKey?: { derivedKey: CryptoKey } | null;
  providers?: Record<string, { status?: string; config?: S3Config }>;
  /** 当前 Cmdb 项目的本地数据库 ID；项目稳定标识必须从 /api/cmdb/projects 读取。 */
  projectId?: number | string;
};

type CmdbProject = {
  id: number;
  sync_id?: string;
  deleted_at?: string;
};

export type CmdbAttachmentCloudBridge = {
  cmdbSyncAttachments: (payload: unknown) => Promise<unknown>;
  cmdbDownloadAttachment?: (payload: unknown) => Promise<unknown>;
};

type RequestInput = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 附件状态是补传内部状态，不应再次排队 Cmdb 云同步。 */
  suppressCloudSync?: boolean;
};

type CmdbNativeRequester = (input: RequestInput) => Promise<unknown>;

type PendingAttachment = AttachmentMetadata & {
  id: number;
  work_order_id: number;
  local_exists: boolean;
  local_path?: string;
};

function responseList<T>(response: unknown): T[] {
  if (!response || typeof response !== 'object') return [];
  const list = (response as { list?: unknown }).list;
  return Array.isArray(list) ? list as T[] : [];
}

export type AttachmentSyncFailure = {
  attachmentId?: number;
  code: string;
  message: string;
  statusUpdateError?: string;
};

export type AttachmentSyncResult = {
  available: boolean;
  uploaded: number;
  failed: number;
  failures: AttachmentSyncFailure[];
  reason?: 'vault-locked' | 's3-unavailable' | 'project-unavailable' | 'pending-list-failed';
};

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  prefix?: string;
  forcePathStyle?: boolean;
  allowInsecure?: boolean;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  if (typeof value !== 'string' || !value) throw new Error('附件加密元数据无效');
  if (typeof atob === 'function') {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function resolveCmdbAttachmentS3Config(state: CloudState):
  | { available: true; config: S3Config; derivedKey: CryptoKey }
  | { available: false; reason: 'vault-locked' | 's3-unavailable' } {
  if (state?.securityState !== 'UNLOCKED' || !state?.unlockedKey?.derivedKey) {
    return { available: false, reason: 'vault-locked' };
  }
  const provider = state.providers?.s3;
  if (provider?.status !== 'connected' || !provider.config?.endpoint || !provider.config?.bucket) {
    return { available: false, reason: 's3-unavailable' };
  }
  return {
    available: true,
    config: provider.config,
    derivedKey: state.unlockedKey.derivedKey,
  };
}

export async function createAttachmentKeyEnvelope(derivedKey: CryptoKey) {
  const contentKeyBytes = randomBytes(CONTENT_KEY_BYTES);
  const wrappedKeyIV = randomBytes(IV_BYTES);
  const dataIV = randomBytes(IV_BYTES);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: wrappedKeyIV },
    derivedKey,
    contentKeyBytes,
  ));
  return {
    contentKey: toBase64(contentKeyBytes),
    contentKeyBytes,
    metadata: {
      encryption_version: ENCRYPTION_VERSION,
      wrapped_key: toBase64(wrapped),
      wrapped_key_iv: toBase64(wrappedKeyIV),
      data_iv: toBase64(dataIV),
    },
  };
}

export async function unwrapAttachmentKey(derivedKey: CryptoKey, metadata: AttachmentMetadata): Promise<Uint8Array> {
  if (Number(metadata?.encryption_version) !== ENCRYPTION_VERSION) throw new Error('不支持的附件加密版本');
  const recovered = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(metadata.wrapped_key_iv) },
    derivedKey,
    fromBase64(metadata.wrapped_key),
  );
  const contentKey = new Uint8Array(recovered);
  if (contentKey.length !== CONTENT_KEY_BYTES) throw new Error('附件内容密钥长度无效');
  return contentKey;
}

export async function resolveCmdbAttachmentProject(
  request: CmdbNativeRequester,
  projectId?: number | string,
): Promise<CmdbProject> {
  const response = await request({ path: '/api/cmdb/projects' });
  const projects = responseList<CmdbProject>(response);
  const requestedID = Number(projectId);
  const activeProjects = projects.filter((item: CmdbProject) => (
    item
    && !item.deleted_at
    && Number.isSafeInteger(Number(item.id))
    && Number(item.id) > 0
  ));
  const project = Number.isSafeInteger(requestedID) && requestedID > 0
    ? activeProjects.find((item: CmdbProject) => Number(item.id) === requestedID)
    : activeProjects.length === 1 ? activeProjects[0] : undefined;
  if (!project) {
    const reason = Number.isSafeInteger(requestedID) && requestedID > 0
      ? `项目 ${requestedID} 不在 /api/cmdb/projects 返回的当前项目列表中`
      : `无法确定当前 Cmdb 项目：返回 ${activeProjects.length} 个项目，请提供 projectId`;
    throw new Error(reason);
  }
  const syncID = String(project.sync_id || '').trim();
  if (!syncID) throw new Error(`项目 ${project.id} 缺少 sync_id`);
  return { ...project, id: Number(project.id), sync_id: syncID };
}

export function createCmdbAttachmentCloudSync({
  getState,
  request,
  bridge,
  uuid = () => crypto.randomUUID(),
}: {
  getState: () => CloudState;
  request: CmdbNativeRequester;
  bridge: CmdbAttachmentCloudBridge;
  uuid?: () => string;
}) {
  let running: Promise<AttachmentSyncResult> | undefined;

  const projectRequest = (projectId: number): RequestInput => ({
    headers: { 'X-Cmdb-Project': String(projectId) },
  });

  const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

  const projectFailure = (code: string, message: string, attachmentId?: number): AttachmentSyncFailure => ({
    attachmentId,
    code,
    message,
  });

  async function writeFailureStatus(
    project: CmdbProject,
    attachment: PendingAttachment,
    state: Record<string, unknown>,
    failure: AttachmentSyncFailure,
  ): Promise<AttachmentSyncFailure> {
    try {
      await request({
        path: `/api/cmdb/work-orders/${attachment.work_order_id}/attachments/${attachment.id}/s3-status`,
        method: 'PUT',
        ...projectRequest(project.id),
        suppressCloudSync: true,
        body: JSON.stringify({ ...state, s3_status: 'failed' }),
      });
    } catch (error) {
      return { ...failure, statusUpdateError: errorMessage(error) };
    }
    return failure;
  }

  const syncPending = () => {
    if (running) return running;
    running = (async () => {
      const resolved = resolveCmdbAttachmentS3Config(getState());
      if (!resolved.available) return { available: false, uploaded: 0, failed: 0, failures: [], reason: resolved.reason };
      let project: CmdbProject;
      try {
        project = await resolveCmdbAttachmentProject(request, getState().projectId);
      } catch (error) {
        const message = errorMessage(error);
        const code = message.includes('sync_id') ? 'project-sync-id-missing' : 'project-unavailable';
        return {
          available: true,
          uploaded: 0,
          failed: 1,
          failures: [projectFailure(code, message)],
          reason: 'project-unavailable',
        };
      }
      let pending: PendingAttachment[];
      try {
        pending = responseList<PendingAttachment>(await request({
          path: '/api/cmdb/attachments/pending',
          ...projectRequest(project.id),
        }));
      } catch (error) {
        return {
          available: true,
          uploaded: 0,
          failed: 1,
          failures: [projectFailure('pending-list-failed', `读取待补传附件失败：${errorMessage(error)}`)],
          reason: 'pending-list-failed',
        };
      }
      let uploaded = 0;
      let failed = 0;
      const failures: AttachmentSyncFailure[] = [];
      for (const attachment of pending) {
        const attachmentID = Number(attachment?.id);
        const state: Record<string, unknown> = {
          s3_status: 'pending',
          s3_key: String(attachment?.s3_key || ''),
          cloud_object_id: String(attachment?.cloud_object_id || ''),
          encryption_version: Number(attachment?.encryption_version || 0),
          wrapped_key: String(attachment?.wrapped_key || ''),
          wrapped_key_iv: String(attachment?.wrapped_key_iv || ''),
          data_iv: String(attachment?.data_iv || ''),
        };
        if (!attachment.local_exists || !attachment.local_path) {
          failed += 1;
          failures.push(await writeFailureStatus(project, attachment, state, projectFailure('local-file-missing', '附件本地文件不存在或路径为空', attachmentID)));
          continue;
        }
        let envelope: Awaited<ReturnType<typeof createAttachmentKeyEnvelope>> | undefined;
        let failureState = state;
        try {
          envelope = attachment.encryption_version ? {
            contentKey: '',
            contentKeyBytes: await unwrapAttachmentKey(resolved.derivedKey, attachment),
            metadata: {
              encryption_version: attachment.encryption_version,
              wrapped_key: attachment.wrapped_key,
              wrapped_key_iv: attachment.wrapped_key_iv,
              data_iv: attachment.data_iv,
            },
          } : await createAttachmentKeyEnvelope(resolved.derivedKey);
          const cloudObjectId = attachment.cloud_object_id || uuid();
          const subKey = `attachments/${project.sync_id}/${cloudObjectId}.nca`;
          const uploadState = {
            s3_status: 'pending',
            s3_key: subKey,
            cloud_object_id: cloudObjectId,
            ...envelope.metadata,
          };
          failureState = uploadState;
          await request({
            path: `/api/cmdb/work-orders/${attachment.work_order_id}/attachments/${attachment.id}/s3-status`,
            method: 'PUT',
            ...projectRequest(project.id),
            suppressCloudSync: true,
            body: JSON.stringify(uploadState),
          });
          await bridge.cmdbSyncAttachments({
            projectId: project.id,
            workOrderId: attachment.work_order_id,
            attachmentId: attachment.id,
            config: resolved.config,
            subKey,
            contentKey: envelope.contentKey || toBase64(envelope.contentKeyBytes),
            dataIv: envelope.metadata.data_iv,
          });
          await request({
            path: `/api/cmdb/work-orders/${attachment.work_order_id}/attachments/${attachment.id}/s3-status`,
            method: 'PUT',
            ...projectRequest(project.id),
            suppressCloudSync: true,
            body: JSON.stringify({ ...uploadState, s3_status: 'synced' }),
          });
          uploaded += 1;
        } catch (error) {
          failed += 1;
          const failure = projectFailure(
            envelope ? 's3-upload-failed' : 'attachment-encryption-failed',
            envelope ? `附件补传失败：${errorMessage(error)}` : `附件加密元数据处理失败：${errorMessage(error)}`,
            attachmentID,
          );
          failures.push(await writeFailureStatus(project, attachment, failureState, failure));
        } finally {
          envelope?.contentKeyBytes.fill(0);
        }
      }
      return { available: true, uploaded, failed, failures };
    })().finally(() => { running = undefined; });
    return running;
  };
  return { syncPending };
}

export async function downloadCmdbAttachment({
  getState,
  request,
  bridge,
  attachment,
}: {
  getState: () => CloudState;
  request: CmdbNativeRequester;
  bridge: Pick<CmdbAttachmentCloudBridge, 'cmdbDownloadAttachment'>;
  attachment: AttachmentMetadata & {
    id: number;
    project_id?: number;
    work_order_id: number;
    s3_key?: string;
  };
}) {
  if (typeof bridge.cmdbDownloadAttachment !== 'function') throw new Error('Netcatty 附件下载通道不可用');
  const resolved = resolveCmdbAttachmentS3Config(getState());
  if (!resolved.available) {
    throw new Error(resolved.reason === 'vault-locked' ? '请先解锁 Netcatty 密钥库' : 'Netcatty S3 尚未连接');
  }
  const project = await resolveCmdbAttachmentProject(request, attachment.project_id ?? getState().projectId);
  const contentKey = await unwrapAttachmentKey(resolved.derivedKey, attachment);
  const subKey = String(attachment.s3_key || '').trim();
  if (!subKey) throw new Error('附件缺少云端对象标识');
  try {
    return await bridge.cmdbDownloadAttachment({
      projectId: project.id,
      workOrderId: attachment.work_order_id,
      attachmentId: attachment.id,
      config: resolved.config,
      subKey,
      contentKey: toBase64(contentKey),
      dataIv: attachment.data_iv,
    });
  } finally {
    contentKey.fill(0);
  }
}
