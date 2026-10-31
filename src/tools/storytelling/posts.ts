import type { PostSkeleton } from '../../shared/story/story-script';

/**
 * The series, in order — the public half of every post (`story-script.ts`):
 * which blocks it plays, how long each lasts, when its caption speaks. The
 * words, numbers and places are the author's private script, loaded in the
 * tool. A new post starts as a copy of the one before it and may grow blocks
 * of its own; the order here is what the continuity follows (the ending
 * names the next post and shows its cover).
 */
export const POSTS: readonly PostSkeleton[] = [
  {
    id: 'ep00',
    number: 'EP.00',
    season: 1,
    blocks: [
      { block: 'wall', len: 4.4, cap: { a: 0.5, b: 3.9 } },
      { block: 'map-camera', len: 5.2, cap: { a: 0.5, b: 4.7 } },
      { block: 'folders', len: 5.6, cap: { a: 0.5, b: 5.1 } },
    ],
  },
  {
    id: 'ep01',
    number: 'EP.01',
    season: 1,
    blocks: [
      { block: 'gear', len: 4.5, cap: { a: 0.5, b: 4 } },
      { block: 'transfer', len: 5.5, cap: { a: 0.5, b: 5 } },
      { block: 'counter', len: 4.5, cap: { a: 0.5, b: 4 } },
      { block: 'folders', len: 5, cap: { a: 0.5, b: 4.5 } },
    ],
  },
  {
    id: 'ep02',
    number: 'EP.02',
    season: 1,
    blocks: [
      { block: 'folders', len: 5, cap: { a: 0.5, b: 4.5 } },
      { block: 'app', len: 5, cap: { a: 0.5, b: 4.5 } },
      { block: 'folders', len: 5.5, cap: { a: 0.5, b: 5 } },
      { block: 'before-after', len: 4.5, cap: { a: 0.5, b: 4 } },
    ],
  },
  {
    id: 'ep03',
    number: 'EP.03',
    season: 1,
    blocks: [
      { block: 'clocks', len: 6, cap: { a: 0.5, b: 5.5 } },
      { block: 'journey-impossible', len: 5.5, cap: { a: 0.5, b: 5 } },
      { block: 'app', len: 5, cap: { a: 0.5, b: 4.5 } },
      { block: 'before-after', len: 4.5, cap: { a: 0.5, b: 4 } },
    ],
  },
  {
    id: 'ep04',
    number: 'EP.04',
    season: 1,
    blocks: [
      { block: 'map-holes', len: 6, cap: { a: 0.5, b: 5.5 } },
      { block: 'map-holes', len: 6, cap: { a: 0.5, b: 5.5 } },
      { block: 'names', len: 5, cap: { a: 0.5, b: 4.5 } },
      { block: 'counter', len: 4.5, cap: { a: 0.5, b: 4 } },
    ],
  },
  {
    id: 'ep05',
    number: 'EP.05',
    season: 1,
    blocks: [
      { block: 'wall', len: 4.5, cap: { a: 0.5, b: 4 } },
      { block: 'app', len: 5.5, cap: { a: 0.5, b: 5 } },
      { block: 'bursts', len: 5, cap: { a: 0.5, b: 4.5 } },
      { block: 'app', len: 5, cap: { a: 0.5, b: 4.5 } },
    ],
  },
  {
    id: 'ep06',
    number: 'EP.06',
    season: 1,
    blocks: [
      { block: 'counter', len: 5, cap: { a: 0.5, b: 4.5 } },
      { block: 'app', len: 5, cap: { a: 0.5, b: 4.5 } },
      { block: 'map-camera', len: 5.5, cap: { a: 0.5, b: 5 } },
      { block: 'before-after', len: 4.5, cap: { a: 0.5, b: 4 } },
    ],
  },
  {
    id: 'ep07',
    number: 'EP.07',
    season: 1,
    blocks: [
      { block: 'card-recovery', len: 5.5, cap: { a: 0.5, b: 5 } },
      { block: 'counter', len: 4, cap: { a: 0.5, b: 3.5 } },
      { block: 'before-after', len: 4.5, cap: { a: 0.5, b: 4 } },
    ],
  },
  {
    id: 'final',
    number: 'FIN',
    season: 1,
    blocks: [
      { block: 'map-camera', len: 6, cap: { a: 0.5, b: 5.5 } },
      { block: 'season-recap', len: 7, cap: { a: 0.5, b: 6.5 } },
      { block: 'counter', len: 4, cap: { a: 0.5, b: 3.5 } },
    ],
  },
];
