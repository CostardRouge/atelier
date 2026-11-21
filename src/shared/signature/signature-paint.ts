/**
 * The signature PAINTED — one painter for a stage's preview and every export,
 * as vectors and the suite's own faces at the file's size: no image is
 * shipped, so a 4K poster's sticker is as sharp as a phone slide's.
 *
 * Sizes are the lab's (https://claude.ai/artifact/Divt1R8MoTts4c97PTx6cF),
 * read in EMs of 4.2 % of the frame's SHORT side — the same share of a 9:16
 * Reel's width and of a 16:9 film's height, so the mark reads alike on both.
 * The mark is the app icon's own 32-unit drawing (`public/icons/icon.svg`).
 */

import { END_CARD_REST, endCardBeat, signatureParts, type EndCardBeat, type SignCorner, type SignFace, type SignPlace, type SignWords } from './signature';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// What an export CARRIES — fixed, like the pictures it sits on: a file does not turn dark at night.
const PAPER = '#f7f3ea';
const INK = '#1b1813';
const ON_MEDIA = '#f4f0e7';
const NIGHT = '#100f0d';
const VERMILION = '#d9442a';
const VERMILION_INK = '#b2331e';
const VERMILION_NIGHT = '#ef5638';

const SANS = '"Space Grotesk", system-ui, sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** The faces a signature draws in — load them before the first paint (`document.fonts.load`). */
export const SIGNATURE_FONTS = ['400 40px "Space Grotesk"', '700 40px "Space Grotesk"', '400 40px "Instrument Serif"', 'italic 400 40px "Instrument Serif"', '400 40px "JetBrains Mono"', '500 40px "JetBrains Mono"'];

export interface SignaturePaint {
  face: SignFace;
  words: SignWords;
  /** The tool's name as people read it — «Recap», «Flight Atlas». */
  tool: string;
  corner: SignCorner;
  /**
   * The share of the height the social apps cover at the top and the bottom
   * of a 9:16 frame: the mark stays clear of them. Absent elsewhere.
   */
  safe?: { top: number; bottom: number } | null;
  /** Light ink over a dark picture, dark over a light one; absent = read from the pixels under the mark. */
  ink?: 'light' | 'dark';
  /** A size beside the usual one — a small preview tile draws it bigger to stay legible. */
  scale?: number;
  /** Put by hand: the mark's centre as fractions of the frame, kept whole inside it. Wins over `corner` and `safe`. */
  at?: SignPlace | null;
}

/** Where a mark was drawn, in the frame's pixels — what a stage grabs to move it. */
export interface SignatureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a Reel's own interface covers the frame (`RecapStage`'s hatched bands). */
export const REEL_SAFE = { top: 0.12, bottom: 0.16 } as const;

