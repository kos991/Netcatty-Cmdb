// SettingsPage injection remains in netcatty-update-integration.mjs. These
// transforms extend the host's existing search, never add another search control.
function patch(source, name, apply) {
  const usesCRLF = source.includes('\r\n');
  let output = source.replace(/\r\n/g, '\n');
  const replace = (anchor, replacement) => {
    if (!output.includes(anchor) || output.indexOf(anchor) !== output.lastIndexOf(anchor)) {
      throw new Error(`${name}: missing or ambiguous upstream anchor: ${anchor}`);
    }
    output = output.replace(anchor, () => replacement);
  };
  apply(replace);
  return usesCRLF ? output.replace(/\n/g, '\r\n') : output;
}

export function patchSettingsSearchCatalogWithCmdb(source) {
  return patch(source, 'settingsSearchCatalog', (replace) => {
    replace('export const SETTINGS_TAB_IDS = [', 'import { CMDB_SETTINGS_SEARCH_ENTRIES } from "../components/cmdb/settingsNavigation";\n\nexport const SETTINGS_TAB_IDS = [\n  "cmdb",');
    replace('  labelKey: string;', '  labelKey: string;\n  /** Localized label from the Cmdb destination catalog. */\n  label?: string;');
    replace('];\n\nexport function settingsAnchorDomId(anchorId: string): string {', `  ...CMDB_SETTINGS_SEARCH_ENTRIES.map((entry): SettingsSearchEntry => ({
    id: entry.id,
    tab: "cmdb",
    label: entry.label,
    labelKey: entry.label,
    keywords: ["cmdb", ...entry.keywords],
  })),
];

export function settingsAnchorDomId(anchorId: string): string {`);
  });
}

export function patchSettingsSearchWithCmdb(source) {
  return patch(source, 'settingsSearch', (replace) => {
    replace('const TAB_LABEL_KEYS: Record<SettingsTabId, string> = {', 'const TAB_LABEL_KEYS: Record<SettingsTabId, string> = {\n  cmdb: "Cmdb",');
    replace('  const value = t(entry.labelKey);', '  if (entry.label) return entry.label;\n  const value = t(entry.labelKey);');
    replace('    tabLabel: tabLabelRaw && tabLabelRaw !== tabLabelKey ? tabLabelRaw : entry.tab,', '    tabLabel: entry.tab === "cmdb" ? "Cmdb" : (tabLabelRaw && tabLabelRaw !== tabLabelKey ? tabLabelRaw : entry.tab),');
  });
}

export function patchSettingsSearchControlWithCmdb(source) {
  return patch(source, 'SettingsSearchControl', (replace) => {
    replace('      if (event.key === "Escape") {\n        event.preventDefault();', '      if (event.key === "Escape") {\n        event.preventDefault();\n        event.stopPropagation();');
  });
}

export function patchSettingsUIWithCmdb(source) {
  return patch(source, 'settings-ui', (replace) => {
    replace('<div className={cn("text-xs text-muted-foreground", label && "mt-0.5")}>{description}</div>', '<div title={description} className={cn("text-xs text-muted-foreground", label && "mt-0.5")}>{description}</div>');
  });
}

export const CMDB_SETTINGS_HOST_PATCHES = [
  ['domain/settingsSearchCatalog.ts', patchSettingsSearchCatalogWithCmdb],
  ['domain/settingsSearch.ts', patchSettingsSearchWithCmdb],
  ['components/settings/SettingsSearchControl.tsx', patchSettingsSearchControlWithCmdb],
  ['components/settings/settings-ui.tsx', patchSettingsUIWithCmdb],
];
