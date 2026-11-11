/**
 * CUTS ON THE BEAT (lab 7, his yes of 2026-11-06): the recap's sound has its
 * beats found on the device once (Storytelling's `beatTimes`, kept as a period
 * and a phase on `RecapSound.beat`), and with `motion.onBeat` the film plan
 * lands on them — every page change on a beat (the opener's cut too), the
 * heading and each cell's entrance on the nearest beat or half beat in their
 * order, and the film's end on a whole bar of four. The author's length still
 * wins over the bar: the film then ends where he said.
 *
 * Pure and DOM-free.
 */

import type { FilmPlan, PagePlan, Span } from './recap-motion';
import { bandSeconds } from './recap-bands';

export interface RecapBeat {
  /** Seconds between two beats. */
  period: number;
  /** The first beat, seconds into the sound. */
  phase: number;
}

/** Beats in a bar — the end of a film on the beat lands on one. */
export const BAR = 4;

/** The beat a list of beat times (`beatTimes`) keeps: their median spacing, the first's place in it. Null for fewer than four. */
export function beatOf(times: readonly number[]): RecapBeat | null {
  if (times.length < 4) return null;
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .sort((a, b) => a - b);
  const period = gaps[Math.floor(gaps.length / 2)];
  if (!(period > 0.25 && period < 1.5)) return null;
  return { period: Math.round(period * 10000) / 10000, phase: Math.round((times[0] % period) * 10000) / 10000 };
}

/** The beat read from anything stored: a period of 0.25–1.5 s (40–240 BPM), its phase inside it. */
export function readBeat(raw: unknown): RecapBeat | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const period = typeof r.period === 'number' && Number.isFinite(r.period) ? r.period : 0;
  if (!(period >= 0.25 && period <= 1.5)) return null;
  const phase = typeof r.phase === 'number' && Number.isFinite(r.phase) ? ((r.phase % period) + period) % period : 0;
  return { period, phase };
}

export const bpmOf = (beat: RecapBeat) => Math.round(60 / beat.period);

/**
 * The beats on the FILM's clock up to `until`: the sound plays from 0 and
 * loops every `loop` seconds, so each turn starts the grid again at its phase.
 */
export function beatGrid(beat: RecapBeat, loop: number, until: number): number[] {
  const out: number[] = [];
  const turn = loop > beat.period ? loop : Number.POSITIVE_INFINITY;
  for (let start = 0; start < until && out.length < 20000; start += turn) {
    for (let t = start + beat.phase; t < Math.min(until, start + turn) - 1e-6; t += beat.period) out.push(Math.round(t * 10000) / 10000);
    if (!Number.isFinite(turn)) break;
  }
  return out;
}

/** The first of `grid` at or after `t` (a hair early counts), else `t`. */
function upTo(grid: readonly number[], t: number): number {
  for (const g of grid) if (g >= t - 0.02) return g;
  return t;
}

/** The nearest of `grid` to `t`, never before `floor`. */
function nearest(grid: readonly number[], t: number, floor: number): number {
  let best = Math.max(t, floor);
  let d = Number.POSITIVE_INFINITY;
  for (const g of grid) {
    if (g < floor - 1e-6) continue;
    const e = Math.abs(g - t);
    if (e < d) {
      d = e;
      best = g;
    }
    if (g > t + d) break;
  }
  return best;
}

/** `grid` with a point halfway between each two — where entrances closer than a beat land. */
function halves(grid: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    out.push(grid[i]);
    if (i + 1 < grid.length) out.push((grid[i] + grid[i + 1]) / 2);
  }
  return out;
}

/**
 * `plan` landed on `grid` (the film's beats): the opener's cut and every
 * page's start moved UP to a beat, the page's own times carried with it; the
 * heading and the cells moved to the nearest beat (or half beat when they
 * come faster than one a beat), in their order and never before the page
 * starts; the end on the next whole bar — or at `fixedTotal` when the author
 * set the length. The clips keep their own windows, moved with their page.
 */
