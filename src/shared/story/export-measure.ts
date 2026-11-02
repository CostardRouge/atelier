/**
 * An export MEASURED where it runs (strategy R7, « the container's numbers
 * say little about a MacBook »): how long the post's MP4 took against how
 * long it plays, what it is made of (H.264 profile, AAC or Opus or no
 * sound), how heavy it came out, how much memory the page held at its
 * fullest (where the browser tells), on which device — and whether it ended,
 * was cancelled or failed. Kept per device, the last few, so the numbers of
 * his Mac and his phone can be read side by side and copied in one line to
 * whoever tunes the export. (pure)
 */

export type ExportOutcome = 'done' | 'cancelled' | 'failed';

export interface ExportMeasure {
  /** When it started (ms). */
  at: number;
  /** The post, `EP.04`. */
  post: string;
  /** How long the video plays, seconds. */
  seconds: number;
  /** How long the export took, ms: from the click to the file, or to the cancel. */
  wallMs: number;
  frames: number;
  fps: number;
  /** The H.264 codec string the encoder took, `avc1.640028`; null when it never started. */
  video: string | null;
  /** The sound track's codec; null for a silent file; `skipped` when sound was asked and could not be encoded. */
  audio: 'aac' | 'opus' | 'skipped' | null;
  bytes: number | null;
  /** The page's JavaScript heap at its fullest during the export, MB — Chromium tells, others do not. */
  peakHeapMb: number | null;
  device: string;
  outcome: ExportOutcome;
  /** Why it failed, in the browser's words. */
  error?: string;
}

export const KEEP_MEASURES = 12;

/** The list with `m` first, the oldest past `keep` dropped. (pure) */
export function withMeasure(list: readonly ExportMeasure[], m: ExportMeasure, keep = KEEP_MEASURES): ExportMeasure[] {
  return [m, ...list].slice(0, keep);
}

/** How many seconds of video one second of exporting makes: above 1, faster than it plays. (pure) */
export function speedOf(m: ExportMeasure): number | null {
  return m.outcome === 'done' && m.wallMs > 0 ? m.seconds / (m.wallMs / 1000) : null;
}

/** H.264's profile, as a person names it, from its codec string. (pure) */
export function profileOf(codec: string | null): string {
  if (!codec) return 'no video';
  const p = /^avc1\.([0-9a-f]{2})/i.exec(codec)?.[1]?.toLowerCase();
  return p === '64' ? 'H.264 High' : p === '4d' ? 'H.264 Main' : p === '42' ? 'H.264 Baseline' : `H.264 (${codec})`;
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const secs = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);

/** One line a person reads, and pastes. (pure) */
export function measureLine(m: ExportMeasure): string {
  const sound = m.audio === 'aac' ? 'AAC' : m.audio === 'opus' ? 'Opus' : m.audio === 'skipped' ? 'sound skipped' : 'silent';
  if (m.outcome === 'cancelled') return `${m.post} · cancelled after ${secs(m.wallMs)} · ${m.device}`;
  if (m.outcome === 'failed') return `${m.post} · failed after ${secs(m.wallMs)}: ${m.error ?? 'unknown'} · ${m.device}`;
  const speed = speedOf(m);
  return [
    `${m.post} · ${m.seconds.toFixed(1)} s of video in ${secs(m.wallMs)}${speed ? ` (${speed.toFixed(2)}× real time)` : ''}`,
    `${profileOf(m.video)} + ${sound}`,
    m.bytes !== null ? mb(m.bytes) : null,
    m.peakHeapMb !== null ? `heap ≤ ${Math.round(m.peakHeapMb)} MB` : null,
    m.device,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The device in a few words from what the browser says of itself — the
 * platform, the browser and its major version, the cores and the memory it
 * admits to. Never an identifier: nothing that tells one Mac from another. (pure)
 */
export function deviceLabel(ua: string, cores?: number, memoryGb?: number): string {
  const platform = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device';
  const browser =
    /Edg\/(\d+)/.exec(ua)?.[1] ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}` :
    /(?:Chrome|CriOS)\/(\d+)/.exec(ua)?.[1] ? `Chrome ${/(?:Chrome|CriOS)\/(\d+)/.exec(ua)![1]}` :
    /Firefox\/(\d+)/.exec(ua)?.[1] ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}` :
    /Version\/(\d+)[.\d]* .*Safari/.exec(ua)?.[1] ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}` : 'a browser';
  const hw = [cores ? `${cores} cores` : null, memoryGb ? `${memoryGb} GB` : null].filter(Boolean).join(', ');
  return `${platform} · ${browser}${hw ? ` (${hw})` : ''}`;
}

/** Parse what was kept; anything not a measure is left out. (pure) */
export function readMeasures(raw: unknown): ExportMeasure[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is ExportMeasure =>
      typeof m === 'object' && m !== null && typeof (m as ExportMeasure).post === 'string' && typeof (m as ExportMeasure).wallMs === 'number' && typeof (m as ExportMeasure).outcome === 'string',
  ).slice(0, KEEP_MEASURES);
}
