/**
 * The one colour conversion a hook's paint needs: a stored `#rrggbb` to an
 * `rgba()` at some alpha. Grown in Défilé, lifted out when the route wanted
 * it; an unreadable value paints white rather than throwing mid-frame.
 */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function hexToRgba(hex: string, alpha: number): string {
  const m = HEX_COLOR.test(hex) ? hex : '#ffffff';
  const r = parseInt(m.slice(1, 3), 16);
  const g = parseInt(m.slice(3, 5), 16);
  const b = parseInt(m.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