function spaced(g: Ctx, px: number): void {
  // Chrome and Safari's canvases space letters; where one does not, the words are only a little tighter.
  if ('letterSpacing' in g) (g as { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** The mark: four framing corners and the dot, `size` across, each corner `apart` units from home. */
function drawMark(g: Ctx, x: number, y: number, size: number, ink: string, dot: string, beat: Pick<EndCardBeat, 'corners' | 'dot'> = END_CARD_REST): void {
  const k = size / 32;
  const away = (1 - beat.corners) * 9;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.lineWidth = 2.5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = ink;
  g.globalAlpha *= beat.corners;
  const corner = (dx: number, dy: number, path: [number, number][]) => {
    g.beginPath();
    path.forEach(([px, py], i) => (i ? g.lineTo(px + dx * away, py + dy * away) : g.moveTo(px + dx * away, py + dy * away)));
    g.stroke();
  };
  corner(-1, -1, [[6, 11], [6, 6], [11, 6]]);
  corner(1, -1, [[26, 11], [26, 6], [21, 6]]);
  corner(-1, 1, [[6, 21], [6, 26], [11, 26]]);
  corner(1, 1, [[26, 21], [26, 26], [21, 26]]);
  g.restore();
  if (beat.dot > 0) {
    g.save();
    g.fillStyle = dot;
    g.beginPath();
    g.arc(x + size / 2, y + size / 2, 3 * k * beat.dot, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/** A face measured, and how to draw it with its top-left at (x, y). */
interface Laid {
  w: number;
  h: number;
  draw: (x: number, y: number, ink: 'light' | 'dark') => void;
  /** It carries its own ground: no need to read the picture under it. */
  opaque?: boolean;
}

function layLine(g: Ctx, em: number, o: SignaturePaint): Laid {
  const p = signatureParts(o.words, o.tool);
  const parts: { text: string; font: string; alpha: number; before: number }[] = [
    { text: `${p.lead} `, font: `400 ${em}px ${SANS}`, alpha: 1, before: 0 },
    { text: p.name, font: `700 ${em}px ${SANS}`, alpha: 1, before: 0 },
  ];
  if (p.tool) parts.push({ text: ` / ${p.tool}`, font: `italic 400 ${em * 1.18}px ${SERIF}`, alpha: 1, before: 0 });
  if (p.address) parts.push({ text: p.address, font: `400 ${em * 0.62}px ${MONO}`, alpha: 0.8, before: em * 0.7 });
  spaced(g, 0);
  const widths = parts.map((s) => {
    g.font = s.font;
    return g.measureText(s.text).width;
  });
  const mark = em * 1.5;
  const gap = em * 0.4;
  const w = mark + gap + widths.reduce((a, b, i) => a + b + parts[i].before, 0);
  return {
    w,
    h: mark,
    draw: (x, y, ink) => {
      const colour = ink === 'light' ? ON_MEDIA : INK;
      g.save();
      if (ink === 'light') {
        g.shadowColor = 'rgba(0,0,0,0.55)';
        g.shadowBlur = em * 0.12;
        g.shadowOffsetY = em * 0.04;
      }
      drawMark(g, x, y, mark, colour, VERMILION);
      g.fillStyle = colour;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      let at = x + mark + gap;
      parts.forEach((s, i) => {
        at += s.before;
        g.font = s.font;
        g.globalAlpha = s.alpha;
        g.fillText(s.text, at, y + mark / 2 + em * 0.04);
        at += widths[i];
      });
      g.restore();
    },
  };
}

function laySticker(g: Ctx, em: number, o: SignaturePaint): Laid {
  const p = signatureParts(o.words, o.tool);
  const small = (p.address ?? p.lead).toUpperCase();
  const tool = p.tool?.toUpperCase() ?? null;
  const fSmall = `400 ${em * 0.4}px ${MONO}`;
  const fName = `400 ${em * 1.35}px ${SERIF}`;
  const fTool = `500 ${em * 0.46}px ${MONO}`;
  const measure = (text: string, font: string, spacing: number) => {
    g.font = font;
    spaced(g, spacing);
    return g.measureText(text).width;
  };
  const wSmall = measure(small, fSmall, em * 0.4 * 0.16);
  const wName = measure(p.name, fName, 0);
  const wTool = tool ? measure(tool, fTool, em * 0.46 * 0.14) : 0;
  spaced(g, 0);
  const pad = em * 0.16;
  const cell = em * 2.5;
  const words = Math.max(wSmall, wName, wTool);
  const w = pad + cell + em * 0.5 + words + em * 0.55 + pad;
  const h = cell + pad * 2;
  return {
    w,
    h,
    opaque: true,
    draw: (x, y) => {
      g.save();
      // Slightly turned, as a label stuck on the print.
      g.translate(x + w / 2, y + h / 2);
      g.rotate((-3 * Math.PI) / 180);
      g.translate(-w / 2, -h / 2);
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = em * 0.3;
      g.shadowOffsetY = em * 0.08;
      g.fillStyle = PAPER;
      g.beginPath();
      g.roundRect(0, 0, w, h, em * 0.5);
      g.fill();
      g.restore();
      g.fillStyle = VERMILION;
      g.beginPath();
      g.roundRect(pad, pad, cell, cell, em * 0.36);
      g.fill();
      drawMark(g, pad + em * 0.3, pad + em * 0.3, em * 1.9, PAPER, PAPER);
      // The three lines, centred as a block on the cell's height.
      const lines = [em * 0.4, em * 1.35 * 0.9, ...(tool ? [em * 0.46] : [])];
      const gap = em * 0.1;
      const block = lines.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);
      const left = pad + cell + em * 0.5;
      let top = (h - block) / 2;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillStyle = INK;
      g.globalAlpha = 0.7;
      g.font = fSmall;
      spaced(g, em * 0.4 * 0.16);
      g.fillText(small, left, top + lines[0] / 2);
      top += lines[0] + gap;
      g.globalAlpha = 1;
      g.font = fName;
      spaced(g, 0);
      g.fillText(p.name, left, top + lines[1] / 2 + em * 0.06);
      top += lines[1] + gap;
      if (tool) {
        g.fillStyle = VERMILION_INK;
        g.font = fTool;
        spaced(g, em * 0.46 * 0.14);
        g.fillText(tool, left, top + lines[2] / 2);
      }
      spaced(g, 0);
      g.restore();
    },
  };
}

/** Words along a circle: the top arc reads over it, the bottom arc under it, both upright. */
function arcText(g: Ctx, text: string, cx: number, cy: number, r: number, spacing: number, where: 'top' | 'bottom'): void {
  const chars = [...text];
  const widths = chars.map((c) => g.measureText(c).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let run = -total / 2;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  chars.forEach((c, i) => {
    const mid = run + (widths[i] - spacing) / 2;
    const a = where === 'top' ? -Math.PI / 2 + mid / r : Math.PI / 2 - mid / r;
    g.save();
    g.translate(cx + r * Math.cos(a), cy + r * Math.sin(a));
    g.rotate(where === 'top' ? a + Math.PI / 2 : a - Math.PI / 2);
    g.fillText(c, 0, 0);
    g.restore();
    run += widths[i];
  });
}

function layStamp(g: Ctx, em: number, o: SignaturePaint): Laid {
  const p = signatureParts(o.words, o.tool);
  const size = em * 5.6;
  const u = size / 100;
  const top = `${p.lead} ${p.name}`.toUpperCase();
  const bottom = (p.address ?? p.tool ?? p.name).toUpperCase();
  const long = bottom.length > 14;
  return {
    w: size,
    h: size,
    draw: (x, y, ink) => {
      // Vermilion ink on a light ground, as a rubber stamp; cream on a dark one, the dot still vermilion.
      const colour = ink === 'light' ? ON_MEDIA : VERMILION;
      const dot = ink === 'light' ? VERMILION : colour;
      g.save();
      g.translate(x + size / 2, y + size / 2);
      g.rotate((-9 * Math.PI) / 180);
      if (ink === 'light') {
        g.shadowColor = 'rgba(0,0,0,0.5)';
        g.shadowBlur = em * 0.14;
      }
      g.strokeStyle = colour;
      g.fillStyle = colour;
      g.lineWidth = 2 * u;
      g.beginPath();
      g.arc(0, 0, 47.5 * u, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = u;
      g.beginPath();
      g.arc(0, 0, 28.5 * u, 0, Math.PI * 2);
      g.stroke();
      spaced(g, 0);
      g.font = `700 ${7.4 * u}px ${SANS}`;
      arcText(g, top, 0, 0, 34 * u, 1.5 * u, 'top');
      g.font = `700 ${(long ? 5.4 : 7.4) * u}px ${SANS}`;
      arcText(g, bottom, 0, 0, 40.5 * u, (long ? 0.9 : 1.8) * u, 'bottom');
      for (const sx of [-37.5, 37.5]) {
        g.beginPath();
        g.arc(sx * u, 0, 1.3 * u, 0, Math.PI * 2);
        g.fill();
      }
      drawMark(g, -21 * u, -21 * u, 42 * u, colour, dot);
      g.restore();
    },
  };
}

function layCorner(g: Ctx, em: number, o: SignaturePaint): Laid {
  const p = signatureParts(o.words, o.tool);
  const fs = em * 0.62;
  const font = `400 ${fs}px ${MONO}`;
  const head = 'atelier';
  const tail = `${p.tool ? ` / ${p.tool.toLowerCase()}` : ''}${p.address ? ` · ${p.address}` : ''}`;
  g.font = font;
  spaced(g, fs * 0.08);
  const wHead = g.measureText(head).width;
  const wTail = tail ? g.measureText(tail).width : 0;
  spaced(g, 0);
  const bracket = fs * 3.4;
  const gap = fs * 0.35;
  const w = wHead + wTail + gap + bracket;
  const leftSide = o.corner === 'tl' || o.corner === 'bl';
  const topSide = o.corner === 'tl' || o.corner === 'tr';
  return {
    w,
    h: bracket,
    draw: (x, y, ink) => {
      const colour = ink === 'light' ? ON_MEDIA : INK;
      g.save();
      if (ink === 'light') {
        g.shadowColor = 'rgba(0,0,0,0.55)';
        g.shadowBlur = em * 0.12;
      }
      // The bracket holds the frame's own corner: it is drawn for the bottom right and mirrored for the others.
      const bx = leftSide ? x : x + w - bracket;
      g.save();
      g.translate(bx + bracket / 2, y + bracket / 2);
      g.scale(leftSide ? -1 : 1, topSide ? -1 : 1);
      g.translate(-bracket / 2, -bracket / 2);
      const k = bracket / 16;
      g.strokeStyle = colour;
      g.lineWidth = 1.6 * k;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(14.5 * k, 3.5 * k);
      g.lineTo(14.5 * k, 14.5 * k);
      g.lineTo(3.5 * k, 14.5 * k);
      g.stroke();
      g.fillStyle = VERMILION;
      g.beginPath();
      g.arc(8.6 * k, 8.6 * k, 1.7 * k, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.font = font;
      spaced(g, fs * 0.08);
      g.fillStyle = colour;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      const tx = leftSide ? x + bracket + gap : x;
      const ty = topSide ? y + fs * 1.05 : y + bracket - fs * 1.05;
      g.fillText(head, tx, ty);
      if (tail) {
        g.globalAlpha = 0.7;
        g.fillText(tail, tx + wHead, ty);
      }
      spaced(g, 0);
      g.restore();
    },
  };
}

const LAY: Record<SignFace, (g: Ctx, em: number, o: SignaturePaint) => Laid> = { line: layLine, sticker: laySticker, stamp: layStamp, corner: layCorner };

/** Whether the pixels under a box are dark enough to want light ink. Unreadable (a tainted canvas) = dark. */
function darkUnder(g: Ctx, x: number, y: number, w: number, h: number): boolean {
  try {
    const sx = Math.max(0, Math.floor(x));
    const sy = Math.max(0, Math.floor(y));
    const sw = Math.max(1, Math.min(g.canvas.width - sx, Math.ceil(w)));
    const sh = Math.max(1, Math.min(g.canvas.height - sy, Math.ceil(h)));
    const data = g.getImageData(sx, sy, sw, sh).data;
    // One pixel in sixteen is plenty to tell a sky from a page.
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 64) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n += 1;
    }
    return n === 0 || sum / n < 140;
  } catch {
    return true;
  }
}

/**
 * Draw the signature over a frame of `W × H` pixels already painted on `g`
 * (its transform is the frame's: (0, 0) is the frame's top-left corner).
 */
export function paintSignature(g: Ctx, W: number, H: number, o: SignaturePaint): SignatureBox {
  const short = Math.min(W, H);
  const em = short * 0.042 * (o.scale ?? 1);
  g.save();
  const laid = LAY[o.face](g, em, o);
  const inset = short * 0.045;
  let x: number;
  let y: number;
  if (o.at) {
    // By hand: centred where it was dropped, whole inside the frame — a place is the person's, zones included.
    x = Math.max(0, Math.min(W - laid.w, o.at.x * W - laid.w / 2));
    y = Math.max(0, Math.min(H - laid.h, o.at.y * H - laid.h / 2));
  } else {
    const top = o.safe ? H * o.safe.top + short * 0.03 : inset;
    const bottom = o.safe ? H * o.safe.bottom + short * 0.03 : inset;
    x = o.corner === 'tl' || o.corner === 'bl' ? inset : o.corner === 'bc' ? (W - laid.w) / 2 : W - inset - laid.w;
    y = o.corner === 'tl' || o.corner === 'tr' ? top : H - bottom - laid.h;
  }
  const ink = o.ink ?? (laid.opaque ? 'dark' : darkUnder(g, x, y, laid.w, laid.h) ? 'light' : 'dark');
  laid.draw(x, y, ink);
  g.restore();
  return { x, y, w: laid.w, h: laid.h };
}

/** Whether a frame is dark overall — what decides the end card's ground after it. */
export function frameIsDark(g: Ctx, W: number, H: number): boolean {
  return darkUnder(g, 0, 0, W, H);
}

/**
 * The END CARD — a film's last second, `t` seconds in: the corners close in,
 * the dot lands, the words rise (`endCardBeat`). On paper after a light
 * film, on near-black after a dark one. Covers the whole frame.
 */
export function paintEndCard(g: Ctx, W: number, H: number, t: number | null, o: { words: SignWords; tool: string; dark: boolean }): void {
  const beat = t === null ? END_CARD_REST : endCardBeat(t);
  const p = signatureParts(o.words, o.tool);
  // The card is drawn for a 9:16 frame, in hundredths of its width; a wider frame takes the same card at its height.
  const u = Math.min(W, (H * 9) / 16) / 100;
  const ink = o.dark ? ON_MEDIA : INK;
  g.save();
  g.fillStyle = o.dark ? NIGHT : PAPER;
  g.fillRect(0, 0, W, H);
  const lines: { text: string; font: string; height: number; spacing: number; colour: string; alpha: number; before: number; beat: number }[] = [
    { text: p.lead.toUpperCase(), font: `400 ${3.1 * u}px ${MONO}`, height: 3.1 * u, spacing: 3.1 * u * 0.2, colour: ink, alpha: 0.65, before: 2.2 * u, beat: beat.words[0] },
    { text: p.name, font: `400 ${17 * u}px ${SERIF}`, height: 17 * u * 0.9, spacing: 0, colour: ink, alpha: 1, before: 2.2 * u, beat: beat.words[1] },
  ];
  if (p.tool) lines.push({ text: p.tool.toUpperCase(), font: `500 ${3.6 * u}px ${MONO}`, height: 3.6 * u, spacing: 3.6 * u * 0.18, colour: o.dark ? VERMILION_NIGHT : VERMILION_INK, alpha: 1, before: 2.2 * u, beat: beat.words[2] });
  if (p.address) lines.push({ text: p.address, font: `400 ${2.9 * u}px ${MONO}`, height: 2.9 * u, spacing: 0, colour: ink, alpha: 0.55, before: 5.2 * u, beat: beat.words[3] });
  const mark = 30 * u;
  const block = mark + lines.reduce((a, l) => a + l.before + l.height, 0);
  let y = (H - block) / 2;
  drawMark(g, (W - mark) / 2, y, mark, ink, o.dark ? VERMILION_NIGHT : VERMILION, beat);
  y += mark;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of lines) {
    y += l.before;
    if (l.beat > 0) {
      g.font = l.font;
      spaced(g, l.spacing);
      g.fillStyle = l.colour;
      g.globalAlpha = l.alpha * l.beat;
      // A spaced line is centred on its letters, not on the space after its last one.
      g.fillText(l.text, W / 2 + l.spacing / 2, y + l.height / 2 + (1 - l.beat) * 1.5 * u);
    }
    y += l.height;
  }
  spaced(g, 0);
  g.restore();
}
