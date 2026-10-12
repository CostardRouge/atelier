/**
 * Made-up material for the agent's SCREENS — what the bench in `#/agents`
 * draws them from, with no Winnow and no photograph of anyone's: sheets of
 * synthetic tiles described by shape and hue, and sum-ups written as numbers.
 * Each set is a CASE a designer judges the screen on: the ordinary one, and
 * the edges — one picture, a full page, broken thumbnails, long names, a year
 * with no position, nothing dated.
 *
 * Pure: data only. The tiles are painted by `render.ts`.
 */

import { libraryStats, type LibraryStats } from '../../sources/winnow/stats';
import { SHEET_MAX } from '../contact-sheet';

/** One tile of a made-up sheet: its shape, its colour, what is written under it. */
export interface FixtureTile {
  /** Width / height. */
  aspect: number;
  /** The tile's hue, 0–360; null paints a grey tile. */
  hue: number | null;
  label: string;
  mark?: string;
  /** The thumbnail that would not decode: drawn as an empty box. */
  broken?: boolean;
  /** A round face crop instead of a landscape — the people sheet. */
  face?: boolean;
}

export interface FixtureSheet {
  tiles: FixtureTile[];
  note: string;
}

const SHAPES = [1.5, 1.5, 0.667, 1.778, 1, 1.333, 0.75, 1.5];
const MARKS = ['pick ★4', undefined, 'reject', 'pick ★5 red', undefined, '★2', undefined, 'skip'];

/** `n` tiles of mixed shapes and culling, ids from 1201. */
function tiles(n: number): FixtureTile[] {
  return Array.from({ length: n }, (_, i) => ({
    aspect: SHAPES[i % SHAPES.length],
    hue: (i * 47) % 360,
    label: `#${1201 + i}`,
    mark: MARKS[i % MARKS.length],
  }));
}

export const SHEETS: Record<'day' | 'one' | 'full' | 'long' | 'broken' | 'roll' | 'compare' | 'people', FixtureSheet> = {
  day: { tiles: tiles(12), note: 'page 1 of 1 · 12 matched · labels are Winnow asset ids' },
  one: { tiles: tiles(1), note: '1 media · labels are Winnow asset ids' },
  full: { tiles: tiles(SHEET_MAX), note: `page 1 of 3 · ${SHEET_MAX * 3 - 7} matched · labels are Winnow asset ids` },
  long: {
    tiles: tiles(6).map((t, i) => ({ ...t, label: i % 2 ? `#${t.label.slice(1)} DSC09876-Edit-Final-v3.HIF` : t.label, mark: 'pick ★5 purple · edited · sent home' })),
    note: 'page 1 of 1 · 6 matched · a very long note to see where the caption of a sheet stops being read by anyone at all',
  },
  broken: { tiles: tiles(8).map((t, i) => ({ ...t, broken: i % 3 === 1 })), note: '8 media · three thumbnails would not decode' },
  roll: {
    tiles: tiles(10).map((t, i) => ({ ...t, label: `${i + 1}`, mark: i % 3 === 0 ? 'edited' : undefined })),
    note: 'roll "Cairns — reef" · page 1 of 1 · 1 = picture #a1b2, 2 = #c3d4…',
  },
  compare: {
    tiles: [
      { aspect: 1.5, hue: null, label: 'before' },
      { aspect: 1.5, hue: 28, label: 'after' },
    ] as FixtureTile[],
    note: 'DSC0202.HIF · before ↔ after',
  },
  people: {
    tiles: [
      ['#3 Lucie', '412'],
      ['#7 Élodie', '388'],
      ['#2 Lucas', '201'],
      ['#11', '96'],
      ['#14 Jean-Baptiste de la Fontaine', '41'],
      ['#21', '12'],
    ].map(([label, mark], i) => ({ aspect: 1, hue: 20 + i * 9, label, mark, face: true })),
    note: 'page 1 of 1 · 6 people · labels are person ids and names, the number how many media show them',
  },
};

export type SheetFixtureId = keyof typeof SHEETS;

/** A made-up sum-up: the empty one with what a case needs written over it. */
function stats(over: Partial<LibraryStats>): LibraryStats {
  return { ...libraryStats([], () => null), ...over };
}

const HOURS_OF_A_YEAR = [3, 1, 0, 0, 2, 31, 140, 260, 310, 280, 240, 220, 190, 205, 230, 260, 330, 420, 510, 260, 90, 40, 18, 9];

