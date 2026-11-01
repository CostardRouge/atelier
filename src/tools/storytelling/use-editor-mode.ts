import { useLayoutEffect, useState, type RefObject } from 'react';

/** How the post editor lays itself out: three columns, two, or one above the other. */
export type EditorMode = 'wide' | 'medium' | 'narrow';
/** What the inspector shows where the list or the timeline has no place of its own. */
export type Pane = 'list' | 'settings' | 'timeline';

/** The mode for the editor's own width, px: the list gets a column from 1100, the inspector from 760. (pure) */
export const editorModeFor = (width: number): EditorMode => (width >= 1100 ? 'wide' : width >= 760 ? 'medium' : 'narrow');

/**
 * The editor's mode, from ITS width rather than the viewport's — the library
 * docked beside it takes room no media query sees (`frontend.md`, « The
 * shell wears THREE layouts »). Measured, so the columns are a JS decision the
 * panels can follow (which tab exists, where the timeline goes).
 */
export function useEditorMode(ref: RefObject<HTMLElement>): EditorMode {
  const [mode, setMode] = useState<EditorMode>('wide');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setMode(editorModeFor(el.getBoundingClientRect().width));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return mode;
}
