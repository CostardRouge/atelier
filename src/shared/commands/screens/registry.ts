/**
 * The SCREENS an agent receives from Atelier — the images a command answers
 * with that Atelier DRAWS, as opposed to the captures (`develop.snapshot`,
 * `trips.snapshot`), which are the photograph or the slide as exported and
 * have no design of their own. One entry per painter: what it is for, the
 * commands that answer with it, the widths it can be drawn at, and its CASES
 * — the ordinary ones and the edges a designer must see before trusting it.
 *
 * The bench in `#/agents` lists this registry and draws every case through
 * `render.ts`, which calls the very painter the commands call: what the
 * maintainer looks at there is what an agent receives. A new drawn screen is
 * one entry here with its fixtures, or it is not supervised.
 *
 * Pure: metadata only.
 */

import type { SheetFixtureId, StatsFixtureId } from './fixtures';

export interface ScreenCase {
  id: string;
  label: string;
  /** An edge a design must survive, as opposed to the ordinary case. */
  edge: boolean;
  /** The command an agent would send for something like it — shown, copied. */
  example: { command: string; params: Record<string, unknown> };
  fixture: { kind: 'sheet'; id: SheetFixtureId } | { kind: 'stats'; id: StatsFixtureId };
}

export interface AgentScreen {
  id: 'contact-sheet' | 'stats-card';
  title: string;
  /** What it shows and when an agent gets it — one or two sentences. */
  about: string;
  /** The commands that answer with it. */
  commands: string[];
  /** Widths it can be drawn at, in pixels; absent = one fixed width. */
  widths?: number[];
  /** The width the commands use. */
  width: number;
  /** JPEG for photographs, PNG for flat ink. */
  format: 'jpeg' | 'png';
  cases: ScreenCase[];
}

export const AGENT_SCREENS: AgentScreen[] = [
  {
    id: 'contact-sheet',
    title: 'Contact sheet',
    about:
      'Thumbnails in cells at their own shape, each labelled with an id and Winnow’s culling — what an agent looks at to choose by eye, see who is who, or compare a picture before and after.',
    commands: ['winnow.sheet', 'winnow.peopleSheet', 'develop.contactSheet', 'develop.compare'],
    widths: [800, 1200, 1600, 2048],
    width: 1600,
    format: 'jpeg',
    cases: [
      { id: 'day', label: 'A day of twelve', edge: false, example: { command: 'winnow.sheet', params: { date: '2026-01-14' } }, fixture: { kind: 'sheet', id: 'day' } },
      { id: 'roll', label: 'A roll', edge: false, example: { command: 'develop.contactSheet', params: {} }, fixture: { kind: 'sheet', id: 'roll' } },
      { id: 'people', label: 'The people', edge: false, example: { command: 'winnow.peopleSheet', params: { named: true } }, fixture: { kind: 'sheet', id: 'people' } },
      { id: 'compare', label: 'Before ↔ after', edge: false, example: { command: 'develop.compare', params: {} }, fixture: { kind: 'sheet', id: 'compare' } },
      { id: 'one', label: 'One picture', edge: true, example: { command: 'winnow.sheet', params: { ids: [1201] } }, fixture: { kind: 'sheet', id: 'one' } },
      { id: 'full', label: 'A full page', edge: true, example: { command: 'winnow.sheet', params: { date: '2026-08-14' } }, fixture: { kind: 'sheet', id: 'full' } },
      { id: 'long', label: 'Long labels', edge: true, example: { command: 'winnow.sheet', params: { date: '2026-01-14', verdict: 'pick' } }, fixture: { kind: 'sheet', id: 'long' } },
      { id: 'broken', label: 'Broken thumbnails', edge: true, example: { command: 'winnow.sheet', params: { ids: [1201, 1202, 1203] } }, fixture: { kind: 'sheet', id: 'broken' } },
    ],
  },
  {
    id: 'stats-card',
    title: 'Sum-up card',
    about:
      'A span counted on one card — photos and clips, the hours of the day, then with what, which body, lens, focal length, light, weekday, country and who. What an agent shares for a year or a trip.',
    commands: ['winnow.statsSheet'],
    width: 1200,
    format: 'png',
    cases: [
      { id: 'year', label: 'A year', edge: false, example: { command: 'winnow.statsSheet', params: { year: '2026' } }, fixture: { kind: 'stats', id: 'year' } },
      { id: 'trip', label: 'A trip', edge: false, example: { command: 'winnow.statsSheet', params: { from: '2026-01-02', to: '2026-01-15', title: 'Queensland, two weeks' } }, fixture: { kind: 'stats', id: 'trip' } },
      { id: 'noGps', label: 'No position', edge: true, example: { command: 'winnow.statsSheet', params: { year: '2025' } }, fixture: { kind: 'stats', id: 'noGps' } },
      { id: 'long', label: 'Long names', edge: true, example: { command: 'winnow.statsSheet', params: { from: '2026-05-01', to: '2026-05-31' } }, fixture: { kind: 'stats', id: 'long' } },
      { id: 'empty', label: 'Nothing dated', edge: true, example: { command: 'winnow.statsSheet', params: { year: '1999' } }, fixture: { kind: 'stats', id: 'empty' } },
    ],
  },
];

/** The screen an image answer of this command is drawn by, if Atelier draws it. */
export function screenOfCommand(command: string): AgentScreen | null {
  return AGENT_SCREENS.find((s) => s.commands.includes(command)) ?? null;
}
