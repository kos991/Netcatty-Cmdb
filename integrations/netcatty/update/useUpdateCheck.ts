import { useCallback, useEffect, useRef, useState } from 'react';
import { checkForUpdates, getReleaseUrl, releaseFromUpdate, type ReleaseInfo, type UpdateCheckResult } from '../../infrastructure/services/updateService';
import { localStorageAdapter } from '../../infrastructure/persistence/localStorageAdapter';
import { STORAGE_KEY_UPDATE_LAST_CHECK } from '../../infrastructure/config/storageKeys';
import { netcattyBridge } from '../../infrastructure/services/netcattyBridge';
import type { UpdateStatusSnapshot } from '../../types/global/netcatty-bridge-app';

export type AutoDownloadStatus = 'idle' | 'downloading' | 'ready' | 'error';
export type ManualCheckStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';
export interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  currentVersion: string;
  latestRelease: ReleaseInfo | null;
  error: string | null;
  lastCheckedAt: number | null;
  autoDownloadStatus: AutoDownloadStatus;
  downloadPercent: number;
  downloadError: string | null;
  manualCheckStatus: ManualCheckStatus;
}
export interface UseUpdateCheckResult {
  updateState: UpdateState;
  checkNow: () => Promise<UpdateCheckResult | null>;
  openReleasePage: () => void;
  installUpdate: () => void;
  startDownload: () => Promise<void>;
}

export function useUpdateCheck(options?: { autoUpdateEnabled?: boolean; enabled?: boolean; onNeedsSave?: () => void }): UseUpdateCheckResult {
  const enabled = options?.enabled !== false;
  const onNeedsSaveRef = useRef(options?.onNeedsSave);
  onNeedsSaveRef.current = options?.onNeedsSave;
  const isCheckingRef = useRef(false);
  const [updateState, setUpdateState] = useState<UpdateState>({
    isChecking: false, hasUpdate: false, currentVersion: '', latestRelease: null,
    error: null, lastCheckedAt: localStorageAdapter.readNumber(STORAGE_KEY_UPDATE_LAST_CHECK),
    autoDownloadStatus: 'idle', downloadPercent: 0, downloadError: null, manualCheckStatus: 'idle',
  });

  useEffect(() => {
    if (!enabled) return;
    const bridge = netcattyBridge.get();
    let cancelled = false;
    let eventRevision = 0;
    const fail = (error: unknown) => {
      if (!cancelled) setUpdateState(prev => ({ ...prev, error: error instanceof Error ? error.message : String(error), manualCheckStatus: 'error' }));
    };
    const applyStatus = (snapshot: UpdateStatusSnapshot) => {
      if (cancelled) return;
      const release = releaseFromUpdate(snapshot);
      setUpdateState(prev => ({
        ...prev,
        isChecking: !!snapshot.isChecking,
        hasUpdate: snapshot.status !== 'idle' && !!release,
        latestRelease: release,
        autoDownloadStatus: snapshot.status === 'available' ? 'idle' : snapshot.status,
        downloadPercent: snapshot.percent,
        downloadError: snapshot.status === 'error' ? snapshot.error : null,
        error: snapshot.checkError || null,
        lastCheckedAt: snapshot.checkedAt || prev.lastCheckedAt,
        manualCheckStatus: snapshot.checkError ? 'error' : prev.manualCheckStatus,
      }));
    };
    const refresh = () => {
      const revision = ++eventRevision;
      void bridge?.getUpdateStatus?.().then(snapshot => {
        if (revision === eventRevision) applyStatus(snapshot);
      }).catch(fail);
    };
    const cleanups = [
      bridge?.onUpdateAvailable?.(refresh), bridge?.onUpdateNotAvailable?.(refresh),
      bridge?.onUpdateDownloadProgress?.(refresh), bridge?.onUpdateDownloaded?.(refresh),
      bridge?.onUpdateError?.(refresh), bridge?.onUpdateNeedsSave?.(() => onNeedsSaveRef.current?.()),
    ];
    void bridge?.getAppInfo?.().then(info => {
      if (!cancelled && info?.version) setUpdateState(prev => ({ ...prev, currentVersion: info.version }));
    }).catch(fail);
    refresh();
    return () => { cancelled = true; cleanups.forEach(cleanup => cleanup?.()); };
  }, [enabled]);

  const checkNow = useCallback(async (): Promise<UpdateCheckResult | null> => {
    if (!enabled || isCheckingRef.current) return null;
    isCheckingRef.current = true;
    setUpdateState(prev => ({ ...prev, isChecking: true, error: null, manualCheckStatus: 'checking' }));
    try {
      const result = await checkForUpdates(updateState.currentVersion);
      const now = Date.now();
      if (!result.error) localStorageAdapter.writeNumber(STORAGE_KEY_UPDATE_LAST_CHECK, now);
      setUpdateState(prev => ({
        ...prev, isChecking: false, hasUpdate: result.hasUpdate, latestRelease: result.latestRelease,
        error: result.error || null, lastCheckedAt: result.error ? prev.lastCheckedAt : now,
        manualCheckStatus: result.error ? 'error' : result.hasUpdate ? 'available' : 'up-to-date',
      }));
      return result;
    } finally { isCheckingRef.current = false; }
  }, [enabled, updateState.currentVersion]);

  const openReleasePage = useCallback(() => {
    const url = getReleaseUrl(updateState.latestRelease?.version);
    const bridge = netcattyBridge.get();
    if (bridge?.openExternal) void bridge.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }, [updateState.latestRelease]);
  const installUpdate = useCallback(() => {
    if (enabled) netcattyBridge.get()?.installUpdate?.();
  }, [enabled]);
  const startDownload = useCallback(async () => {
    if (!enabled || updateState.autoDownloadStatus === 'downloading' || updateState.autoDownloadStatus === 'ready') return;
    try {
      const bridge = netcattyBridge.get();
      if (!bridge?.downloadUpdate) throw new Error('桌面下载接口不可用。');
      const result = await checkNow();
      if (!result) return;
      if (result.error) throw new Error(result.error);
      if (!result.hasUpdate) return;
      setUpdateState(prev => ({ ...prev, autoDownloadStatus: 'downloading', downloadPercent: 0, downloadError: null }));
      const download = await bridge.downloadUpdate();
      if (!download.success) throw new Error(download.error || '更新下载失败。');
      setUpdateState(prev => ({ ...prev, autoDownloadStatus: 'ready', downloadPercent: 100 }));
    } catch (error) {
      setUpdateState(prev => ({ ...prev, autoDownloadStatus: 'error', downloadError: error instanceof Error ? error.message : String(error) }));
    }
  }, [enabled, updateState.autoDownloadStatus, checkNow]);

  return { updateState, checkNow, openReleasePage, installUpdate, startDownload };
}
