/**
 * The layouts a slide can pick from — a registry, so a document stores an ID
 * and the geometry can be tuned without a migration. Grouped the way the
 * picker shows them; the order here is the order on the shelf.
 *
 * Every entry is resolvable at any frame shape: a test walks the whole list at
 * 9:16, 4:5 and 1:1 and checks each cell lands inside the frame.
 */

import { cellCount, type LayoutTemplate } from './media-layout';

export type LayoutGroup = 'Grid' | 'Stack' | 'Bento' | 'Inset' | 'Free';

export interface LayoutTemplateEntry {
  id: string;
  name: string;
  group: LayoutGroup;
  template: LayoutTemplate;
}

const grid = (cols: number[], rows: number[], areas: string): LayoutTemplate => ({
  kind: 'tracks',
  cols,
  rows,
  areas,
});

export const LAYOUT_TEMPLATES: readonly LayoutTemplateEntry[] = [
  { id: 'grid-2x2', name: '2 × 2', group: 'Grid', template: grid([1, 1], [1, 1], 'a b / c d') },
  { id: 'grid-2x3', name: '2 × 3', group: 'Grid', template: grid([1, 1], [1, 1, 1], 'a b / c d / e f') },
  {
    id: 'grid-3x3',
    name: '3 × 3',
    group: 'Grid',
    template: grid([1, 1, 1], [1, 1, 1], 'a b c / d e f / g h i'),
  },
  { id: 'grid-1x4', name: '1 × 4', group: 'Grid', template: grid([1], [1, 1, 1, 1], 'a / b / c / d') },
  { id: 'stack-2', name: 'Two rows', group: 'Stack', template: grid([1], [1, 1], 'a / b') },
  { id: 'stack-3', name: 'Three rows', group: 'Stack', template: grid([1], [1, 1, 1], 'a / b / c') },
  { id: 'stack-tall', name: 'Tall top', group: 'Stack', template: grid([1], [3, 2], 'a / b') },
  { id: 'stack-cols', name: 'Two columns', group: 'Stack', template: grid([1, 1], [1], 'a b') },
  {
    id: 'bento-hero',
    name: 'Hero + 3',
    group: 'Bento',
    template: grid([2, 1], [2, 1, 1], 'a b / a c / d d'),
  },
  {
    id: 'bento-six',
    name: 'Six-piece',
    group: 'Bento',
    template: grid([1, 1, 1], [1, 1, 1, 1], 'a a b / a a c / d e e / d f f'),
  },
  { id: 'bento-band', name: 'Band', group: 'Bento', template: grid([1, 1], [1, 1.3, 1], 'a b / c c / d e') },
  {
    id: 'bento-l',
    name: 'Corner L',
    group: 'Bento',
    template: grid([1, 1, 1], [1, 1, 1], 'a a a / b c c / b c c'),
  },
  {
    id: 'inset-1',
    name: 'Inset',
    group: 'Inset',
    template: { kind: 'inset', insets: [{ corner: 'br', width: 0.42, aspect: 4 / 5 }] },
  },
  {
    id: 'inset-2',
    name: 'Two insets',
    group: 'Inset',
    template: {
      kind: 'inset',
      insets: [
        { corner: 'tl', width: 0.34, aspect: 1 },
        { corner: 'br', width: 0.42, aspect: 4 / 5 },
      ],
    },
  },
  {
    id: 'prints-3',
    name: 'Prints',
    group: 'Free',
    template: {
      kind: 'free',
      prints: [
        { cx: 0.38, cy: 0.25, width: 0.64, aspect: 4 / 5, rotation: -6 },
        { cx: 0.62, cy: 0.52, width: 0.6, aspect: 1, rotation: 5 },
        { cx: 0.42, cy: 0.78, width: 0.66, aspect: 5 / 4, rotation: -3 },
      ],
    },
  },
  {
    id: 'prints-4',
    name: 'Pile',
    group: 'Free',
    template: {
      kind: 'free',
      prints: [
        { cx: 0.32, cy: 0.24, width: 0.5, aspect: 4 / 5, rotation: -8 },
        { cx: 0.7, cy: 0.33, width: 0.48, aspect: 4 / 5, rotation: 7 },
        { cx: 0.34, cy: 0.62, width: 0.5, aspect: 1, rotation: 4 },
        { cx: 0.66, cy: 0.78, width: 0.52, aspect: 5 / 4, rotation: -5 },
      ],
    },
  },
];

export const LAYOUT_GROUPS: readonly LayoutGroup[] = ['Grid', 'Stack', 'Bento', 'Inset', 'Free'];

const byId = new Map(LAYOUT_TEMPLATES.map((entry) => [entry.id, entry]));

/** The entry for an id, or null — a stored id the registry no longer has resolves to no layout. */
export function layoutTemplate(id: string | null | undefined): LayoutTemplateEntry | null {
  return (id && byId.get(id)) || null;
}

export function isLayoutId(id: unknown): id is string {
  return typeof id === 'string' && byId.has(id);
}

/** How many cells a layout id resolves to; 0 for an unknown id. */
export function layoutCellCount(id: string | null | undefined): number {
  const entry = layoutTemplate(id);
  return entry ? cellCount(entry.template) : 0;
}
