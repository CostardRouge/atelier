/**
 * The pure half of the font picker (`FontPicker.tsx`): what a face is to the
 * picker, how a list is grouped and searched, which row the keys land on, and
 * the CSS a row is written in. DOM-free and tested.
 */

/** One face the picker offers — a face of the suite, a role that names one, or a system font. */
export interface FontChoice {
  /** What `onChange` gives back: a face id, a role (`@title`), a family name. */
  id: string;
  /** Its name in the list, written in the face itself. */
  label: string;
  /** The CSS family list the row and the trigger are written in, the face first. */
  family: string;
  /** The weights it ships; the row shows the one nearest the field's. */
  weights: readonly number[];
  italic?: boolean;
  /** The heading it is listed under; groups keep the order they first appear in. */
  group: string;
  /** What the row says on its right instead of its weights (`role`, `system`). */
  note?: string;
  /** A system font: nothing to load, always drawn. */
  system?: boolean;
}

export interface FontGroup {
  group: string;
  items: { choice: FontChoice; index: number }[];
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * The choices matching `query` (in the name or the group, accents and case
 * ignored), grouped in the order the groups first appear, each with its index
 * in the flat list the keys move through.
 */
export function fontGroups(options: readonly FontChoice[], query = ''): FontGroup[] {
  const q = fold(query.trim());
  const groups: FontGroup[] = [];
  let index = 0;
  for (const choice of options) {
    if (q && !fold(choice.label).includes(q) && !fold(choice.group).includes(q)) continue;
    let g = groups.find((x) => x.group === choice.group);
    if (!g) groups.push((g = { group: choice.group, items: [] }));
    g.items.push({ choice, index: -1 });
  }
  // Indices follow the order the rows are DRAWN in (group by group), which is what ↑ and ↓ walk.
  for (const g of groups) for (const it of g.items) it.index = index++;
  return groups;
}

/** The rows in drawn order. */
export const flatRows = (groups: readonly FontGroup[]): FontChoice[] => groups.flatMap((g) => g.items.map((i) => i.choice));

/** The weight a face ships nearest the one asked for. */
export function nearestShipped(weights: readonly number[], w: number): number {
  if (!weights.length) return w;
  return weights.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), weights[0]);
}

/** The CSS `font` shorthand a row of `choice` is written in at `px`. */
export function fontCss(choice: FontChoice, weight: number, px: number): string {
  return `${choice.italic ? 'italic ' : ''}${nearestShipped(choice.weights, weight)} ${px}px ${choice.family}`;
}

/** The string `document.fonts.load` / `check` take for `choice` — one weight is enough to see the face. */
export function fontProbe(choice: FontChoice, weight: number): string {
  return fontCss(choice, weight, 20);
}

export type PickerKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp';
const PAGE = 6;

/** Where the active row goes for a key, in a list of `count` rows (−1 = none active). Stops at the ends. */
export function stepActive(active: number, count: number, key: PickerKey): number {
  if (count <= 0) return -1;
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return active < 0 ? 0 : Math.min(last, active + 1);
    case 'ArrowUp':
      return active < 0 ? last : Math.max(0, active - 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'PageDown':
      return Math.min(last, Math.max(0, active) + PAGE);
    case 'PageUp':
      return Math.max(0, Math.max(0, active) - PAGE);
  }
}

/** The meta a row shows on its right: its note, else its weights. */
export const fontMeta = (choice: FontChoice): string => choice.note ?? choice.weights.join(' · ');
