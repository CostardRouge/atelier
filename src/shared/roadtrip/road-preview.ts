/**
 * What the Road pane shows while the author tunes the road (2026-10-13):
 * the kilometres each mode would count, the line the chosen drive makes, the
 * line as recorded beneath it, the fixes as dots, and how far the drive
 * strays from them — the «flotte» the maintainer reported, said as a number.
 *
 * Computed by `road-preview-worker.ts` off the main thread, a drag of a
 * slider costing the page nothing, and handed back packed in typed arrays
 * (`packPreview` / `unpackPreview`). The line is `driveLine` over the same
 * pieces `roadLine` reads, so it is exactly what `tripRoadLine` would compute
 * for the written road — and is handed to it (`primeTripRoadLine`) instead
 * of being computed again. Pure and DOM-free; a `RoadPreviewer` keeps what a
 * slider step does not change (the decoded track, a mode's pieces, a
 * detail's line) between two asks.
 */

import { countedKm } from './road-ribbon';
import {
  NO_ROAD,
  distanceKm,
  driveLine,
  lineKm,
  roadPieces,
  simplify,
  tripRoadFixes,
  type RoadDrive,
  type RoadFix,
  type RoadLine,
  type RoadMode,
  type TripRoad,
} from './road-track';

/** What a preview is asked for: the road's fixes and the reading being tried. */
export interface RoadPreviewAsk {
  track: string;
  added: readonly RoadFix[];
  mode: RoadMode;
  detail: number;
  drive: RoadDrive;
}

export type CountedMode = 'stages' | 'moves' | 'raw';
export const COUNTED_MODES: readonly CountedMode[] = ['stages', 'moves', 'raw'];

export interface RoadPreview {
  /** What each mode would count, and keep, at the detail asked. */
  modes: Record<CountedMode, { km: number; points: number }>;
  /** The line as the drive makes it — `tripRoadLine` of the road written with this reading. */
  line: RoadLine;
  /** The mode's line at the detail, as recorded: what is counted. */
  recorded: RoadFix[][];
  /** The fixes the mode keeps, before the detail. */
  fixes: RoadFix[][];
  /** How far the driven line passes from those fixes, metres: on average and at worst. Null with no road. */
  stray: { meanM: number; maxM: number } | null;
}

export const EMPTY_PREVIEW: RoadPreview = {
  modes: { stages: { km: 0, points: 0 }, moves: { km: 0, points: 0 }, raw: { km: 0, points: 0 } },
  line: NO_ROAD,
  recorded: [],
  fixes: [],
  stray: null,
};

/** The ask a stored road and a reading make. */
export function previewAsk(road: TripRoad, mode: RoadMode, detail: number, drive: RoadDrive): RoadPreviewAsk {
  return { track: road.track, added: road.added, mode, detail, drive };
}

/**
 * A preview computer that keeps what the next ask is likely to share: the
 * decoded track (until the track or the hand points change), each mode's
 * pieces, each mode-and-detail's counted line.
 */
export class RoadPreviewer {
  private source = '';
  private fixes: RoadFix[] = [];
  private pieces = new Map<RoadMode, RoadFix[][]>();
  private counted = new Map<string, RoadFix[][]>();

  preview(ask: RoadPreviewAsk): RoadPreview {
    const source = `${ask.track}|${ask.added.map((f) => `${f.t},${f.lat},${f.lon}`).join(';')}`;
    if (source !== this.source) {
      this.source = source;
      this.fixes = tripRoadFixes({ track: ask.track, added: [...ask.added] } as TripRoad);
      this.pieces.clear();
      this.counted.clear();
    }
    const modes = {} as RoadPreview['modes'];
    for (const m of COUNTED_MODES) {
      const counted = this.countedOf(m, ask.detail);
      modes[m] = { km: counted.reduce((n, p) => n + lineKm(p), 0), points: counted.reduce((n, p) => n + p.length, 0) };
    }
    if (ask.mode === 'crow') return { ...EMPTY_PREVIEW, modes };
    const whole = this.piecesOf(ask.mode);
    const recorded = this.countedOf(ask.mode, ask.detail);
    const line = driveLine(whole, recorded, ask.drive);
    return { modes, line, recorded, fixes: whole, stray: strayOf(whole, recorded, line.pieces) };
  }

  private piecesOf(mode: RoadMode): RoadFix[][] {
    let pieces = this.pieces.get(mode);
    if (!pieces) this.pieces.set(mode, (pieces = roadPieces(this.fixes, mode)));
    return pieces;
  }

  private countedOf(mode: RoadMode, detail: number): RoadFix[][] {
    const key = `${mode}|${detail}`;
    let counted = this.counted.get(key);
    if (!counted) {
      counted = this.piecesOf(mode).map((p) => simplify(p, detail));
      // A detail slider walks eight stops: keep them all, drop the rest.
      if (this.counted.size > 24) this.counted.clear();
      this.counted.set(key, counted);
    }
    return counted;
  }
}

