import React, { useCallback, useState } from 'react';
import {
  AppWindow,
  ChartNoAxesCombined,
  Database,
  Monitor,
  Network,
  Search,
  Server,
  Settings2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useIsTabActive } from '../../application/state/activeTabStore';
import { useStoredNumber } from '../../application/state/useStoredNumber';
import { cn } from '../../lib/utils';
import { RippleButton } from '../ui/ripple';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import CmdbWorkspace from './CmdbWorkspace';
import { MODULES } from './cmdbWorkspaceState';

const CMDB_SIDEBAR_WIDTH_KEY = 'netcatty_cmdb_sidebar_width_v1';
const VAULT_SIDEBAR_WIDTH_KEY = 'netcatty_vault_sidebar_width_v1';
const SIDEBAR_COLLAPSED_WIDTH = 56;
const SIDEBAR_EXPANDED_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_LABEL_THRESHOLD = 96;

const MODULE_ICONS: Record<string, LucideIcon> = {
  Search,
  Monitor,
  Server,
  AppWindow,
  Users,
  Network,
  ChartNoAxesCombined,
  Settings2,
};

function readInitialSidebarWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_COLLAPSED_WIDTH;
  const stored = Number(
    window.localStorage.getItem(CMDB_SIDEBAR_WIDTH_KEY)
      ?? window.localStorage.getItem(VAULT_SIDEBAR_WIDTH_KEY),
  );
  if (!Number.isFinite(stored)) return SIDEBAR_COLLAPSED_WIDTH;
  return Math.max(SIDEBAR_COLLAPSED_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, stored));
}

export const CmdbSurface = React.memo(function CmdbSurface() {
  const active = useIsTabActive('cmdb');
  const [activeModule, setActiveModule] = useState('search');
  const [projectName, setProjectName] = useState('默认项目');
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth, persistSidebarWidth] = useStoredNumber(
    CMDB_SIDEBAR_WIDTH_KEY,
    readInitialSidebarWidth(),
    { min: SIDEBAR_COLLAPSED_WIDTH, max: SIDEBAR_MAX_WIDTH },
  );
  const effectiveSidebarWidth = Math.max(
    SIDEBAR_COLLAPSED_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, Number(sidebarWidth) || SIDEBAR_COLLAPSED_WIDTH),
  );
  const sidebarCollapsed = effectiveSidebarWidth < SIDEBAR_LABEL_THRESHOLD;

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    const nextWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;
    setSidebarWidth(nextWidth);
    persistSidebarWidth(nextWidth);
  }, [persistSidebarWidth, setSidebarWidth]);

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
  }, [effectiveSidebarWidth, persistSidebarWidth, setSidebarWidth]);

  return (
    <section
      className={active ? 'absolute inset-0 z-20 min-h-0' : 'hidden'}
      aria-hidden={!active}
    >
      <div className="absolute inset-0 min-h-0 flex bg-secondary" data-section="cmdb-view">
        <TooltipProvider delayDuration={100}>
          <aside
            className={cn(
              'relative shrink-0 bg-secondary flex flex-col',
              isSidebarResizing ? 'transition-none' : 'transition-[width] duration-200',
            )}
            style={{ width: effectiveSidebarWidth }}
            data-section="cmdb-sidebar"
          >
            <div
              className={cn(
                'pt-5 pb-6 flex items-center',
                sidebarCollapsed ? 'px-2 justify-center' : 'px-4',
              )}
            >
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={sidebarCollapsed ? '展开 Cmdb 侧栏' : '收起 Cmdb 侧栏'}
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    className="flex min-w-0 items-center gap-2.5 hover:opacity-80 transition-opacity"
                  >
                    <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                      <Database size={17} aria-hidden="true" />
                    </span>
                    {!sidebarCollapsed && (
                      <span className="grid min-w-0 text-left leading-tight">
                        <strong className="text-sm font-semibold text-foreground">Cmdb</strong>
                        <small className="truncate text-[11px] font-normal text-muted-foreground" title={projectName}>
                          {projectName}
                        </small>
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {sidebarCollapsed ? '展开 Cmdb 侧栏' : '收起 Cmdb 侧栏'}
                </TooltipContent>
              </Tooltip>
            </div>

            <nav
              className={cn('space-y-1', sidebarCollapsed ? 'px-1.5' : 'px-2.5')}
              aria-label="Cmdb 模块"
            >
              {MODULES.map((item) => {
                const Icon = MODULE_ICONS[item.icon] ?? Search;
                const selected = activeModule === item.key;
                return (
                  <Tooltip key={item.key}>
                    <TooltipTrigger asChild>
                      <RippleButton
                        type="button"
                        variant={selected ? 'secondary' : 'ghost'}
                        className={cn(
                          'w-full h-10',
                          sidebarCollapsed ? 'justify-center p-0' : 'justify-start gap-3',
                          selected && 'bg-foreground/10 text-foreground hover:bg-foreground/15 border-border/40',
                        )}
                        aria-current={selected ? 'page' : undefined}
                        aria-label={item.label}
                        onClick={() => setActiveModule(item.key)}
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

        <div className="flex min-w-0 flex-1 py-0 pr-2 pb-2 pl-0" data-section="cmdb-stage">
          <div
            className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm"
            data-section="cmdb-surface"
          >
            <CmdbWorkspace
              activeModule={activeModule}
              onModuleChange={setActiveModule}
              onProjectNameChange={setProjectName}
              nativeShell
            />
          </div>
        </div>
      </div>
    </section>
  );
});
