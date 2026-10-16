/**
 * The intro and the outro, painted over the atlas's own frame by the same
 * painter for the preview and the export: the veils over the map (a card, a
 * dark scrim), the pin a world dive lands on, the lines in the middle (a
 * title, a line, the sticker; the totals counting up), and the black of a
 * hand-over or a fade. Every value comes from `atlas-story.ts`; nothing here
 * keeps time.
 */

import type { OverlayHit } from './atlas-layers';
import { paintOverlay, type Block, type OverlayLayout, type StickerBlock } from './atlas-overlay';
import type { Ctx2D, PaintScene } from './atlas-paint';
import type { Rect } from './atlas-settings';
import { readStat } from './atlas-stats';
import { countedStats, introLine, introTitle, STORY_TEXT_WIDTH, type IntroLook, type OutroLook } from './atlas-story';
import { viewAffine, type AtlasView } from './atlas-view';

/** The card and the scrims over the map — inside the map's clip, under every word. */
export function paintVeils(ctx: Ctx2D, scene: PaintScene, rect: Rect, intro: IntroLook, outro: OutroLook): void {
  const fill = (colour: string, alpha: number) => {
    if (alpha <= 0.001) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = colour;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  fill('#000', Math.max(intro.scrim, outro.scrim));
  fill(intro.cardColour === 'black' ? '#000' : scene.settings.map.background, intro.card);
  ctx.restore();
}

/**
 * The words and marks of the intro and the outro, and the black over the
 * whole frame. Returns where the words were drawn, owned by their layer.
 */
export function paintStory(
  ctx: Ctx2D,
  scene: PaintScene,
  frame: { width: number; height: number; view: AtlasView },
  rect: Rect,
  intro: IntroLook,
  outro: OutroLook,
  sticker: StickerBlock,
): OverlayHit[] {
  const s = scene.settings;
  const hits: OverlayHit[] = [];
  const base: Omit<OverlayLayout, 'spots'> = { theme: s.hud.theme, accent: s.hud.accent, scale: s.hud.scale };
  const hasSticker = sticker.items.length > 0;
  const title = introTitle(s.intro, s.hud.title, scene.placeNames[0] ?? null);
  const fit = { maxW: STORY_TEXT_WIDTH, mode: s.intro.fit };
  const wrap = { maxW: STORY_TEXT_WIDTH, mode: 'wrap' as const };
  const draw = (layout: OverlayLayout) => hits.push(...paintOverlay(ctx, layout, rect).filter((h) => h.w > 0));

  // The pin a world dive lands on.
  if (intro.pin > 0.001 && scene.diveTo) {
    const look = { bearing: s.camera.bearing, tilt: s.camera.tilt };
    const m = viewAffine(frame.view, look, rect.w, rect.h);
    const x = rect.x + m.a * scene.diveTo.x + m.c * scene.diveTo.y + m.e;
    const y = rect.y + m.b * scene.diveTo.x + m.d * scene.diveTo.y + m.f;
    const unit = Math.min(rect.w, rect.h) / 1080;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = intro.pin;
    ctx.fillStyle = s.hud.accent;
    ctx.strokeStyle = s.hud.accent;
    ctx.lineWidth = 5 * unit;
    ctx.beginPath();
    ctx.arc(x, y, 11 * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = intro.pin * (1 - intro.ring);
    ctx.beginPath();
    ctx.arc(x, y, (24 + 30 * intro.ring) * unit, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // The intro's lines, stacked in the middle.
  if (intro.title + intro.line + intro.sticker > 0.001) {
    const blocks: Block[] = [];
    if (title) blocks.push({ kind: 'text', text: title, size: 96 * s.intro.titleSize, gapAfter: 0.12, alpha: intro.title, owner: 'intro', fit });
    blocks.push({ kind: 'text', text: introLine(s.intro, scene.flights.length, scene.dateRange), size: 30 * s.intro.lineSize, weight: 500, gapAfter: 0.7, alpha: intro.line, owner: 'intro', fit: wrap });
    if (hasSticker && intro.sticker > 0.001) blocks.push({ ...sticker, alpha: intro.sticker, owner: 'intro' });
    draw({ ...base, scale: base.scale * intro.scale, spots: { mc: blocks }, middleAt: intro.y, shiftY: intro.rise });
  }

  // The outro's: a summary in the middle, a pull-back's title at the top.
  const lastLine = s.outro.line.trim();
  if (outro.title + outro.totals + outro.sticker > 0.001 || (outro.line > 0.001 && outro.black < 0.001)) {
    const head: Block[] = [];
    if (title) head.push({ kind: 'text', text: title, size: (outro.titleAt === 'top' ? 58 : 64) * s.intro.titleSize, gapAfter: 0.4, alpha: outro.title, owner: 'outro', fit });
    if (outro.totals > 0.001 && s.outro.stats.length) {
      const counted = countedStats(scene.totals, outro.count);
      const items = s.outro.stats.map((key) => {
        const r = readStat(key, counted, s.hud.units);
        // Only a counting numeral rolls: a total held still would freeze mid-roll.
        return { value: r.text, label: r.label, odometer: outro.count < 1 ? r.odometer : undefined };
      });
      const columns = s.outro.statsLayout === 'grid' ? s.outro.columns : undefined;
      head.push({ kind: 'row', items, size: 56 * s.outro.statsSize, alpha: outro.totals, owner: 'outro', fit: { maxW: STORY_TEXT_WIDTH, columns } });
      head.push({ kind: 'text', text: ' ', size: 20 });
    }
    if (hasSticker && outro.sticker > 0.001) head.push({ ...sticker, gapAfter: 0.5, alpha: outro.sticker, owner: 'outro' });
    const line: Block[] = lastLine ? [{ kind: 'text', text: lastLine, size: 28, weight: 500, alpha: outro.line, owner: 'outro', fit: wrap }] : [];
    if (outro.titleAt === 'top') draw({ ...base, spots: { tc: head, bc: line } });
    else draw({ ...base, spots: { mc: [...head, ...line] } });
  }

  // Black over the whole frame — a hand-over through black, or a fade out —
  // and a fade's last line on it.
  const black = Math.max(intro.black, outro.black);
  if (black > 0.001) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = black;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.restore();
    if (lastLine && outro.line > 0.001) draw({ ...base, spots: { mc: [{ kind: 'text', text: lastLine, size: 30, weight: 500, alpha: outro.line, owner: 'outro', fit: wrap }] } });
  }
  return hits;
}
