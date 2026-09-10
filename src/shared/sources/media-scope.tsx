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
 *
 * The same seam carries a second thing, `MediaActions`: what the tool can
 * START from a picture the shell is showing large. One publisher, one
 * direction, two sentences — "the day I am on" and "what a picture of it is
 * worth making".
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
  /** Who is asking, for the sidebar to say — "Trips". */
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

/**
 * One thing the active tool can START from a media — "a reel from this
 * picture", "a carousel from this one".
 *
 * The same direction as the scope, and for the same reason: the sheet that
 * shows a picture large belongs to the shell, and what is worth making out of
 * that picture is the tool's business alone. So the tool publishes the verbs
 * and the shell draws them where a picture is being looked at.
 *
 * `run` is called with the media already in the library and ACTIVE — the shell
 * fetches it from an instance first when it has to. That is what keeps this
 * seam thin: the publisher never learns where the bytes came from, and the
 * picture reaches the new piece by the one path that already existed (the
 * Library's active asset), not by a second one.
 */
export interface MediaAction {
  /** The publisher's own key — 'reel', 'carousel'. */
  id: string;
  /** The button's word: "Reel". */
  label: string;
  /** What it makes, one line, on the button's title. */
  hint?: string;
  run: () => void;
}

export interface MediaActions {
  /**
   * What the row says over the buttons, as the publisher would — "Start a
   * piece on 12 Feb 2026". Only the publisher knows what its verbs do, the
   * same reason the scope owns its label.
   */
  heading: string;
  actions: readonly MediaAction[];
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
  actions: MediaActions | null;
  publishActions: (actions: MediaActions | null) => void;
}

const MediaScopeContext = createContext<MediaScopeState | null>(null);

export function MediaScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<MediaScope | null>(null);
  const publish = useCallback((next: MediaScope | null) => {
    setScope((cur) => (sameScope(cur, next) ? cur : next));
  }, []);
  // The verbs carry closures, so they are compared by identity and the
  // publisher is the one that memoises — the same contract as the scope,
  // without the field-by-field equality a function would defeat.
  const [actions, setActions] = useState<MediaActions | null>(null);
  const value = useMemo(
    () => ({ scope, publish, actions, publishActions: setActions }),
    [scope, publish, actions],
  );
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

/** The shell's side: what the active tool offers to make from a media. */
export function useMediaActions(): MediaActions | null {
  const ctx = useContext(MediaScopeContext);
  return ctx?.actions ?? null;
}

/**
 * The tool's side of the verbs: publish a MEMOISED record (or null to offer
 * nothing) and it is taken back on unmount, so a sheet never offers to start
 * something on a screen nobody is on any more.
 */
export function usePublishMediaActions(actions: MediaActions | null): void {
  const ctx = useContext(MediaScopeContext);
  const publish = ctx?.publishActions;
  useEffect(() => {
    if (!publish) return;
    publish(actions);
    return () => publish(null);
  }, [publish, actions]);
}