export function onTheBeat(plan: FilmPlan, grid: readonly number[], fixedTotal: number | null = null): FilmPlan {
  if (grid.length < 2) return plan;
  const period = grid[1] - grid[0];
  const lead = plan.lead ?? 0;
  const newLead = lead > 0 ? upTo(grid, lead) : 0;
  const pages: PagePlan[] = [];
  let carry = newLead - lead;
  for (const p of plan.pages) {
    const start = upTo(grid, p.start + carry);
    const d = start - p.start;
    carry = d;
    // Entrances closer than a beat apart land on half beats.
    const ats = [...p.cells.values()].map((s) => s.at).sort((a, b) => a - b);
    const gaps = ats.slice(1).map((a, i) => a - ats[i]).filter((g) => g > 1e-6);
    const fine = gaps.length && gaps.reduce((a, b) => a + b, 0) / gaps.length < period * 0.75 ? halves(grid) : grid;
    const heading = p.heading ? { at: nearest(fine, p.heading.at + d, start), dur: p.heading.dur } : null;
    const subheading = p.subheading ? { at: Math.max(heading?.at ?? start, nearest(fine, p.subheading.at + d, start)), dur: p.subheading.dur } : null;
    const cells = new Map<string, Span>();
    let floor = start;
    for (const [id, s] of [...p.cells].sort((a, b) => a[1].at - b[1].at)) {
      const at = nearest(fine, s.at + d, floor);
      cells.set(id, { at, dur: s.dur });
      floor = at;
    }
    let allOn = Math.max(start, ...[heading, subheading].filter((x): x is Span => Boolean(x)).map((x) => x.at + x.dur), ...[...cells.values()].map((x) => x.at + x.dur));
    const cta = p.cta ? { at: nearest(fine, allOn, allOn), dur: p.cta.dur } : null;
    if (cta) allOn = cta.at + cta.dur;
    const clips = new Map([...p.clips].map(([id, ws]) => [id, ws.map((w) => ({ ...w, from: w.from + d, to: w.to + d }))]));
    // A week's days turn on the beat: each day whole beats, the first from a beat.
    const bands = p.bands ? { from: upTo(grid, Math.max(allOn, p.bands.from + d)), hold: Math.max(1, Math.round(p.bands.hold / period)) * period } : undefined;
    const end = Math.max(p.start + p.length + d, allOn, bands ? bands.from + bandSeconds(bands.hold) + 0.4 : 0);
    pages.push({ start, length: end - start, heading, subheading, cta, cells, clips, allOn, ...(bands ? { bands } : {}) });
  }
  // Each page lasts until the next one starts; the last until the end.
  for (let i = 0; i + 1 < pages.length; i++) pages[i].length = pages[i + 1].start - pages[i].start;
  const last = pages[pages.length - 1];
  const naturalEnd = last ? last.start + last.length : plan.total;
  let total: number;
  if (fixedTotal !== null) total = Math.max(fixedTotal, last ? last.allOn : 0);
  else {
    // The next whole bar, counted from the first beat.
    const bars = grid.filter((_, i) => i % BAR === 0);
    total = bars.find((b) => b >= naturalEnd - 0.02) ?? naturalEnd;
    if (total < naturalEnd - 0.02) total = naturalEnd;
  }
  if (last) last.length = total - last.start;
  return { ...plan, pages, total, ...(lead > 0 ? { lead: newLead } : {}) };
}

/**
 * True when a film's cuts fall on a beat of `period` (lab 18: a library track
 * whose tempo suits the recap): the median gap between its cuts is a whole
 * number of beats — 1 to 16 — within 6 %. Fewer than two gaps say nothing.
 */
export function cutsOnBeat(period: number, cuts: readonly number[]): boolean {
  const gaps = cuts
    .slice(1)
    .map((t, i) => t - cuts[i])
    .filter((g) => g > 0.05)
    .sort((a, b) => a - b);
  if (gaps.length < 2 || !(period > 0)) return false;
  const gap = gaps[Math.floor(gaps.length / 2)];
  const beats = Math.round(gap / period);
  return beats >= 1 && beats <= 16 && Math.abs(gap - beats * period) / gap <= 0.06;
}
