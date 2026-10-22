import { netcattyBridge } from './netcattyBridge';

const RELEASES_PAGE_URL = 'https://github.com/binaricat/Netcatty/releases';

export interface ReleaseInfo {
  version: string;
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestRelease: ReleaseInfo | null;
  error?: string;
}

export function getReleaseUrl(version?: string): string {
  return version ? `${RELEASES_PAGE_URL}/tag/v${version.replace(/^v/i, '')}` : RELEASES_PAGE_URL;
}

export function releaseFromUpdate(info: { version?: string | null; releaseNotes?: string; releaseDate?: string | null }): ReleaseInfo | null {
  if (!info.version) return null;
  return {
    version: info.version,
    tagName: `v${info.version}`,
    name: `Netcatty v${info.version}`,
    body: info.releaseNotes || '',
    htmlUrl: getReleaseUrl(info.version),
    publishedAt: info.releaseDate || '',
  };
}

/** The main process and electron-updater own version ordering and installer selection. */
export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  try {
    const bridge = netcattyBridge.get();
    if (!bridge?.checkForUpdate) throw new Error('桌面更新接口不可用，请从 Netcatty 发布页下载安装包。');
    const result = await bridge.checkForUpdate();
    if (result.error) throw new Error(result.error);
    if (result.supported === false) throw new Error('当前安装格式不支持自动升级，请从 Netcatty 发布页下载安装包。');
    return { hasUpdate: result.available, currentVersion, latestRelease: releaseFromUpdate(result) };
  } catch (error) {
    return { hasUpdate: false, currentVersion, latestRelease: null, error: error instanceof Error ? error.message : String(error) };
  }
}