export const STATS: Record<'year' | 'trip' | 'noGps' | 'long' | 'empty', { stats: LibraryStats; title: string; people: [string, number][] }> = {
  year: {
    title: '2026 — the year in pictures',
    people: [
      ['Lucie', 412],
      ['Élodie', 388],
      ['Lucas', 201],
    ],
    stats: stats({
      span: { from: '2026-01-01', to: '2026-12-29' },
      days: 214,
      media: { photo: 4012, video: 337, total: 4349 },
      videoSeconds: 9420,
      byGear: { camera: 2610, phone: 1120, drone: 540, action: 79 },
      byCamera: { 'SONY ILCE-7CM2': 2610, 'Apple iPhone 15 Pro': 1120, 'DJI FC8482': 540, 'GoPro HERO12 Black': 79 },
      byLens: { 'FE 20-70mm F4 G': 1810, 'FE 40mm F2.5 G': 520, 'FE 70-200mm F4 Macro G OSS II': 280 },
      byFocal: { '≤ 16 mm': 640, '17–35 mm': 1720, '36–70 mm': 1150, '71–200 mm': 420, '> 200 mm': 12 },
      byHour: HOURS_OF_A_YEAR,
      noHour: 120,
      byLight: { day: 2900, golden: 820, blue: 160, night: 210 },
      noLight: 259,
      byWeekday: { Mon: 480, Tue: 420, Wed: 455, Thu: 510, Fri: 590, Sat: 1010, Sun: 884 },
      byCountry: { AU: 2210, FR: 1430, MA: 520, ES: 77 },
      noCountry: 112,
      byVerdict: { pick: 610, reject: 1220, skip: 140, unrated: 2379 },
      withText: 318,
      byStars: [3600, 120, 210, 230, 140, 49],
      busiest: [
        { date: '2026-08-14', count: 212 },
        { date: '2026-08-15', count: 190 },
      ],
    }),
  },
  trip: {
    title: 'Queensland, two weeks',
    people: [],
    stats: stats({
      span: { from: '2026-01-02', to: '2026-01-15' },
      days: 14,
      media: { photo: 611, video: 42, total: 653 },
      videoSeconds: 1310,
      byGear: { camera: 380, drone: 160, phone: 113 },
      byCamera: { 'SONY ILCE-7CM2': 380, 'DJI FC8482': 160, 'Apple iPhone 15 Pro': 113 },
      byLens: { 'FE 20-70mm F4 G': 370 },
      byFocal: { '≤ 16 mm': 160, '17–35 mm': 300, '36–70 mm': 120 },
      byHour: HOURS_OF_A_YEAR.map((n) => Math.round(n / 7)),
      byLight: { day: 420, golden: 160, blue: 30 },
      noLight: 43,
      byWeekday: { Mon: 80, Tue: 90, Wed: 70, Thu: 100, Fri: 110, Sat: 120, Sun: 83 },
      byCountry: { AU: 640 },
      noCountry: 13,
      byVerdict: { pick: 120, unrated: 533 },
      byStars: [560, 10, 20, 30, 25, 8],
    }),
  },
  noGps: {
    title: 'A year with no position',
    people: [],
    stats: stats({
      span: { from: '2025-03-01', to: '2025-11-30' },
      days: 61,
      media: { photo: 980, video: 0, total: 980 },
      byGear: { camera: 980 },
      byCamera: { 'SONY ILCE-7CM2': 980 },
      byHour: HOURS_OF_A_YEAR.map((n) => Math.round(n / 4)),
      noLight: 980,
      byWeekday: { Sat: 500, Sun: 480 },
      noCountry: 980,
      byVerdict: { unrated: 980 },
      byStars: [980, 0, 0, 0, 0, 0],
    }),
  },
  long: {
    title: 'A title far too long for one line of a card that someone will share somewhere',
    people: [
      ['Jean-Baptiste de la Fontaine-Saint-Exupéry', 41],
      ['Marie-Anne', 12],
    ],
    stats: stats({
      span: { from: '2026-05-01', to: '2026-05-31' },
      days: 18,
      media: { photo: 240, video: 3, total: 243 },
      videoSeconds: 61,
      byGear: { camera: 243 },
      byCamera: { 'A camera named by hand in Winnow with a very long name': 200, 'SONY ILCE-7CM2': 43 },
      byLens: { 'FE 70-200mm F4 Macro G OSS II with a teleconverter 2x': 120 },
      byHour: HOURS_OF_A_YEAR.map((n) => Math.round(n / 20)),
      byWeekday: { Sat: 243 },
      byCountry: { FR: 243 },
      byVerdict: { pick: 30, unrated: 213 },
      byStars: [200, 0, 0, 13, 20, 10],
    }),
  },
  empty: {
    title: 'Nothing dated',
    people: [],
    stats: stats({}),
  },
};

export type StatsFixtureId = keyof typeof STATS;
