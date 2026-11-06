import { PERIOD_TEMPLATES, createRecapDoc, withPictures, withRecap, type RecapDoc, type RecapPicture, type RecapTemplate } from '../../shared/recap/recap-doc';
import { templateDays } from '../../shared/recap/recap-slots';
import type { Drawable, PaintSources } from '../../shared/recap/recap-paint';

/**
 * What a catalogue card draws: the template's own recipe filled with a
 * sample pool of colour fields — the REAL painter over stand-in pictures, so
 * the card shows exactly what the template does, entrance included, without
 * one photograph of anybody's (the repository is public).
 */

const TONES: [string, string][] = [
  ['#5b7a46', '#2f4a26'],
  ['#c9774a', '#7a3b22'],
  ['#7fa3c4', '#3e6488'],
  ['#d8b48a', '#8a6440'],
  ['#3e3a36', '#14120f'],
  ['#b8c7a0', '#6f8a56'],
  ['#e0a0a8', '#9a4a58'],
  ['#8c6d9e', '#4a3560'],
  ['#d9c27a', '#8a7030'],
  ['#6aa0a0', '#2f5a5c'],
  ['#a85a3a', '#5a2a18'],
  ['#cfd6dc', '#7d8a96'],
];

let tiles: Drawable[] | null = null;

/** Twelve colour fields, made once per page. */
function sampleTiles(): Drawable[] {
  if (tiles) return tiles;
  tiles = TONES.map(([a, b]) => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 90;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 120, 90);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(0, 0, 120, 90);
    return { image: c, width: 120, height: 90 };
  });
  return tiles;
}

/** A sample recap of `template`: a few empty days on a calendar, one clip, a full grid. */
export function sampleRecap(template: RecapTemplate, anchor: string): RecapDoc {
  let doc = createRecapDoc(template, 'local', { anchor, now: 1 });
  if (PERIOD_TEMPLATES.includes(template)) {
    doc = withRecap(doc, { range: { from: `${anchor.slice(0, 7)}-01`, to: `${anchor.slice(0, 7)}-28` }, count: template === 'sheets' ? 12 : template === 'wrapped' ? 6 : 9 });
  }
  const days = templateDays(doc);
  const pics: RecapPicture[] = [];
  days.forEach((day, i) => {
    if (template === 'month' && [6, 11, 21, 26].includes(i)) return;
    if (template === 'onThisDay' && i === 2) return;
    pics.push({ key: `s:${i}`, origin: 'local', name: `${i}`, kind: (template === 'month' && i === 8) || (template === 'second' && i % 5 === 2) ? 'video' : 'photo', day, minute: 600 + ((i * 97) % 600), duration: 3, device: i % 3 ? 'ILCE-7M4' : 'iPhone 16 Pro', width: i % 3 === 1 ? 900 : 1500, height: 1200, focal: 35, fNumber: 1.8, shutter: '1/250', iso: 100, ...(template === 'wrapped' ? { place: i % 4 ? 'Esperance' : 'Albany', ...(i === 9 ? { stars: 5 } : {}) } : {}) });
  });
  return withPictures(doc, pics);
}

/** The sample's pictures, each key a colour field. */
export function sampleSources(): PaintSources {
  const all = sampleTiles();
  return {
    still: (key) => all[Number(key.slice(2)) % all.length] ?? null,
  };
}
