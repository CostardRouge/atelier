/**
 * The closing slide of a carousel — "here is what made this, go and try it" —
 * laid out as overlay elements plus a QR square.
 *
 * It is edited ONCE for the whole trip and appended to every deck that asks
 * for it. That was the maintainer's call and it is the right one: a signature
 * re-authored per post drifts, and the last slide of a carousel is exactly the
 * kind of thing nobody wants to retype 250 times.
 *
 * It carries no photograph on purpose. Every other slide competes for
 * attention; this one asks for an action, and a flat ground is what makes the
 * QR readable and the sentence unmissable.
 *
 * Pure and DOM-free.
 */

import {
  createTextElement,
  type Anchor,
  type OverlayElement,
} from '../overlay/overlay-types';
import { encodeQr, qrFits, type QrMatrix } from '../lib/qr';
import { charBudget, wrapText } from '../lib/wrap-text';

export interface CtaSlide {
  headline: string;
  body: string;
  /** What the QR encodes and the slide prints. Empty = no QR, no line. */
  url: string;
  showQr: boolean;
  background: string;
  ink: string;
}

export const DEFAULT_CTA: CtaSlide = {
  headline: 'Made with Atelier',
  body: 'Free and open source. Runs in your browser — your photos never leave your machine.',
  url: 'https://costardrouge.github.io/atelier/',
  showQr: true,
  background: '#100f0d',
  ink: '#f4f0e7',
};

/** Where the QR sits, in fractions of the frame. */
export interface QrPlacement {
  /** Left edge and top edge, as fractions of width and height. */
  x: number;
  y: number;
  /** Side length as a fraction of the frame's SHORTER side. */
  sizeFrac: number;
  matrix: QrMatrix;
}

export interface CtaLayout {
  elements: OverlayElement[];
  qr: QrPlacement | null;
  /**
   * Why there is no QR, when the author asked for one — so the editor can say
   * it rather than showing a blank square.
   */
  qrProblem: string | null;
}

/** Sizes as fractions of the shorter side. The QR is the hero, so it is big. */
const HEADLINE = 0.075;
const BODY = 0.04;
const URL = 0.032;
const QR_SIZE = 0.4;

/** Share of the frame's width a line may use, leaving a margin either side. */
const TEXT_WIDTH = 0.84;
/** Line spacing as a multiple of the font size. */
const LINE_HEIGHT = 1.3;

/**
 * Wrap a sentence to the frame, in lines. The engine draws one line per
 * element and never wraps by itself, so a paragraph is several elements.
 */
function wrapForFrame(text: string, sizeFrac: number, aspect: number): string[] {
  // Work in a frame of arbitrary pixel size — only the ratio matters.
  const w = aspect >= 1 ? 1000 : 1000 * aspect;
  const h = aspect >= 1 ? 1000 / aspect : 1000;
  const fontPx = sizeFrac * Math.min(w, h);
  return wrapText(text, charBudget(w * TEXT_WIDTH, fontPx));
}

function line(
  text: string,
  y: number,
  sizeFrac: number,
  color: string,
  anchor: Anchor = 'top-center',
): OverlayElement {
  const el = createTextElement(text);
  el.anchor = anchor;
  el.x = 0.5;
  el.y = y;
  el.sizeFrac = sizeFrac;
  el.color = color;
  // The CTA is not part of the trip's title-style deck: it is a flat card and
  // must stay legible whatever look the badges wear.
  el.legibility = { mode: 'none', color: 'rgba(0,0,0,0)', padFrac: 0 };
  el.styleOverrides = ['color', 'legibility', 'glow'];
  el.glowAmount = 0;
  return el;
}

/**
 * The closing slide for a frame of the given aspect. Lines the author left
 * empty are skipped entirely rather than reserving space.
 */
export function ctaLayout(cta: CtaSlide, aspect: number): CtaLayout {
  const elements: OverlayElement[] = [];
  const toHeight = (frac: number) => frac * Math.min(aspect, 1);

  const headline = wrapForFrame(cta.headline.trim(), HEADLINE, aspect).filter(Boolean);
  const body = wrapForFrame(cta.body.trim(), BODY, aspect).filter(Boolean);
  const url = cta.url.trim();
  const qrSide = toHeight(QR_SIZE);

  let wantQr = cta.showQr && url.length > 0;
  let matrix: QrMatrix | null = null;
  let qrProblem: string | null = null;
  if (wantQr) {
    if (!qrFits(url)) {
      qrProblem = `That link is too long to put in a QR code (${url.length} characters; the limit is 213).`;
      wantQr = false;
    } else {
      matrix = encodeQr(url);
      if (!matrix) {
        qrProblem = 'That link cannot be encoded as a QR code.';
        wantQr = false;
      }
    }
  }

  /** A stacked group of lines: its height, and a writer that places them. */
  const groupHeight = (lines: string[], sizeFrac: number) =>
    lines.length ? toHeight(sizeFrac) * LINE_HEIGHT * lines.length : 0;

  const GAP = 0.045;
  const blockHeight =
    groupHeight(headline, HEADLINE) +
    (headline.length ? GAP : 0) +
    (matrix ? qrSide + GAP : 0) +
    groupHeight(body, BODY) +
    (body.length ? GAP * 0.6 : 0) +
    (url ? toHeight(URL) * LINE_HEIGHT : 0);

  let cursor = 0.5 - blockHeight / 2;

  const place = (lines: string[], sizeFrac: number) => {
    for (const text of lines) {
      elements.push(line(text, cursor, sizeFrac, cta.ink));
      cursor += toHeight(sizeFrac) * LINE_HEIGHT;
    }
  };

  place(headline, HEADLINE);
  if (headline.length) cursor += GAP;

  let qr: QrPlacement | null = null;
  if (matrix) {
    // x is a fraction of the WIDTH, so the square's own width has to be
    // converted back out of the shorter side to centre it.
    const widthFrac = QR_SIZE * Math.min(1 / aspect, 1);
    qr = { x: 0.5 - widthFrac / 2, y: cursor, sizeFrac: QR_SIZE, matrix };
    cursor += qrSide + GAP;
  }

  place(body, BODY);
  if (body.length) cursor += GAP * 0.6;
  if (url) place([url], URL);

  return { elements, qr, qrProblem };
}
