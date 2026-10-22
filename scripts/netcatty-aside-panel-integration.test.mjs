import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { patchAsidePanel } from './netcatty-aside-panel-integration.mjs';

const hostRoot = fileURLToPath(new URL('../build/netcatty-upgrade-185', import.meta.url));
const upstream = JSON.parse(readFileSync(new URL('../integrations/netcatty/upstream.json', import.meta.url), 'utf8'));

function readPristinePanel(t) {
  if (!existsSync(`${hostRoot}/.git`)) {
    t.skip(`未找到锁定的 Netcatty 宿主源码: ${hostRoot}`);
    return null;
  }
  try {
    return execFileSync('git', ['show', `${upstream.commit}:components/ui/aside-panel.tsx`], {
      cwd: hostRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    }).replace(/\r\n/g, '\n');
  } catch {
    t.skip(`宿主源码缺少锁定提交 ${upstream.commit}`);
    return null;
  }
}

test('AsidePanel patch reproduces the resizable width contract from the pinned host', (t) => {
  const source = readPristinePanel(t);
  if (!source) return;
  const output = patchAsidePanel(source);
  assert.equal(output.split('minWidthPx?: number;').length - 1, 1);
  assert.match(output, /minWidthPx = MIN_ASIDE_INLINE_WIDTH_PX,\n    maxWidthPx = MAX_ASIDE_INLINE_WIDTH_PX,/);
  assert.match(output, /const fallbackWidthPx = clampAsideInlineWidth\(parseInlineWidthPx\(width\), minWidthPx, maxWidthPx\);/);
  assert.match(output, /tabIndex=\{0\}\n\s+aria-valuemin=\{minWidthPx\}\n\s+aria-valuemax=\{maxWidthPx\}\n\s+aria-valuenow=\{panelWidthPx\}/);
  assert.match(output, /const step = event\.shiftKey \? 1 : 10;/);
  assert.match(output, /event\.key === 'ArrowLeft' \? step : -step/);
  assert.match(output, /event\.key === 'Home'[\s\S]*?resetWidth\(\);/);
  assert.match(output, /onKeyDown=\{handleResizeKeyDown\}\n\s+onDoubleClick=\{resetWidth\}/);
  assert.match(output, /commitWidth\(fallbackWidthPx, true\)/);
  assert.match(output, /onWidthChangeRef\.current = onWidthChange;/);
  assert.match(output, /onWidthChangeRef\.current\?\.\(panelRef\.current\.getBoundingClientRect\(\)\.width\);/);
  assert.match(output, /window\.addEventListener\('pointercancel', handlePointerCancel\);\n\s+window\.addEventListener\('blur', handleWindowBlur\);/);
  assert.match(output, /window\.removeEventListener\('pointermove', handlePointerMove\);/);
  assert.match(output, /document\.body\.style\.cursor = previousCursor;/);
  assert.match(output, /document\.body\.style\.userSelect = previousUserSelect;/);
  assert.match(output, /return \(\) => resizeCleanupRef\.current\?\.\(\);/);
  assert.throws(() => patchAsidePanel(output), /anchor is (missing|ambiguous)/);
});

test('AsidePanel drag and keyboard paths never capture a stale width callback', (t) => {
  const source = readPristinePanel(t);
  if (!source) return;
  const output = patchAsidePanel(source);
  const resizeHandlers = output.slice(
    output.indexOf('const resetWidth = useCallback'),
    output.indexOf('if (!open) return null;', output.indexOf('const resetWidth = useCallback')),
  );
  assert.ok(resizeHandlers.length > 0);
  assert.doesNotMatch(resizeHandlers, /onWidthChange/);
  assert.match(resizeHandlers, /commitWidth\(panelWidthRef\.current \+ \(event\.key === 'ArrowLeft' \? step : -step\), true\)/);
  assert.match(resizeHandlers, /commitWidth\(startWidth \+ startX - moveEvent\.clientX\)/);
  assert.match(resizeHandlers, /commitWidth\(startWidth \+ startX - upEvent\.clientX, true\)/);
});

test('AsidePanel patch keeps the global 380 default and non-resizable w-full layout', (t) => {
  const source = readPristinePanel(t);
  if (!source) return;
  const output = patchAsidePanel(source);
  assert.match(output, /export const DEFAULT_ASIDE_INLINE_WIDTH_PX = 380;/);
  assert.match(output, /const MIN_ASIDE_INLINE_WIDTH_PX = 320;/);
  assert.match(output, /const MAX_ASIDE_INLINE_WIDTH_PX = 720;/);
  assert.match(output, /width = 'w-\[380px\]'/);
  assert.match(output, /layout === 'overlay' && !usesPixelWidth && width,/);
  assert.match(output, /const usesPixelWidth = resizable \|\| layout === 'inline';/);
  assert.doesNotMatch(output, /onWidthChange\?\.\(nextWidth\)/);
});

test('AsidePanel patch rejects a host without the resize anchors', () => {
  assert.throws(() => patchAsidePanel('export default null;'), /anchor is missing/);
});
