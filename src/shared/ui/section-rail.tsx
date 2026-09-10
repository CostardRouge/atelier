/**
 * The active tool's own sections, told to the shell.
 *
 * The Studio has five (Overlay, Style, Grade, Info, Export) and Road Trip
 * four (Content, Look, Picture, Export). On a desktop they are tabs at the top
 * of the inspector, where there is room for them. On a phone the inspector is
 * not a column at all — it is a sheet — so its tabs have nowhere to live, and
 * the place a hand can actually reach them is the bottom of the screen.
 *
 * So a tool PUBLISHES its sections and the shell DRAWS them, exactly like
 * `media-scope.tsx`: the bar belongs to the shell, what is in it belongs to
 * the tool, and `shared/` still never learns about `tools/`.
 *
 * Deliberately not a slot the shell renders into. A tool that hands over a
 * list of `{ id, label }` and a callback cannot accidentally reach into the
 * shell's layout, and the same list is what its own tab strip renders from at
 * a wider width — one declaration, two placements, never two lists that drift.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface Section {
  /** The tool's own key — 'overlay', 'look'. */
  id: string;
  /** The cell's word. Kept SHORT: five of them share a phone's width. */
  label: string;
}

export interface SectionBar {
  sections: readonly Section[];
  /** Which one is open, by id. */
  active: string;
  /** Called with a section's id when a cell is tapped. */
  onSelect: (id: string) => void;
  /** What the bar is for, on the nav's accessible name — "Studio inspector". */
  label: string;
}

interface SectionBarState {
  bar: SectionBar | null;
  publish: (bar: SectionBar | null) => void;
}

const SectionBarContext = createContext<SectionBarState | null>(null);

export function SectionBarProvider({ children }: { children: ReactNode }) {
  // Compared by IDENTITY, never field by field: the record carries a callback,
  // so the publisher is the one that memoises. Same contract as `MediaActions`,
  // and for the same reason — a closure defeats any equality we could write.
  const [bar, setBar] = useState<SectionBar | null>(null);
  const value = useMemo(() => ({ bar, publish: setBar }), [bar]);
  return <SectionBarContext.Provider value={value}>{children}</SectionBarContext.Provider>;
}

/** The shell's side: the sections to draw, or null to draw no bar at all. */
export function useSectionBar(): SectionBar | null {
  return useContext(SectionBarContext)?.bar ?? null;
}

/**
 * The tool's side: publish a MEMOISED bar (or null to offer none) and it is
 * taken back on unmount, so the shell never draws sections for a screen
 * nobody is on any more.
 *
 * Tolerant of a missing provider, like every other publish in the suite: a
 * tool mounted in a test publishes into the void rather than throwing.
 */
export function usePublishSectionBar(bar: SectionBar | null): void {
  const publish = useContext(SectionBarContext)?.publish;
  useEffect(() => {
    if (!publish) return;
    publish(bar);
    return () => publish(null);
  }, [publish, bar]);
}