/**
 * How far the driven pieces pass from the fixes, metres: each fix to the
 * nearest segment of its own piece, on a flat map at the fix. A fix is
 * matched only against the stretch of line driven within `STRAY_KM` of its
 * own kilometre on the counted line — every driven point carries that
 * kilometre (`RoadFix.km`; point to point, the line IS the counted one) —
 * so a road driven out and back is never matched to its other pass, and a
 * year of road is never searched whole per fix.
 */
export function strayOf(
  fixes: readonly (readonly RoadFix[])[],
  counted: readonly (readonly RoadFix[])[],
  driven: readonly (readonly RoadFix[])[],
): { meanM: number; maxM: number } | null {
  let sum = 0;
  let max = 0;
  let count = 0;
  for (let p = 0; p < Math.min(fixes.length, counted.length, driven.length); p++) {
    const line = driven[p];
    if (line.length < 2) continue;
    const fixKm = countedKm(fixes[p], counted[p]);
    const lineKm = new Float64Array(line.length);
    for (let j = 1; j < line.length; j++) {
      // The same measure `countedKm` sums, or the two drift kilometres apart over a year.
      lineKm[j] = line[j].km ?? lineKm[j - 1] + distanceKm(line[j - 1], line[j]);
    }
    if (line[0].km !== undefined) lineKm[0] = line[0].km;
    let from = 0;
    fixes[p].forEach((f, i) => {
      const k = fixKm[i];
      // The first segment that reaches the window, searched on from the last.
      while (from > 0 && lineKm[from] > k - STRAY_KM) from--;
      while (from < line.length - 2 && lineKm[from + 1] < k - STRAY_KM) from++;
      const kx = 111.32 * Math.cos((f.lat * Math.PI) / 180);
      let best = Infinity;
      for (let j = from; j < line.length - 1 && lineKm[j] <= k + STRAY_KM; j++) {
        const ax = (line[j].lon - f.lon) * kx;
        const ay = (line[j].lat - f.lat) * 110.574;
        const ex = (line[j + 1].lon - f.lon) * kx - ax;
        const ey = (line[j + 1].lat - f.lat) * 110.574 - ay;
        const l2 = ex * ex + ey * ey;
        const u = l2 > 0 ? Math.min(1, Math.max(0, -(ax * ex + ay * ey) / l2)) : 0;
        best = Math.min(best, Math.hypot(ax + u * ex, ay + u * ey));
      }
      if (!Number.isFinite(best)) return;
      sum += best;
      max = Math.max(max, best);
      count++;
    });
  }
  return count ? { meanM: (sum / count) * 1000, maxM: max * 1000 } : null;
}

/** How far along the counted line, either side of a fix's own kilometre, its match is searched, km. */
const STRAY_KM = 5;

// --- across the worker's boundary --------------------------------------------------

/** Four numbers a point — time, latitude, longitude, counted km (NaN where none). */
const STRIDE = 4;

export interface PackedPreview {
  modes: RoadPreview['modes'];
  line: { pieces: Float64Array[]; points: number; km: number };
  recorded: Float64Array[];
  fixes: Float64Array[];
  stray: RoadPreview['stray'];
}

function pack(pieces: readonly (readonly RoadFix[])[]): Float64Array[] {
  return pieces.map((piece) => {
    const out = new Float64Array(piece.length * STRIDE);
    piece.forEach((f, i) => {
      out[i * STRIDE] = f.t;
      out[i * STRIDE + 1] = f.lat;
      out[i * STRIDE + 2] = f.lon;
      out[i * STRIDE + 3] = f.km ?? NaN;
    });
    return out;
  });
}

function unpack(pieces: readonly Float64Array[]): RoadFix[][] {
  return pieces.map((data) => {
    const out: RoadFix[] = new Array(data.length / STRIDE);
    for (let i = 0; i < out.length; i++) {
      const km = data[i * STRIDE + 3];
      out[i] = Number.isNaN(km)
        ? { t: data[i * STRIDE], lat: data[i * STRIDE + 1], lon: data[i * STRIDE + 2] }
        : { t: data[i * STRIDE], lat: data[i * STRIDE + 1], lon: data[i * STRIDE + 2], km };
    }
    return out;
  });
}

/** A preview as typed arrays, and the buffers to transfer with it. */
export function packPreview(preview: RoadPreview): { packed: PackedPreview; transfer: ArrayBuffer[] } {
  const packed: PackedPreview = {
    modes: preview.modes,
    line: { pieces: pack(preview.line.pieces), points: preview.line.points, km: preview.line.km },
    recorded: pack(preview.recorded),
    fixes: pack(preview.fixes),
    stray: preview.stray,
  };
  const transfer = [...packed.line.pieces, ...packed.recorded, ...packed.fixes].map((a) => a.buffer as ArrayBuffer);
  return { packed, transfer };
}

export function unpackPreview(packed: PackedPreview): RoadPreview {
  const pieces = unpack(packed.line.pieces);
  return {
    modes: packed.modes,
    line: pieces.length ? { pieces, points: packed.line.points, km: packed.line.km } : NO_ROAD,
    recorded: unpack(packed.recorded),
    fixes: unpack(packed.fixes),
    stray: packed.stray,
  };
}
