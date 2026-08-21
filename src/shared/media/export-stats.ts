/**
 * What one finished export cost — the feedback line under a variant row.
 *
 * Pure and DOM-free. These are measurements of *this machine, right now*
 * (a laptop on battery renders slower than the same laptop plugged in), which
 * is why they live for the session and are never written into the project
 * document: they describe the run, not the composition.
 */

import { formatBytes } from '../lib/format';

export interface ExportStat {
  /** Size of the delivered file, in bytes. */
  bytes: number;
  /** Wall-clock seconds from the variant starting to its file being written. */
  seconds: number;
  /**
   * The clip's own duration in seconds, when known — the divisor of the
   * realtime ratio. Null when the transport never reported one, and then the
   * ratio is simply not shown rather than guessed.
   */
  clipSeconds: number | null;
}

/**
 * A wall-clock render time, read at a glance: `8.3 s`, `41 s`, `1 min 48 s`,
 * `1 h 04 min`. Deliberately NOT `formatDuration`'s `M:SS` — that shape reads
 * as a position in the clip, and these two numbers sit inches apart.
 */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const total = Math.round(seconds);
  if (total < 3600) {
    return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`;
  }
  const h = Math.floor(total / 3600);
  return `${h} h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')} min`;
}

/**
 * How the render compares to playing the clip: `2.9× realtime`. The only one
 * of the three figures that stays comparable between clips of different
 * lengths — a 40-second render means nothing until you know whether the clip
 * was 30 seconds or ten minutes. Null when there is nothing to divide.
 */
export function formatSpeed(clipSeconds: number | null, seconds: number): string | null {
  if (!clipSeconds || !Number.isFinite(clipSeconds) || clipSeconds <= 0) return null;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const ratio = clipSeconds / seconds;
  return `${ratio.toFixed(ratio < 10 ? 1 : 0)}× realtime`;
}

/** The stat line for one finished variant: `412.8 MB · 1 min 48 s · 1.1× realtime`. */
export function describeExportStat(stat: ExportStat): string {
  return [
    formatBytes(stat.bytes),
    formatElapsed(stat.seconds),
    formatSpeed(stat.clipSeconds, stat.seconds),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The run's total: bytes written and wall-clock spent across every variant.
 * Summed from the per-variant measurements, so it excludes the pauses between
 * them (there are none in practice — the loop is sequential).
 */
export function totalExportStats(stats: ExportStat[]): { bytes: number; seconds: number } {
  return stats.reduce(
    (acc, s) => ({ bytes: acc.bytes + s.bytes, seconds: acc.seconds + s.seconds }),
    { bytes: 0, seconds: 0 },
  );
}

/** The summary line under the button: `2 files · 451.0 MB · 2 min 29 s`. */
export function describeExportRun(stats: ExportStat[]): string {
  const { bytes, seconds } = totalExportStats(stats);
  const files = `${stats.length} file${stats.length === 1 ? '' : 's'}`;
  return [files, formatBytes(bytes), formatElapsed(seconds)].join(' · ');
}
