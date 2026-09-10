/**
 * The shell's side of {@link LayoutMode}: one pair of `matchMedia` listeners
 * for the whole app, published through a context so a tool reads a NAME
 * instead of re-deriving a breakpoint of its own.
 *
 * Same direction as `media-scope.tsx`, inverted: there a tool tells the shell
 * what it is on; here the shell tells every tool how much room it has. Either
 * way `shared/` never learns about `tools/`.
 *
 * Why a context rather than a hook each consumer calls: `matchMedia` listeners
 * are cheap but not free, and — more to the point — two consumers computing
 * the same boundary independently is exactly the drift this replaces. One
 * subscription, one answer, everybody re-renders together.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  atLeast,
  COMPACT_QUERY,
  MEDIUM_QUERY,
  modeForMatches,
  type LayoutMode,
} from './layout-mode';

const LayoutModeContext = createContext<LayoutMode | null>(null);

/** What the queries say right now — read once for the first render. */
function readMode(): LayoutMode {
  // SSR has no `matchMedia`, and neither does a node test environment. Compact
  // is the honest default: it is the layout that fits anywhere, so a wrong
  // guess costs a re-render, never a broken screen.
  if (typeof window === 'undefined' || !window.matchMedia) return 'compact';
  return modeForMatches(
    window.matchMedia(COMPACT_QUERY).matches,
    window.matchMedia(MEDIUM_QUERY).matches,
  );
}

export function LayoutModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LayoutMode>(readMode);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const compact = window.matchMedia(COMPACT_QUERY);
    const medium = window.matchMedia(MEDIUM_QUERY);
    // Both lists feed one answer, so both fire the same handler: a drag across
    // 1180 changes only `medium`, one across 820 changes both, and reading the
    // pair every time is what makes either order of events land correctly.
    const sync = () => setMode(modeForMatches(compact.matches, medium.matches));
    sync();
    compact.addEventListener('change', sync);
    medium.addEventListener('change', sync);
    return () => {
      compact.removeEventListener('change', sync);
      medium.removeEventListener('change', sync);
    };
  }, []);

  return <LayoutModeContext.Provider value={mode}>{children}</LayoutModeContext.Provider>;
}

/**
 * How much room the shell has. Tolerant of a missing provider — a component
 * mounted in a test or a throwaway harness gets `expanded`, the layout that
 * assumes the least about being wrapped in anything.
 */
export function useLayoutMode(): LayoutMode {
  return useContext(LayoutModeContext) ?? 'expanded';
}

/** `useAtLeast('medium')` — "there is more room here than a phone". */
export function useAtLeast(min: LayoutMode): boolean {
  const mode = useLayoutMode();
  return useMemo(() => atLeast(mode, min), [mode, min]);
}

/** True on a phone-sized shell: one surface at a time, sections in the bar. */
export function useIsCompact(): boolean {
  return useLayoutMode() === 'compact';
}
