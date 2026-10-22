/**
 * Where a column of sections was scrolled to, said so that it SURVIVES a
 * different column: the section at the top of the view and how far into it,
 * rather than a bare pixel count. Develop's inspector is built anew for each
 * picture (`RollEditor` keys the workbench on the picture), and a RAW grows
 * blocks a JPEG has not — the same pixels would land on another setting; the
 * same section and offset land on the one the hand was on (2026-10-22, his
 * «un inspecteur toujours au même endroit»). Pure and DOM-free.
 */

/** A section of the column: its id and its top, in the scroller's content pixels. */
export interface SectionBox {
  id: string;
  top: number;
}

export interface ScrollAnchor {
  /** The section at the top of the view, or null above the first one. */
  id: string | null;
  /** How far past that section's top the view starts. */
  offset: number;
  /** The bare position, for a column that lacks the section. */
  top: number;
}

/** The anchor of a column scrolled to `scrollTop`: the last section starting at or above it. */
export function anchorOf(scrollTop: number, sections: readonly SectionBox[]): ScrollAnchor {
  let at: SectionBox | null = null;
  for (const s of sections) {
    if (s.top <= scrollTop + 0.5) at = s;
    else break;
  }
  return at ? { id: at.id, offset: scrollTop - at.top, top: scrollTop } : { id: null, offset: 0, top: scrollTop };
}

/** Where to scroll a column so that it shows what `anchor` was on: its section and offset, else the bare position. */
export function anchorTop(anchor: ScrollAnchor, sections: readonly SectionBox[]): number {
  const s = anchor.id === null ? undefined : sections.find((x) => x.id === anchor.id);
  return Math.max(0, s ? s.top + anchor.offset : anchor.top);
}
