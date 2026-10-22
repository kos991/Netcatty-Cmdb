import React, { useCallback, useMemo, useState } from 'react';
import type { Host } from '../../domain/models';
import { resolveBridgeKeyAuth, resolveBridgeSshAgentAuth, resolveHostAuth } from '../../domain/sshAuth';
import {
  ChartNoAxesCombined,
  Monitor,
  Network,
  Router,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useIsTabActive } from '../../application/state/activeTabStore';
import { getVaultSnapshot, useVaultSnapshotActions, useVaultSnapshotField } from '../../application/state/vaultSnapshotStore';
import { collectWorkSurfaceHostGroups } from '../../application/app/AppHostEditorLayer';
import { useStoredBoolean } from '../../application/state/useStoredBoolean';
import { useStoredNumber } from '../../application/state/useStoredNumber';
import { useTerminalBackend } from '../../application/state/useTerminalBackend';
import {
  STORAGE_KEY_VAULT_SIDEBAR_COLLAPSED,
  STORAGE_KEY_VAULT_SIDEBAR_WIDTH,
} from '../../infrastructure/config/storageKeys';
import { cn } from '../../lib/utils';
import { AppLogo } from '../AppLogo';
import { AppWordmark } from '../AppWordmark';
import { RippleButton } from '../ui/ripple';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import CmdbWorkspace from './CmdbWorkspace';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { NetcattyDirectoryProvider } from './NetcattyDirectory';
import { assertNetcattyLinkReady } from './NetcattyConnection';
import { MODULES, netcattyDirectorySummaries } from './state';
import { buildSwitchCommand, normalizeSwitchVendor, parseSwitchOutput } from './switchConfig';
import { requestHostBrowserPanel } from '../../application/state/hostBrowserPanelRequests';
import { createNetcattyVaultActions } from './netcattyVaultActions';
import { readTelnetConfiguration } from './readTelnetConfiguration';
import { readHostHardware } from './readHostHardware';

const SIDEBAR_COLLAPSED_WIDTH = 56;
const SIDEBAR_EXPANDED_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_LABEL_THRESHOLD = 96;
const SWITCH_READ_TIMEOUT_MS = 20_000;
const SWITCH_MAX_OUTPUT_BYTES = 1024 * 1024;



const MODULE_ICONS: Record<string, LucideIcon> = {
  Monitor,
  Users,
  Router,
  ChartNoAxesCombined,
  Network,
};

