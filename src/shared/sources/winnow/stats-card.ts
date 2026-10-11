import type { ImageResult } from '../../commands/registry';
import { imageResult } from '../../commands/image-result';
import { spanWords, topOf, type LibraryStats, WEEKDAYS } from './stats';

/**
 * A span's sum-up DRAWN as one shareable card, on the suite's paper with its
 * ink and its one vermilion: the headline numbers, then one bar row per
 * question — with what, which body, which hour, which light, which weekday,
 * which country. Drawn from `libraryStats` alone, so the card and the JSON
 * can never disagree.
 *
 * DOM: a canvas.
 */

const PAPER = '#f4efe6';
const INK = '#1d1a16';
const MUTED = '#6f6a62';
const RULE = '#ddd5c7';
const ACCENT = '#c4381f';
const MONO = 'ui-monospace, Menlo, monospace';
const W = 1200;
const PAD = 56;

interface Section {
  title: string;
  rows: [string, number][];
}

export async function statsCardImage(stats: LibraryStats, title: string, people: readonly [string, number][] = []): Promise<ImageResult> {
  const sections: Section[] = [
    { title: 'With what', rows: topOf(stats.byGear, 4) },
    { title: 'Which body', rows: topOf(stats.byCamera, 5) },
    { title: 'Which lens', rows: topOf(stats.byLens, 5) },
    { title: 'Which focal length', rows: topOf(stats.byFocal, 5) },
    { title: 'Which light', rows: topOf(stats.byLight, 4) },
    { title: 'Which weekday', rows: WEEKDAYS.map((d) => [d, stats.byWeekday[d] ?? 0] as [string, number]) },
    { title: 'Which country', rows: topOf(stats.byCountry, 6) },
    ...(people.length ? [{ title: 'Who', rows: [...people] }] : []),
  ].filter((s) => s.rows.some(([, n]) => n > 0));
  const ROW = 30;
  const SECTION_HEAD = 46;
  const HOURS_H = 150;
  const height =
    PAD + 60 + 44 + 40 + HOURS_H + 30 + sections.reduce((h, s) => h + SECTION_HEAD + s.rows.length * ROW + 20, 0) + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('the browser refused a canvas');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, height);
  ctx.textBaseline = 'alphabetic';

  let y = PAD + 44;
  ctx.fillStyle = INK;
  ctx.font = `600 44px ${MONO}`;
  ctx.fillText(fit(ctx, title, W - 2 * PAD), PAD, y);
  y += 44;
  ctx.fillStyle = MUTED;
  ctx.font = `400 20px ${MONO}`;
  const span = stats.span ? `${stats.span.from} → ${stats.span.to} · ${stats.days} day${stats.days === 1 ? '' : 's'}` : 'no dated frame';
  ctx.fillText(span, PAD, y);
  y += 40;
  ctx.fillStyle = INK;
  ctx.font = `500 26px ${MONO}`;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const head = [plural(stats.media.photo, 'photo'), `${plural(stats.media.video, 'clip')}${stats.videoSeconds ? ` · ${spanWords(stats.videoSeconds)}` : ''}`, plural(stats.byVerdict.pick ?? 0, 'pick')];
  ctx.fillText(head.join('   ·   '), PAD, y);
  y += 30;

  // The hours: 24 bars, the local clock — the shape of a photographer's day.
  const maxHour = Math.max(1, ...stats.byHour);
  const barW = (W - 2 * PAD) / 24;
  const base = y + HOURS_H - 28;
  stats.byHour.forEach((n, h) => {
    const bh = Math.round(((HOURS_H - 50) * n) / maxHour);
    ctx.fillStyle = n === maxHour ? ACCENT : INK;
    ctx.fillRect(PAD + h * barW + 3, base - bh, barW - 6, bh);
    ctx.fillStyle = MUTED;
    ctx.font = `400 14px ${MONO}`;
    if (h % 3 === 0) ctx.fillText(`${h}h`, PAD + h * barW + 3, base + 18);
  });
  ctx.fillStyle = MUTED;
  ctx.font = `400 16px ${MONO}`;
  ctx.fillText(`By local hour${stats.noHour ? ` · ${stats.noHour} with no known hour` : ''}`, PAD, y + 16);
  y += HOURS_H + 30;

  for (const s of sections) {
    ctx.fillStyle = RULE;
    ctx.fillRect(PAD, y, W - 2 * PAD, 1);
    y += SECTION_HEAD - 12;
    ctx.fillStyle = MUTED;
    ctx.font = `500 16px ${MONO}`;
    ctx.fillText(s.title.toUpperCase(), PAD, y);
    y += 12;
    const max = Math.max(1, ...s.rows.map(([, n]) => n));
    const labelW = 300;
    const barMax = W - 2 * PAD - labelW - 90;
    for (const [label, n] of s.rows) {
      y += ROW;
      ctx.fillStyle = INK;
      ctx.font = `400 18px ${MONO}`;
      ctx.fillText(fit(ctx, label, labelW - 16), PAD, y);
      const w = Math.round((barMax * n) / max);
      ctx.fillStyle = n === max && n > 0 ? ACCENT : INK;
      ctx.fillRect(PAD + labelW, y - 15, w, 16);
      ctx.fillStyle = MUTED;
      ctx.fillText(String(n), PAD + labelW + w + 12, y);
    }
    y += 20;
  }
  ctx.fillStyle = MUTED;
  ctx.font = `400 14px ${MONO}`;
  ctx.fillText('Atelier · counted from Winnow', PAD, height - PAD + 24);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('the browser refused to encode the card');
  return imageResult(blob, W, height, `${title} — the sum-up as a card`);
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}
