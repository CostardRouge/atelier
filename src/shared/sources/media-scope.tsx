/**
 * What the active tool is working on, told to the shell.
 *
 * The Library sidebar can show a connected source's media for a span of
 * days — a Road Trip piece's day, a leg — but the sidebar belongs to the
 * shell and a tool must not be reached into for its state (`architecture.md`,
 * «Remote sources are the shell's business»). So the tool PUBLISHES the span
 * here and the shell READS it: the same direction as the asset library, in
 * reverse, and the tool→shell twin of the route hop two tools use between
 * themselves. `shared/` stays free of `tools/`.
 *
 * Deliberately a plain span of `YYYY-MM-DD` strings, not Road Trip's
 * `IsoDate`: a generic seam must not take the shape of one tool. Whoever
 * publishes is responsible for the label — "12 Feb 2026", "Kalbarri leg" —
 * because only the publisher knows what the span means.
 *
 * Nothing here fetches anything. A published scope is a sentence about what
 * is open; what a source does with it is the sidebar's decision, and only
 * once the person has switched to that source's tab.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface MediaScope {
  /** Inclusive calendar span, `YYYY-MM-DD` each. */
  from: string;
  to: string;
  /** What to call it, as the publisher would: "12 Feb 2026". */
  label: string;
  /** Who is asking, for the sidebar to say — "Road Trip". */
  publisher: string;
  /**
   * What a click on one of the source's tiles MEANS while this is open.
   *
   * `pick` — something on screen is waiting for a picture (a piece's slide),
   * so a click should fetch it and make it active: the fastest path, and the
   * one the editor was built around. `browse` — nothing is waiting (a trip's
   * overview, a gallery, a day picked by hand), so a click should show the
   * picture large instead of downloading it, and the fetch becomes a button
   * inside that view.
   *
   * Only the publisher knows which it is, the same reason it owns the label.
   * Absent means `browse`: nobody said anything is waiting.
   */
  intent?: 'pick' | 'browse';
}

/** True when both name the same span with the same words. Pure. */
export function sameScope(a: MediaScope | null, b: MediaScope | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.label === b.label &&
    a.publisher === b.publisher &&
    (a.intent ?? 'browse') === (b.intent ?? 'browse')
  );
}

/** A single day is a span that starts where it ends. Pure. */
export function isSingleDay(scope: MediaScope): boolean {
  return scope.from === scope.to;
}

interface MediaScopeState {
  scope: MediaScope | null;
  publish: (scope: MediaScope | null) => void;
}

const MediaScopeContext = createContext<MediaScopeState | null>(null);

export function MediaScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<MediaScope | null>(null);
  const publish = useCallback((next: MediaScope | null) => {
    setScope((cur) => (sameScope(cur, next) ? cur : next));
  }, []);
  const value = useMemo(() => ({ scope, publish }), [scope, publish]);
  return <MediaScopeContext.Provider value={value}>{children}</MediaScopeContext.Provider>;
}

/** The shell's side: what the active tool is on, or null. */
export function useMediaScope(): MediaScope | null {
  const ctx = useContext(MediaScopeContext);
  return ctx?.scope ?? null;
}

/**
 * The tool's side: say what is open, and take it back on unmount so the
 * sidebar never keeps showing a day nobody is looking at. Pass a memoised
 * scope (or null to say nothing); the provider ignores a publish that
 * changes no field, so re-renders do not churn the sidebar.
 *
 * Tolerant of a missing provider — a tool mounted in a test, or in a shell
 * that has not opted in, publishes into the void rather than throwing.
 */
export function usePublishMediaScope(scope: MediaScope | null): void {
  const ctx = useContext(MediaScopeContext);
  const publish = ctx?.publish;
  useEffect(() => {
    if (!publish) return;
    publish(scope);
    return () => publish(null);
  }, [publish, scope]);
}
