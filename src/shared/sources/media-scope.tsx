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
 *
 * And a third, `MediaIntake`: what the tool can TAKE IN, many at a time —
 * Trips' open piece taking pictures as new slides. A verb of `MediaActions`
 * runs with the picture ACTIVE, which in an editor that follows the Library
 * (Trips' slide) means "put it on what is open"; an intake is handed the
 * files and nothing is activated, so adding never replaces.
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
  /**
   * The wider span this one belongs to, when there is one worth drawing — a
   * trip's two dates around a piece's day. Only a MARK: the sidebar shades it
   * in its month so the days around the one open read against the whole, and
   * lists nothing by it. Absent says nothing.
   */
  within?: { from: string; to: string; label: string };
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
/**
 * What the sheet was SHOWING when a verb was pressed (R6 of
 * `docs/capture-renditions.md`): the capture's rendition on screen, as a roll
 * stores it — `delivered:<name>`, or null for the one the picture opens on.
 * The lightbox writes nothing itself; the verb is what carries a look at the
 * camera's JPEG or the render inside the ARW into the tool it opens.
 */
export interface MediaView {
  rendition: string | null;
}

export interface MediaAction {
  /** The publisher's own key — 'reel', 'carousel'. */
  id: string;
  /** The button's word: "Reel". */
  label: string;
  /** What it makes, one line, on the button's title. */
  hint?: string;
  /** Called with the media already active; `view` says which of its files was on screen. */
  run: (view?: MediaView) => void;
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

/** How a batch handed to an intake lands. */
export interface IntakeOptions {
  /** Make the pictures ONE item rather than one each — a collage, in Trips. */
  together?: boolean;
  /** Land right after what is open rather than at the end. */
  afterOpen?: boolean;
}

/** One item of the work an intake fills — a slide of Trips' piece — as the shell draws it small. */
export interface IntakeItem {
  key: string;
  /** Its number in the work, or null for an item that is not a picture's (the closing card). */
  number: number | null;
  /** A small picture of it, or null while there is none. */
  thumb: string | null;
  /** The one the tool has open. */
  open: boolean;
  /** Added through the intake this session. */
  fresh: boolean;
}

/**
 * What the active tool can TAKE IN from the Library, one picture or a ticked
 * handful: Trips' piece taking them as new slides.
 *
 * The shell draws it everywhere a picture is offered — a ＋ on a tile, a
 * verb in the sheet that shows one large, a Select mode with one verb at its
 * foot — and hands `add` the FILES, fetched into the pool first when an
 * instance holds them, without ever activating one: the tool's editor follows
 * the Library's active asset, and an add that activated would also replace
 * the picture on screen. Everything is said in the publisher's words, the
 * same reason a scope owns its label.
 */
export interface MediaIntake {
  /** Who takes them — "Trips". */
  publisher: string;
  /** What one picture becomes, singular — "slide". */
  noun: string;
  /**
   * Where a picture already sits in the work, 1-based — "slide 3" — or null.
   * By BASE name, case-insensitive: an instance's proxy is not named like its
   * original, and the base is what both share.
   */
  placeOf: (baseName: string) => number | null;
  /** The number the next picture added gets. */
  next: number;
  /** Whether the item holding this picture was added through here, and may be taken back. */
  removable: (baseName: string) => boolean;
  /** Take these in, in this order. */
  add: (files: readonly File[], options?: IntakeOptions) => Promise<void>;
  /** Take back what `add` made for this picture — only what `removable` says. */
  remove: (baseName: string) => void;
  /** Why nothing can be taken in right now, or null. */
  locked: string | null;
  /** Several pictures as ONE item — its word and how many it holds — or null when the tool has none. */
  together: { word: string; max: number } | null;
  /** How "after the open one" is said — "After slide 2" — or null when nothing is open. */
  afterOpen: string | null;
  /** What the work is called, said over its items — "This piece". */
  title: string;
  /**
   * The work as it stands, for the shell to draw small where it covers the
   * tool (a phone's sheet over the stage): adding is only worth it if the
   * result is seen growing.
   */
  items: readonly IntakeItem[];
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
    (a.intent ?? 'browse') === (b.intent ?? 'browse') &&
    a.within?.from === b.within?.from &&
    a.within?.to === b.within?.to &&
    a.within?.label === b.within?.label
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
  intake: MediaIntake | null;
  publishIntake: (intake: MediaIntake | null) => void;
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
  const [intake, setIntake] = useState<MediaIntake | null>(null);
  const value = useMemo(
    () => ({ scope, publish, actions, publishActions: setActions, intake, publishIntake: setIntake }),
    [scope, publish, actions, intake],
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

/** The shell's side: what the active tool takes in from the Library, or null. */
export function useMediaIntake(): MediaIntake | null {
  const ctx = useContext(MediaScopeContext);
  return ctx?.intake ?? null;
}

/**
 * The tool's side of the intake: publish a MEMOISED record (or null) and it
 * is taken back on unmount, so no tile offers to add to a piece nobody has
 * open any more.
 */
export function usePublishMediaIntake(intake: MediaIntake | null): void {
  const ctx = useContext(MediaScopeContext);
  const publish = ctx?.publishIntake;
  useEffect(() => {
    if (!publish) return;
    publish(intake);
    return () => publish(null);
  }, [publish, intake]);
}
