/**
 * How much of a phone's screen the shell keeps for itself, told by the tool.
 *
 * On a compact shell a tool screen is the masthead (48 pt: `Atelier / tool`,
 * the theme, the source, GitHub), the tool, then the bottom bar. An EDITOR
 * that wants the photograph to have the screen (Develop, 2026-10-20, his pick
 * C of the space lab https://claude.ai/artifact/GunaDcNsUtVM3nW1xiyQ2V)
 * publishes `immersive`: the shell then draws no masthead at all, lays its
 * bottom bar OVER the tool in glass while the tool says `floating` (and in its
 * row under the tool otherwise), and hides that bar when the tool says its
 * chrome is `hidden` (a tap on the picture, Focus).
 *
 * What the masthead held does not disappear — the shell hands it back as
 * `ShellExtras`: menu items (theme, sources, every tool, home, GitHub) the
 * tool appends to its own ⋯, and the pills (a task running, an agent
 * connected) it draws in its own header. So the way to the rest of the suite
 * is one ⋯ away on every immersive screen, and a running task still shows.
 *
 * The same shape as `section-rail.tsx`: the tool publishes a memoised record,
 * the shell draws, and `shared/` never learns about `tools/`.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OverflowItem } from './OverflowMenu';

/**
 * The one look of something an immersive screen lays OVER its picture — the
 * bottom bar, an editor's header, its verbs: paper that lets the picture
 * through, blurred so a word over a busy sky still reads.
 */
export const GLASS = 'bg-surface/86 backdrop-blur-[6px]';

export interface ShellChrome {
  /** The masthead goes. Compact shells only. */
  immersive: boolean;
  /**
   * The bottom bar is laid OVER the tool, in glass — while a picture is
   * browsed. Otherwise (a panel up) it keeps its row under the tool.
   */
  floating: boolean;
  /** The tool's chrome is hidden: the bottom bar goes with it. */
  hidden: boolean;
  /**
   * What lies behind the tool, up to the screen's edges and under the
   * Dynamic Island: `frame` is the stage's black, for an editor whose picture
   * must be judged against it (Develop, 2026-10-21). The shell paints its
   * frame and its `theme-color` with it while the tool is immersive.
   */
  backdrop?: 'frame';
}

interface ShellChromeState {
  chrome: ShellChrome | null;
  publish: (chrome: ShellChrome | null) => void;
}

const ShellChromeContext = createContext<ShellChromeState | null>(null);

export function ShellChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<ShellChrome | null>(null);
  const value = useMemo(() => ({ chrome, publish: setChrome }), [chrome]);
  return <ShellChromeContext.Provider value={value}>{children}</ShellChromeContext.Provider>;
}

/** The shell's side: what the active tool asked for, or null. */
export function useShellChrome(): ShellChrome | null {
  return useContext(ShellChromeContext)?.chrome ?? null;
}

/**
 * The tool's side: publish a MEMOISED record (or null), taken back on
 * unmount. Tolerant of a missing provider, like every publish in the suite.
 */
export function usePublishShellChrome(chrome: ShellChrome | null): void {
  const publish = useContext(ShellChromeContext)?.publish;
  useEffect(() => {
    if (!publish) return;
    publish(chrome);
    return () => publish(null);
  }, [publish, chrome]);
}

/** What the masthead held, handed to an immersive tool to draw in its own header. */
export interface ShellExtras {
  /** The masthead's verbs as menu items, for the tool's ⋯ — after its own. */
  menu: readonly OverflowItem[];
  /** The masthead's status pills (a task, an agent); draws nothing when idle. */
  pills: ReactNode;
}

const ShellExtrasContext = createContext<ShellExtras | null>(null);

export const ShellExtrasProvider = ShellExtrasContext.Provider;

/** Null outside the shell (a test), where a tool's ⋯ simply has nothing to add. */
export function useShellExtras(): ShellExtras | null {
  return useContext(ShellExtrasContext);
}
