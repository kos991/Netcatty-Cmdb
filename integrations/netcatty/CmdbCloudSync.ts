import type { CmdbSyncSnapshot } from './CmdbSyncSnapshot';

export const CMDB_CLOUD_SYNC_STORAGE_KEY = 'netcatty.cmdb.cloudSync.v1';
export const CMDB_CLOUD_SYNC_REQUEST_EVENT = 'netcatty:cmdb-cloud-sync-request';
export const CMDB_CLOUD_SYNC_REQUEST_KEY = 'netcatty.cmdb.cloudSync.request';
export const CMDB_CLOUD_SYNC_SETTINGS_EVENT = 'netcatty:cmdb-cloud-sync-settings';

export interface CmdbCloudSyncSettings {
  enabled: boolean;
  lastStatus?: 'success' | 'error';
  lastSyncedAt?: string;
  lastError?: string;
}

export interface CmdbNativeRequest {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  suppressCloudSync?: boolean;
}

export type CmdbNativeRequester = (
  request: CmdbNativeRequest,
) => Promise<unknown>;

export type CmdbAttachmentCloudSyncHook = () => Promise<unknown> | unknown;

let attachmentCloudSyncHook: CmdbAttachmentCloudSyncHook | undefined;

/**
 * 注册附件补传钩子。钩子复用现有 Cmdb 云同步请求事件，不创建第二套定时器。
 * 返回值用于卸载，避免设置页或测试重复注册。
 */
export function registerCmdbAttachmentCloudSyncHook(
  hook: CmdbAttachmentCloudSyncHook,
): () => void {
  attachmentCloudSyncHook = hook;
  return () => {
    if (attachmentCloudSyncHook === hook) attachmentCloudSyncHook = undefined;
  };
}

export async function runCmdbAttachmentCloudSyncHook(): Promise<unknown> {
  return attachmentCloudSyncHook ? attachmentCloudSyncHook() : undefined;
}

const defaults: CmdbCloudSyncSettings = {
  enabled: false,
};

let scheduledSync: ReturnType<typeof setTimeout> | undefined;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readCmdbCloudSyncSettings(): CmdbCloudSyncSettings {
  try {
    const raw = storage()?.getItem(CMDB_CLOUD_SYNC_STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<CmdbCloudSyncSettings>;
    const settings: CmdbCloudSyncSettings = {
      enabled: parsed.enabled === true,
      lastStatus: parsed.lastStatus,
      lastSyncedAt: parsed.lastSyncedAt,
      lastError: parsed.lastError,
    };
    // Preserve opt-in and host status, retiring the old partial-scope switches.
    if ('includeContacts' in parsed || 'includeHistory' in parsed) {
      storage()?.setItem(CMDB_CLOUD_SYNC_STORAGE_KEY, JSON.stringify(settings));
    }
    return settings;
  } catch {
    return { ...defaults };
  }
}

export function writeCmdbCloudSyncSettings(
  changes: Partial<CmdbCloudSyncSettings>,
): CmdbCloudSyncSettings {
  const next = { ...readCmdbCloudSyncSettings(), ...changes };
  storage()?.setItem(CMDB_CLOUD_SYNC_STORAGE_KEY, JSON.stringify(next));
  if (typeof globalThis.window?.dispatchEvent === 'function') {
    globalThis.window.dispatchEvent(new CustomEvent(CMDB_CLOUD_SYNC_SETTINGS_EVENT, { detail: next }));
  }
  return next;
}

export function requestCmdbCloudSync(): void {
  globalThis.window?.dispatchEvent(new CustomEvent(CMDB_CLOUD_SYNC_REQUEST_EVENT));
  globalThis.window?.netcatty?.notifySettingsChanged?.({
    key: CMDB_CLOUD_SYNC_REQUEST_KEY,
    value: Date.now(),
  });
}

export function scheduleCmdbCloudSync(delay = 800): void {
  if (!readCmdbCloudSyncSettings().enabled || typeof globalThis.window?.dispatchEvent !== 'function') return;
  if (scheduledSync) clearTimeout(scheduledSync);
  scheduledSync = setTimeout(() => {
    scheduledSync = undefined;
    globalThis.window?.dispatchEvent(new CustomEvent(CMDB_CLOUD_SYNC_REQUEST_EVENT));
  }, delay);
}

async function nativeRequest(request: CmdbNativeRequest): Promise<unknown> {
  const bridge = globalThis.window?.netcatty;
  if (typeof bridge?.cmdbRequest !== 'function') {
    throw new Error('Cmdb 原生请求通道不可用');
  }
  return bridge.cmdbRequest(request);
}

export async function downloadCmdbAttachmentFromCloud(attachment: Record<string, unknown>): Promise<unknown> {
  const bridge = globalThis.window?.netcatty;
  if (typeof bridge?.cmdbDownloadAttachment !== 'function') {
    throw new Error('Netcatty 附件下载通道不可用');
  }
  const [{ getCloudSyncManager }, { downloadCmdbAttachment }] = await Promise.all([
    import('../infrastructure/services/CloudSyncManager'),
    import('./CmdbAttachmentCloudSync'),
  ]);
  const manager = getCloudSyncManager();
  return downloadCmdbAttachment({
    getState: () => manager.getState(),
    request: nativeRequest,
    bridge,
    attachment: attachment as never,
  });
}

export async function collectCmdbCloudSnapshot(
  request: CmdbNativeRequester = nativeRequest,
): Promise<CmdbSyncSnapshot | undefined> {
  const settings = readCmdbCloudSyncSettings();
  if (!settings.enabled) return undefined;
  const result = await request({
    path: '/api/cmdb/sync/export',
    method: 'POST',
    body: JSON.stringify({
      include_contacts: true,
      include_history: true,
    }),
  });
  return result as CmdbSyncSnapshot;
}

export async function applyCmdbCloudSnapshot(
  snapshot: CmdbSyncSnapshot,
  request: CmdbNativeRequester = nativeRequest,
): Promise<void> {
  if (!readCmdbCloudSyncSettings().enabled) return;
  try {
    const preflight = await request({
      path: '/api/cmdb/sync/preflight',
      method: 'POST',
      body: JSON.stringify(snapshot),
    }) as { conflicts?: number; unresolved_references?: number };
    const conflicts = Number(preflight?.conflicts) || 0;
    const unresolved = Number(preflight?.unresolved_references) || 0;
    if (conflicts > 0 || unresolved > 0) {
      throw new Error(`Cmdb 同步预检未通过：${conflicts} 个冲突，${unresolved} 个未解析引用`);
    }
    await request({
      path: '/api/cmdb/sync/apply',
      method: 'POST',
      body: JSON.stringify(snapshot),
    });
    writeCmdbCloudSyncSettings({
      lastStatus: 'success',
      lastSyncedAt: new Date().toISOString(),
      lastError: undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeCmdbCloudSyncSettings({
      lastStatus: 'error',
      lastSyncedAt: new Date().toISOString(),
      lastError: message,
    });
    throw error;
  }
}
