const FILE_NAME = "components/ui/aside-panel.tsx";

function replaceOnce(source, search, replacement) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`Integration anchor is missing in ${FILE_NAME}`);
  if (source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Integration anchor is ambiguous in ${FILE_NAME}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

/**
 * Gives AsidePanel sole ownership of the numeric panel width and its persistence.
 * Callers only pass bounds and observe the rendered width through onWidthChange.
 */
export function patchAsidePanel(source) {
  let output = replaceOnce(
    source,
    "export function clampAsideInlineWidth(width: number): number {\n    return Math.max(MIN_ASIDE_INLINE_WIDTH_PX, Math.min(MAX_ASIDE_INLINE_WIDTH_PX, width));\n}",
    "export function clampAsideInlineWidth(width: number, minWidthPx = MIN_ASIDE_INLINE_WIDTH_PX, maxWidthPx = MAX_ASIDE_INLINE_WIDTH_PX): number {\n    return Math.max(minWidthPx, Math.min(maxWidthPx, width));\n}",
  );
  output = replaceOnce(
    output,
    "    persistWidthStorageKey?: string;\n    resizeAriaLabel?: string;",
    "    persistWidthStorageKey?: string;\n    resizeAriaLabel?: string;\n    minWidthPx?: number;\n    maxWidthPx?: number;\n    onWidthChange?: (width: number) => void;",
  );
  output = replaceOnce(
    output,
    "        if (!Number.isNaN(parsed)) return clampAsideInlineWidth(parsed);",
    "        if (!Number.isNaN(parsed)) return parsed;",
  );
  output = replaceOnce(
    output,
    "function readPersistedAsideWidth(storageKey: string | undefined, fallback: number): number {\n    if (!storageKey) return fallback;\n    const stored = localStorageAdapter.readNumber(storageKey);\n    if (stored === null) return fallback;\n    return clampAsideInlineWidth(stored);\n}",
    "function readPersistedAsideWidth(storageKey: string | undefined, fallback: number, minWidthPx: number, maxWidthPx: number): number {\n    const stored = storageKey ? localStorageAdapter.readNumber(storageKey) : null;\n    return clampAsideInlineWidth(stored ?? fallback, minWidthPx, maxWidthPx);\n}",
  );
  output = replaceOnce(
    output,
    "    persistWidthStorageKey,\n    resizeAriaLabel,\n    dataSection,\n}) => {",
    "    persistWidthStorageKey,\n    resizeAriaLabel,\n    minWidthPx = MIN_ASIDE_INLINE_WIDTH_PX,\n    maxWidthPx = MAX_ASIDE_INLINE_WIDTH_PX,\n    onWidthChange,\n    dataSection,\n}) => {",
  );
  output = replaceOnce(
    output,
    "    const fallbackWidthPx = parseInlineWidthPx(width);\n    const [panelWidthPx, setPanelWidthPx] = useState(() =>\n        resizable ? readPersistedAsideWidth(persistWidthStorageKey, fallbackWidthPx) : fallbackWidthPx,\n    );\n    const [isResizing, setIsResizing] = useState(false);",
    "    const fallbackWidthPx = clampAsideInlineWidth(parseInlineWidthPx(width), minWidthPx, maxWidthPx);\n    const [panelWidthPx, setPanelWidthPx] = useState(() =>\n        resizable ? readPersistedAsideWidth(persistWidthStorageKey, fallbackWidthPx, minWidthPx, maxWidthPx) : fallbackWidthPx,\n    );\n    const [isResizing, setIsResizing] = useState(false);\n    const panelRef = React.useRef<HTMLDivElement>(null);\n    const panelWidthRef = React.useRef(panelWidthPx);\n    const onWidthChangeRef = React.useRef(onWidthChange);\n    const resizeCleanupRef = React.useRef<(() => void) | null>(null);\n    onWidthChangeRef.current = onWidthChange;\n\n    const commitWidth = useCallback((nextWidth: number, persist = false) => {\n        const clampedWidth = clampAsideInlineWidth(nextWidth, minWidthPx, maxWidthPx);\n        panelWidthRef.current = clampedWidth;\n        setPanelWidthPx(clampedWidth);\n        // Notify on every drag sample, not only when the clamped value changes.\n        onWidthChangeRef.current?.(clampedWidth);\n        if (persist && persistWidthStorageKey) {\n            localStorageAdapter.writeNumber(persistWidthStorageKey, clampedWidth);\n        }\n    }, [minWidthPx, maxWidthPx, persistWidthStorageKey]);\n\n    // Re-read the shared preference when opening or returning from a full-width view.\n    // The full-width branch never overwrites the remembered resizable width.\n    React.useLayoutEffect(() => {\n        resizeCleanupRef.current?.();\n        setIsResizing(false);\n        if (open && resizable) {\n            commitWidth(readPersistedAsideWidth(\n                persistWidthStorageKey,\n                persistWidthStorageKey ? fallbackWidthPx : panelWidthRef.current,\n                minWidthPx,\n                maxWidthPx,\n            ));\n        }\n        return () => resizeCleanupRef.current?.();\n    }, [open, resizable, fallbackWidthPx, minWidthPx, maxWidthPx, persistWidthStorageKey, commitWidth]);\n\n    // Report the rendered width after layout, so w-full reports its real pixels.\n    // The ref keeps an in-flight drag from calling an obsolete business callback.\n    React.useLayoutEffect(() => {\n        if (!open || !panelRef.current) return;\n        // Skip while a commit is still rendering or a drag is in flight: commitWidth already reports those widths.\n        if (resizable && (isResizing || panelWidthPx !== panelWidthRef.current)) return;\n        onWidthChangeRef.current?.(panelRef.current.getBoundingClientRect().width);\n    }, [open, resizable, isResizing, panelWidthPx, fallbackWidthPx, layout]);",
  );
  output = replaceOnce(
    output,
    "    const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {\n        if (!resizable) return;\n\n        event.preventDefault();\n        event.stopPropagation();\n\n        const startX = event.clientX;\n        const startWidth = panelWidthPx;\n        const previousCursor = document.body.style.cursor;\n        const previousUserSelect = document.body.style.userSelect;\n\n        setIsResizing(true);\n        document.body.style.cursor = 'col-resize';\n        document.body.style.userSelect = 'none';\n\n        const handlePointerMove = (moveEvent: PointerEvent) => {\n            setPanelWidthPx(clampAsideInlineWidth(startWidth + startX - moveEvent.clientX));\n        };\n        const handlePointerUp = (upEvent: PointerEvent) => {\n            const nextWidth = clampAsideInlineWidth(startWidth + startX - upEvent.clientX);\n            setPanelWidthPx(nextWidth);\n            if (persistWidthStorageKey) {\n                localStorageAdapter.writeNumber(persistWidthStorageKey, nextWidth);\n            }\n            setIsResizing(false);\n            document.body.style.cursor = previousCursor;\n            document.body.style.userSelect = previousUserSelect;\n            window.removeEventListener('pointermove', handlePointerMove);\n            window.removeEventListener('pointerup', handlePointerUp);\n            window.removeEventListener('pointercancel', handlePointerUp);\n        };\n\n        window.addEventListener('pointermove', handlePointerMove);\n        window.addEventListener('pointerup', handlePointerUp);\n        window.addEventListener('pointercancel', handlePointerUp);\n    }, [panelWidthPx, persistWidthStorageKey, resizable]);",
    "    const resetWidth = useCallback(() => {\n        resizeCleanupRef.current?.();\n        setIsResizing(false);\n        commitWidth(fallbackWidthPx, true);\n    }, [commitWidth, fallbackWidthPx]);\n\n    const handleResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {\n        const step = event.shiftKey ? 1 : 10;\n        if (event.key === 'Home') {\n            event.preventDefault();\n            event.stopPropagation();\n            resetWidth();\n        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {\n            event.preventDefault();\n            event.stopPropagation();\n            commitWidth(panelWidthRef.current + (event.key === 'ArrowLeft' ? step : -step), true);\n        }\n    }, [commitWidth, resetWidth]);\n\n    const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {\n        if (!resizable || event.button !== 0) return;\n        event.preventDefault();\n        event.stopPropagation();\n        event.currentTarget.focus();\n        resizeCleanupRef.current?.();\n\n        const startX = event.clientX;\n        const startWidth = panelWidthRef.current;\n        const pointerId = event.pointerId;\n        const previousCursor = document.body.style.cursor;\n        const previousUserSelect = document.body.style.userSelect;\n        const cleanup = () => {\n            window.removeEventListener('pointermove', handlePointerMove);\n            window.removeEventListener('pointerup', handlePointerUp);\n            window.removeEventListener('pointercancel', handlePointerCancel);\n            window.removeEventListener('blur', handleWindowBlur);\n            document.body.style.cursor = previousCursor;\n            document.body.style.userSelect = previousUserSelect;\n            resizeCleanupRef.current = null;\n        };\n        const handlePointerMove = (moveEvent: PointerEvent) => {\n            if (moveEvent.pointerId !== pointerId) return;\n            commitWidth(startWidth + startX - moveEvent.clientX);\n        };\n        const handlePointerUp = (upEvent: PointerEvent) => {\n            if (upEvent.pointerId !== pointerId) return;\n            commitWidth(startWidth + startX - upEvent.clientX, true);\n            cleanup();\n            setIsResizing(false);\n        };\n        const cancelResize = () => {\n            // A cancelled pointer may report clientX=0: keep the last valid width.\n            cleanup();\n            setIsResizing(false);\n        };\n        const handlePointerCancel = (cancelEvent: PointerEvent) => {\n            if (cancelEvent.pointerId === pointerId) cancelResize();\n        };\n        const handleWindowBlur = () => cancelResize();\n\n        resizeCleanupRef.current = cleanup;\n        setIsResizing(true);\n        document.body.style.cursor = 'col-resize';\n        document.body.style.userSelect = 'none';\n        window.addEventListener('pointermove', handlePointerMove);\n        window.addEventListener('pointerup', handlePointerUp);\n        window.addEventListener('pointercancel', handlePointerCancel);\n        window.addEventListener('blur', handleWindowBlur);\n    }, [commitWidth, resizable]);",
  );
  output = replaceOnce(
    output,
    "        style={panelStyle}\n        data-section={dataSection}>",
    "        ref={panelRef}\n        style={panelStyle}\n        data-section={dataSection}>",
  );
  output = replaceOnce(
    output,
    "                    aria-label={resizeAriaLabel}\n                    className={cn(",
    "                    aria-label={resizeAriaLabel}\n                    tabIndex={0}\n                    aria-valuemin={minWidthPx}\n                    aria-valuemax={maxWidthPx}\n                    aria-valuenow={panelWidthPx}\n                    className={cn(",
  );
  return replaceOnce(
    output,
    "                    onPointerDown={handleResizeStart}",
    "                    onPointerDown={handleResizeStart}\n                    onKeyDown={handleResizeKeyDown}\n                    onDoubleClick={resetWidth}",
  );
}