export const CmdbSurface = React.memo(function CmdbSurface({ onConnectHost }: { onConnectHost?: (host: Host) => void }) {
  const active = useIsTabActive('cmdb');
  const terminalBackend = useTerminalBackend();
  const vaultHosts = useVaultSnapshotField('hosts');
  const vaultKeys = useVaultSnapshotField('keys');
  const vaultIdentities = useVaultSnapshotField('identities');
  const vaultCustomGroups = useVaultSnapshotField('customGroups');
  const vaultGroupConfigs = useVaultSnapshotField('groupConfigs');
  const vaultActions = useVaultSnapshotActions();
  const netcattyGroups = useMemo(
    () => collectWorkSurfaceHostGroups([...vaultHosts], [...vaultCustomGroups], [...vaultGroupConfigs]),
    [vaultHosts, vaultCustomGroups, vaultGroupConfigs],
  );
  const [activeModule, setActiveModule] = useState('assets');
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const handleWorkspaceDirtyChange = useCallback((dirty: boolean, busy = false) => {
    setWorkspaceDirty(dirty);
    setWorkspaceBusy(busy);
  }, []);
  const [pendingModule, setPendingModule] = useState<string | null>(null);
  const changeModule = useCallback((module: string) => {
    if (workspaceBusy || module === activeModule) return;
    if (workspaceDirty) { setPendingModule(module); return; }
    setActiveModule(module);
  }, [activeModule, workspaceDirty, workspaceBusy]);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [storedSidebarCollapsed, setStoredSidebarCollapsed] = useStoredBoolean(
    STORAGE_KEY_VAULT_SIDEBAR_COLLAPSED,
    false,
  );
  const [sidebarWidth, setSidebarWidth, persistSidebarWidth] = useStoredNumber(
    STORAGE_KEY_VAULT_SIDEBAR_WIDTH,
    storedSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH,
    { min: SIDEBAR_COLLAPSED_WIDTH, max: SIDEBAR_MAX_WIDTH },
  );
  const effectiveSidebarWidth = Math.max(
    SIDEBAR_COLLAPSED_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, Number(sidebarWidth) || SIDEBAR_COLLAPSED_WIDTH),
  );
  const sidebarCollapsed = effectiveSidebarWidth < SIDEBAR_LABEL_THRESHOLD;
  const netcattyDirectory = useMemo(() => {
    const summaries = netcattyDirectorySummaries({ hosts: [...vaultHosts], keys: [...vaultKeys], identities: [...vaultIdentities] });
    return {
      ...summaries,
      groups: netcattyGroups,
      connectHost: (hostId: string, credentialId = '') => {
        const snapshot = getVaultSnapshot();
        const host = snapshot.hosts.find((item) => item.id === hostId);
        if (!host) throw new Error('关联的 Netcatty 主机已不存在，请重新关联');
        if (credentialId) assertNetcattyLinkReady({ host_id: hostId, credential_id: credentialId }, host, [...snapshot.identities, ...snapshot.keys]);
        if (!onConnectHost) throw new Error('Netcatty 连接入口未初始化');
        onConnectHost(host);
      },
      openBrowser: (hostId: string, url: string) => {
        const snapshot = getVaultSnapshot();
        const host = snapshot.hosts.find((item) => item.id === hostId);
        if (!host) throw new Error('关联的 Netcatty 主机已不存在，请重新关联');
        if (!url || !/^https?:\/\//i.test(url)) throw new Error('仅支持以 http 或 https 开头的访问地址');
        requestHostBrowserPanel({ host, url });
      },
      ...createNetcattyVaultActions(vaultActions, getVaultSnapshot),
      refreshDirectory: () => {},
      readHardware: async (hostId: string, family: string, credentialId = '') => {
        const snapshot = getVaultSnapshot();
        const host = snapshot.hosts.find(item => item.id === hostId);
        if (!host) throw new Error('关联的 Netcatty 主机不存在');
        if (credentialId) assertNetcattyLinkReady({ host_id: hostId, credential_id: credentialId }, host, [...snapshot.identities, ...snapshot.keys]);
        return readHostHardware(terminalBackend, host, snapshot, family);
      },
      readSwitch: async (hostId: string, vendorName: string, credentialId = '') => {
        const snapshot = getVaultSnapshot();
        const host = snapshot.hosts.find((item) => item.id === hostId);
        if (!host) throw new Error('关联的 Netcatty 主机不存在');
        if (credentialId) assertNetcattyLinkReady({ host_id: hostId, credential_id: credentialId }, host, [...snapshot.identities, ...snapshot.keys]);
        const vendor = normalizeSwitchVendor(vendorName);
        if (!vendor) throw new Error(`交换机厂商未适配：${vendorName || '未填写'}`);
        const protocol = String(host.protocol || 'ssh').toLowerCase();
        const commands = buildSwitchCommand(vendor, protocol);
        let output = '';
        if (protocol === 'telnet') {
          const telnetIdentity = snapshot.identities.find((item) => item.id === host.telnetIdentityId);
          if (host.telnetIdentityId && (!telnetIdentity || telnetIdentity.authMethod !== 'password' || !telnetIdentity.username?.trim() || !telnetIdentity.password)) throw new Error('Telnet 登录身份不可用，请检查用户名和密码');
          output = await readTelnetConfiguration(
            terminalBackend,
            host,
            telnetIdentity ? telnetIdentity.username : host.telnetUsername || host.username || '',
            telnetIdentity ? telnetIdentity.password : host.telnetPassword || host.password,
            commands,
          );
        } else {
          if (!terminalBackend.execCommand) throw new Error('当前 Netcatty 不支持 SSH 配置读取');
          const auth = resolveHostAuth({ host, keys: [...snapshot.keys], identities: [...snapshot.identities] });
          const keyAuth = resolveBridgeKeyAuth({ key: auth.key, fallbackIdentityFilePaths: host.identityFilePaths, passphrase: auth.passphrase });
          const agentAuth = resolveBridgeSshAgentAuth(host, auth.key, auth.authMethod);
          const chunks: string[] = [];
          for (const [index, command] of commands.entries()) {
            const result = await terminalBackend.execCommand({
              hostname: host.hostname,
              hostId: host.id,
              username: auth.username,
              port: host.port || 22,
              authMethod: auth.authMethod,
              password: auth.password,
              privateKey: keyAuth.privateKey,
              certificate: auth.key?.certificate,
              publicKey: auth.key?.publicKey,
              keyId: auth.keyId,
              keySource: auth.key?.source,
              passphrase: keyAuth.passphrase,
              identityFilePaths: keyAuth.identityFilePaths,
              ...agentAuth,
              legacyAlgorithms: host.legacyAlgorithms,
              skipEcdsaHostKey: host.skipEcdsaHostKey,
              algorithmOverrides: host.algorithms,
              command,
              timeout: SWITCH_READ_TIMEOUT_MS,
              enableKeyboardInteractive: true,
              requiresMfa: !!host.requiresMfa,
              sessionId: `cmdb-switch-${host.id}-${Date.now()}-${index}`,
            });
            if (result?.code != null && result.code !== 0) throw new Error(`设备读取命令失败：${command}（状态 ${result.code}）`);
            if (result?.stdout) chunks.push(result.stdout);
            if (result?.stderr) chunks.push(result.stderr);
            if (chunks.reduce((size, chunk) => size + new TextEncoder().encode(chunk).byteLength, 0) > SWITCH_MAX_OUTPUT_BYTES) throw new Error('交换机输出超过 1 MiB，未保存不完整配置');
          }
          output = chunks.join('\n');
          if (!output.trim()) throw new Error('交换机未返回可解析的配置');
        }
        return { snapshot: parseSwitchOutput(vendor, output), vendor, protocol, hostId: host.id };
      },
    };
  }, [netcattyGroups, onConnectHost, terminalBackend, vaultActions, vaultHosts, vaultIdentities, vaultKeys]);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    const nextWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;
    setSidebarWidth(nextWidth);
    persistSidebarWidth(nextWidth);
    setStoredSidebarCollapsed(collapsed);
  }, [persistSidebarWidth, setSidebarWidth, setStoredSidebarCollapsed]);

  const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = effectiveSidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const clampWidth = (value: number) => Math.max(
      SIDEBAR_COLLAPSED_WIDTH,
      Math.min(SIDEBAR_MAX_WIDTH, value),
    );

    setIsSidebarResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampWidth(startWidth + moveEvent.clientX - startX));
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      const nextWidth = clampWidth(startWidth + upEvent.clientX - startX);
      setSidebarWidth(nextWidth);
      persistSidebarWidth(nextWidth);
      setStoredSidebarCollapsed(nextWidth < SIDEBAR_LABEL_THRESHOLD);
      setIsSidebarResizing(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [effectiveSidebarWidth, persistSidebarWidth, setSidebarWidth, setStoredSidebarCollapsed]);

  return (
    <section
      className={active ? 'absolute inset-0 z-20 min-h-0' : 'hidden'}
      aria-hidden={!active}
    >
      <div className="cmdb-theme-scope absolute inset-0 flex min-h-0 bg-secondary" data-section="cmdb-view">
        <TooltipProvider delayDuration={100}>
          <aside
            className={cn(
              'relative flex shrink-0 flex-col bg-secondary',
              isSidebarResizing ? 'transition-none' : 'transition-[width] duration-200',
            )}
            style={{ width: effectiveSidebarWidth }}
            data-section="cmdb-sidebar"
          >
            <div className={cn('flex items-center pb-6 pt-5', sidebarCollapsed ? 'justify-center px-2' : 'px-4')}>
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={sidebarCollapsed ? '展开 Cmdb 侧栏' : '收起 Cmdb 侧栏'}
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
                  >
                    <AppLogo className="h-8 w-8 flex-shrink-0" />
                    {!sidebarCollapsed && <AppWordmark className="h-5 w-auto text-foreground" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {sidebarCollapsed ? '展开 Cmdb 侧栏' : '收起 Cmdb 侧栏'}
                </TooltipContent>
              </Tooltip>
            </div>

            <nav className={cn('space-y-1', sidebarCollapsed ? 'px-1.5' : 'px-2.5')} aria-label="Cmdb 模块">
              {MODULES.map((item) => {
                const Icon = MODULE_ICONS[item.icon] ?? Monitor;
                const selected = activeModule === item.key;
                return (
                  <Tooltip key={item.key}>
                    <TooltipTrigger asChild>
                      <RippleButton
                        type="button"
                        variant={selected ? 'secondary' : 'ghost'}
                        className={cn(
                          'h-10 w-full',
                          sidebarCollapsed ? 'justify-center p-0' : 'justify-start gap-3',
                          selected && 'border-border/40 bg-foreground/10 text-foreground hover:bg-foreground/15',
                        )}
                        aria-current={selected ? 'page' : undefined}
                        aria-label={item.label}
                        disabled={workspaceBusy}
                        onClick={() => changeModule(item.key)}
                      >
                        <Icon size={16} className="flex-shrink-0" aria-hidden="true" />
                        {!sidebarCollapsed && item.label}
                      </RippleButton>
                    </TooltipTrigger>
                    {sidebarCollapsed && <TooltipContent side="right">{item.label}</TooltipContent>}
                  </Tooltip>
                );
              })}
            </nav>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整 Cmdb 侧栏宽度"
              className={cn(
                'app-no-drag absolute right-0 top-0 z-20 h-full w-2 translate-x-1/2 cursor-col-resize',
                'after:absolute after:right-1/2 after:top-2 after:h-[calc(100%-16px)] after:w-px after:translate-x-1/2 after:bg-border/0 after:transition-colors',
                'hover:after:bg-border/70',
                isSidebarResizing && 'after:bg-primary/70',
              )}
              onPointerDown={handleSidebarResizeStart}
            />
          </aside>
        </TooltipProvider>

        <div className="flex min-w-0 flex-1 pb-2 pl-0 pr-2 pt-0" data-section="cmdb-stage">
          <main
            className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm"
            data-section="cmdb-surface"
          >
            <NetcattyDirectoryProvider value={netcattyDirectory}>
              <CmdbWorkspace activeModule={activeModule} onModuleChange={changeModule} onDirtyChange={handleWorkspaceDirtyChange} />
            </NetcattyDirectoryProvider>
          </main>
        </div>
      </div>
      <ConfirmDialog open={pendingModule !== null} onOpenChange={(open) => { if (!open) setPendingModule(null); }} title="尚有未保存的设备修改" message="离开当前页面将放弃这些修改。可取消并保存后再切换。" confirmLabel="放弃修改并切换" busy={workspaceBusy} onConfirm={() => { if (workspaceBusy) return; if (pendingModule) { setWorkspaceDirty(false); setActiveModule(pendingModule); } setPendingModule(null); }} />
    </section>
  );
});
