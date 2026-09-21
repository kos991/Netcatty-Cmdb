import React, { useState } from 'react';
import {
  ChartNoAxesCombined,
  Monitor,
  Network,
  Settings2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useIsTabActive } from '../../application/state/activeTabStore';
import { cn } from '../../lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import CmdbWorkspace from './CmdbWorkspace';
import { MODULES } from './state';

const MODULE_ICONS: Record<string, LucideIcon> = {
  Monitor,
  Users,
  Network,
  ChartNoAxesCombined,
  Settings2,
};

export const CmdbSurface = React.memo(function CmdbSurface() {
  const active = useIsTabActive('cmdb');
  const [activeModule, setActiveModule] = useState('assets');

  return (
    <section
      className={active ? 'absolute inset-0 z-20 min-h-0' : 'hidden'}
      aria-hidden={!active}
    >
      <div className="absolute inset-0 flex min-h-0 bg-secondary" data-section="cmdb-view">
        <TooltipProvider delayDuration={150}>
          <aside
            className="flex w-[70px] shrink-0 flex-col items-center gap-3 bg-secondary pt-5"
            data-section="cmdb-sidebar"
          >
            {MODULES.map((item) => {
              const Icon = MODULE_ICONS[item.icon] ?? Monitor;
              const selected = activeModule === item.key;
              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'grid h-11 w-11 place-items-center rounded-md text-muted-foreground transition-colors',
                        'hover:bg-foreground/10 hover:text-foreground',
                        selected && 'bg-foreground/20 text-foreground',
                      )}
                      aria-current={selected ? 'page' : undefined}
                      aria-label={item.label}
                      onClick={() => setActiveModule(item.key)}
                    >
                      <Icon size={17} aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </aside>
        </TooltipProvider>

        <main
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden border-l border-border/60 bg-background"
          data-section="cmdb-surface"
        >
          <CmdbWorkspace activeModule={activeModule} onModuleChange={setActiveModule} />
        </main>
      </div>
    </section>
  );
});
