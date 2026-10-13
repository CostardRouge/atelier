/**
 * Colours for Flight Atlas — palettes, gradients and the few conversions the
 * painter needs, pure. A palette is a list of stops sampled linearly; a
 * flight's own colour is a stop picked by the golden ratio so neighbours in
 * the list never share a hue.
 */

export type Rgb = [number, number, number];

export type PaletteId =
  | 'perth'
  | 'aurora'
  | 'ember'
  | 'neon'
  | 'ice'
  | 'papier'
  | 'sunset'
  | 'spectrum'
  | 'mono';

export interface Palette {
  id: PaletteId;
  label: string;
  stops: readonly string[];
}

export const PALETTES: readonly Palette[] = [
  { id: 'perth', label: 'Transit', stops: ['#3b2c8f', '#6d4bd8', '#5fd3e6', '#d8fbff'] },
  { id: 'aurora', label: 'Aurora', stops: ['#0b3d5c', '#1fa38a', '#7cf29c', '#e5ffb0'] },
  { id: 'ember', label: 'Ember', stops: ['#4a0d0d', '#b8321e', '#ff8a3d', '#ffe3a1'] },
  { id: 'neon', label: 'Neon', stops: ['#ff3fa4', '#ffd23f', '#3fffb2', '#3fb8ff', '#b23fff'] },
  { id: 'ice', label: 'Ice', stops: ['#1c2c4c', '#3f6fb5', '#9fd0ff', '#ffffff'] },
  { id: 'papier', label: 'Papier', stops: ['#1b1813', '#5b4a3a', '#d9442a', '#f0a37f'] },
  { id: 'sunset', label: 'Sunset', stops: ['#2b1055', '#7a2a8c', '#e8476a', '#ffb05c', '#fff1a8'] },
  { id: 'spectrum', label: 'Spectrum', stops: ['#ff4d4d', '#ffb84d', '#e6ff4d', '#4dff88', '#4dd2ff', '#7a4dff', '#ff4dd2'] },
  { id: 'mono', label: 'Mono', stops: ['#3a3a3a', '#9a9a9a', '#ffffff'] },
];

export function paletteById(id: PaletteId): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** `#rgb` / `#rrggbb` → `[r, g, b]`, black for anything else. */
export function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mix(a: Rgb, b: Rgb, k: number): Rgb {
  const t = Math.min(1, Math.max(0, k));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

/** A palette sampled at `f ∈ [0, 1]`, linear between stops. */
export function samplePalette(stops: readonly string[], f: number): Rgb {
  if (stops.length === 0) return [255, 255, 255];
  if (stops.length === 1) return parseHex(stops[0]);
  const x = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(parseHex(stops[i]), parseHex(stops[i + 1]), x - i);
}

/** A palette sampled cyclically (the last stop runs back into the first) — for an hour of the day. */
export function sampleCyclic(stops: readonly string[], f: number): Rgb {
  if (stops.length < 2) return samplePalette(stops, 0);
  const x = (((f % 1) + 1) % 1) * stops.length;
  const i = Math.floor(x) % stops.length;
  return mix(parseHex(stops[i]), parseHex(stops[(i + 1) % stops.length]), x - Math.floor(x));
}

/** The colour of an hour: deep night, dawn, noon, dusk. */
export const DAY_STOPS = ['#2a3a8f', '#6b5bd6', '#ff8fa3', '#ffd27a', '#fff3c4', '#ffb35c', '#e8576a', '#4b3a9e'];

const GOLDEN = 0.618033988749895;

/** The `i`-th flight's spot on a palette: spread by the golden ratio, never two neighbours alike. */
export function flightTone(i: number): number {
  return (i * GOLDEN) % 1;
}

/** Relative luminance, 0..1 — whether ink on this ground should be dark or light. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
