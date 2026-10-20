/** Pure presentation helpers — no DOM, no React. */

/** Format a byte count as KB/MB/GB (decimal, 1 KB = 1000 bytes). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const shown = (v: number) => v.toFixed(v >= 100 ? 0 : 1);
  let value = bytes / 1000;
  let i = 0;
  // Judge the unit on the ROUNDED figure: 999 960 B is "1.0 MB", never "1000 KB".
  while (Number(shown(value)) >= 1000 && i < units.length - 1) {
    value /= 1000;
    i++;
  }
  return `${shown(value)} ${units[i]}`;
}

/** Precise current-position readout: `M:SS.cs` (centiseconds). */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
  // Whole centiseconds first, with an epsilon: 0.57 × 100 is 56.999… in binary.
  const total = Math.floor(seconds * 100 + 1e-6);
  const m = Math.floor(total / 6000);
  const s = Math.floor(total / 100) % 60;
  const cs = total % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Format a duration in seconds as `M:SS` or `H:MM:SS`. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return 'duration unavailable';
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
