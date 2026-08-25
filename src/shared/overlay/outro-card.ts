/**
 * The outro — a closing card appended AFTER the last frame of footage.
 *
 * The mirror of the intro, one level simpler: the intro is a scene played
 * OVER the running picture, while the outro is a flat card the export keeps
 * encoding once the footage has run out (`shared/media/export-tail.ts` does
 * the time arithmetic, the export pipelines do the appending). It exists as a
 * Studio feature in its own right — a project is intro · footage · closing
 * card — and Road Trip's call-to-action reaches it as an injection, exactly
 * as the hook reaches the intro (`shared/roadtrip/hook-scene.ts`).
 *
 * The card's content is ordinary overlay elements over a flat ground, plus an
 * optional QR square. Elements keep every engine capability (fonts, glow,
 * animation — windows count from the card's own first frame), but the project
 * THEME does not apply: like Road Trip's closing slide, the card must stay
 * legible whatever look the footage's titles wear, so its elements carry
 * their own styles.
 *
 * The QR is stored as the URL it encodes, never as a matrix: the matrix is
 * derived (deterministically) at render time, so the document stays readable
 * and a changed link cannot drift from its code. A link too long to encode is
 * refused with a sentence, not truncated into a code that scans to half a URL.
 *
 * Pure and DOM-free except `prepareOutro().draw`, which paints a 2D context.
 */

import { encodeQr, qrFits } from '../lib/qr';
import { drawOverlays } from './draw-overlays';
import { drawQr, type QrDraw } from './draw-qr';
import { createTextElement, type OverlayElement } from './overlay-types';

/** The QR square on a card: the link, and where the code sits. */
export interface OutroQr {
  /** What the code encodes and nothing else. Empty = no QR. */
  url: string;
  /** Left edge as a fraction of the WIDTH, top edge as a fraction of the HEIGHT. */
  x: number;
  y: number;
  /** Side as a fraction of the frame's SHORTER side. */
  sizeFrac: number;
  dark: string;
  light: string;
}

export interface OutroCard {
  /** Seconds the card holds after the footage's last frame. */
  seconds: number;
  /** The flat ground under everything. */
  background: string;
  /**
   * Ordinary overlay elements. Windows and animations count from the card's
   * own first frame; the project theme is deliberately NOT applied.
   */
  elements: OverlayElement[];
  qr: OutroQr | null;
}

export const OUTRO_SECONDS_DEFAULT = 4;

/** The ink a seeded card writes with, on the ground it seeds. */
const CARD_BACKGROUND = '#100f0d';
const CARD_INK = '#f4f0e7';

/**
 * One centred line of the card. The same conventions as Road Trip's closing
 * slide: no legibility box and no glow, pinned so no theme can bring them
 * back — the card is a flat ground and its ink must stay its own.
 */
export function outroLine(
  text: string,
  y: number,
  sizeFrac: number,
  color: string = CARD_INK,
): OverlayElement {
  const el = createTextElement(text);
  el.anchor = 'top-center';
  el.x = 0.5;
  el.y = y;
  el.sizeFrac = sizeFrac;
  el.color = color;
  el.legibility = { mode: 'none', color: 'rgba(0,0,0,0)', padFrac: 0 };
  el.styleOverrides = ['color', 'legibility', 'glow'];
  el.glowAmount = 0;
  return el;
}

/** A fresh card: one editable headline, no QR — a starting point, not a look. */
export function createOutroCard(headline: string): OutroCard {
  return {
    seconds: OUTRO_SECONDS_DEFAULT,
    background: CARD_BACKGROUND,
    elements: [outroLine(headline, 0.42, 0.06)],
    qr: null,
  };
}

/**
 * The card with one more line, placed under the lowest text it already holds
 * (or opening the card when it holds none). Free placement is the stage
 * editor's job, later; a stacked column is what a card wants by default.
 */
export function withOutroLine(card: OutroCard, text = 'New line'): OutroCard {
  let bottom = 0.36;
  let size = 0.038;
  for (const el of card.elements) {
    if (el.kind !== 'text') continue;
    if (el.y >= bottom) {
      bottom = el.y;
      size = el.sizeFrac ?? size;
    }
  }
  const line = outroLine(text, Math.min(0.92, bottom + size * 1.6), 0.038);
  return { ...card, elements: [...card.elements, line] };
}

export interface PreparedOutro {
  card: OutroCard;
  /** The encoded code, ready to paint — or null (no URL, or refused). */
  qr: QrDraw | null;
  /** The sentence to show when a QR was asked for and cannot be drawn. */
  qrProblem: string | null;
  /** Paint the whole card at `tSeconds` into the card's own life. */
  draw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    w: number,
    h: number,
    tSeconds: number,
  ): void;
}

/**
 * Resolve a card once (the QR encode is deterministic but not free), then
 * paint it at any size and any moment. Fractions all the way down, so one
 * prepared card serves the panel preview and every export variant alike.
 */
export function prepareOutro(card: OutroCard): PreparedOutro {
  let qr: QrDraw | null = null;
  let qrProblem: string | null = null;
  const url = card.qr?.url.trim() ?? '';
  if (card.qr && url) {
    if (!qrFits(url)) {
      qrProblem = `That link is too long to put in a QR code (${url.length} characters; the limit is 213).`;
    } else {
      const matrix = encodeQr(url);
      if (!matrix) qrProblem = 'That link cannot be encoded as a QR code.';
      else {
        qr = {
          x: card.qr.x,
          y: card.qr.y,
          sizeFrac: card.qr.sizeFrac,
          matrix,
          dark: card.qr.dark,
          light: card.qr.light,
        };
      }
    }
  }
  return {
    card,
    qr,
    qrProblem,
    draw(ctx, w, h, tSeconds) {
      ctx.save();
      ctx.fillStyle = card.background;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      // No cue and no theme, on purpose: the card states nothing measured,
      // and its ink is its own (see the module comment).
      drawOverlays(ctx, card.elements, null, w, h, {
        theme: null,
        timeSeconds: tSeconds,
        originSeconds: 0,
      });
      if (qr) drawQr(ctx, w, h, qr);
    },
  };
}
