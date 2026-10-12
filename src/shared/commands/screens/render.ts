/**
 * A screen's CASE drawn — the made-up material of `fixtures.ts` handed to the
 * very painter the commands call (`contactSheetImage`, `statsCardImage`), so
 * the bench in `#/agents` shows what an agent receives and nothing else.
 *
 * DOM: synthetic tiles are painted on a canvas (a gradient and a horizon for
 * a photograph, a disc for a face) and encoded like a Winnow thumbnail.
 */

import type { ImageResult } from '../registry';
import { contactSheetImage, type SheetItem } from '../contact-sheet-image';
import { statsCardImage } from '../../sources/winnow/stats-card';
import { SHEETS, STATS, type FixtureTile } from './fixtures';
import { SCREEN_LIGHT, type ScreenPalette } from './paper';
import type { AgentScreen, ScreenCase } from './registry';

export interface RenderOptions {
  /** The sheet's width; the screen's own when absent or when it has one width. */
  width?: number;
  palette?: ScreenPalette;
}

/** A tile as a thumbnail would arrive: ~400 px on its long edge, JPEG. */
async function tileBlob(tile: FixtureTile): Promise<Blob | null> {
  if (tile.broken) return null;
  const long = 400;
  const w = tile.aspect >= 1 ? long : Math.round(long * tile.aspect);
  const h = tile.aspect >= 1 ? Math.round(long / tile.aspect) : long;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const hue = tile.hue;
  const sky = hue === null ? 'hsl(0 0% 62%)' : `hsl(${hue} 45% 62%)`;
  const ground = hue === null ? 'hsl(0 0% 30%)' : `hsl(${(hue + 30) % 360} 35% 28%)`;
  if (tile.face) {
    ctx.fillStyle = `hsl(${hue ?? 0} 20% 82%)`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `hsl(${hue ?? 0} 35% 55%)`;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.42, w * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 1.02, w * 0.36, h * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, sky);
    g.addColorStop(0.62, hue === null ? 'hsl(0 0% 80%)' : `hsl(${hue} 55% 80%)`);
    g.addColorStop(0.63, ground);
    g.addColorStop(1, hue === null ? 'hsl(0 0% 18%)' : `hsl(${(hue + 30) % 360} 30% 16%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hue === null ? 'hsl(0 0% 92%)' : `hsl(${(hue + 180) % 360} 70% 88%)`;
    ctx.beginPath();
    ctx.arc(w * 0.7, h * 0.3, Math.min(w, h) * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

/** One case of one screen, drawn exactly as the commands draw it. */
export async function renderScreenCase(screen: AgentScreen, c: ScreenCase, opts: RenderOptions = {}): Promise<ImageResult> {
  const palette = opts.palette ?? SCREEN_LIGHT;
  if (c.fixture.kind === 'stats') {
    const f = STATS[c.fixture.id];
    return statsCardImage(f.stats, f.title, f.people, palette);
  }
  const sheet = SHEETS[c.fixture.id];
  const items: SheetItem[] = await Promise.all(sheet.tiles.map(async (t) => ({ image: await tileBlob(t), label: t.label, ...(t.mark ? { mark: t.mark } : {}) })));
  const width = opts.width && screen.widths?.includes(opts.width) ? opts.width : screen.width;
  return contactSheetImage(items, sheet.note, width, palette);
}
