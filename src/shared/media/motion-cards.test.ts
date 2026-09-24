import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING, type Framing } from './framing';
import { MIN_GLIDE_SECONDS, arrivalMarks, framingAt, hasMotion, starterMotion, type FramingMotion } from './framing-motion';
import {
  INSERT_ZOOM,
  MAX_CARDS,
  cardAtNeedle,
  cardLabel,
  cardsMotion,
  insertCard,
  readCards,
  removeCard,
  writeCard,
} from './motion-cards';

const rest: Framing = { ...DEFAULT_FRAMING, scale: 1.4, x: 0.1, y: -0.02 };
const card = (scale: number, x: number, y = 0): Framing => ({ ...DEFAULT_FRAMING, scale, x, y });

describe('readCards', () => {
  it('reads a still picture as its one card, the composition', () => {
    expect(readCards(rest, null, 5)).toEqual({ cards: [rest], holdSeconds: 0 });
    expect(cardLabel(0, 1)).toBe('Composition');
  });

  it('reads one card per run of equal frames, the rest last, and the first pause as the hold', () => {
    const motion: FramingMotion = {
      keys: [
        { at: 0, scale: 2, x: 0.2, y: 0 },
        { at: 0.1, scale: 2, x: 0.2, y: 0 },
        { at: 0.6, scale: 1.4, x: 0.1, y: -0.02 },
      ],
      easing: 'linear',
      start: 'slide',
    };
    const { cards, holdSeconds } = readCards(rest, motion, 5);
    expect(cards.map((c) => c.scale)).toEqual([2, 1.4]);
    expect(cards[1]).toEqual(rest);
    expect(holdSeconds).toBeCloseTo(0.5, 6);
    expect(cardLabel(0, 2)).toBe('Start');
    expect(cardLabel(1, 2)).toBe('End');
    expect(cardLabel(1, 3)).toBe('Stop 2');
  });
});

describe('cardsMotion', () => {
  it('writes one card as no motion, the picture resting on it', () => {
    const out = cardsMotion(rest, null, [card(2, 0.3)], 0.4, 5);
    expect(out).toEqual({ framing: { ...rest, scale: 2, x: 0.3, y: 0 }, motion: null });
  });

  it('round-trips: cards written as keys read back as the same cards and hold', () => {
    const cards = [card(2, 0.3), card(1.2, -0.1, 0.05), rest];
    const out = cardsMotion(rest, null, cards, 0.4, 5)!;
    expect(hasMotion(out.motion)).toBe(true);
    expect(out.framing).toEqual(rest);
    const back = readCards(out.framing, out.motion, 5);
    expect(back.cards).toEqual(cards);
    expect(back.holdSeconds).toBeCloseTo(0.4, 6);
    // Three arrivals, the first at 0, the last before the end of the span by its pause.
    const arrivals = arrivalMarks(out.framing, out.motion, 5);
    expect(arrivals).toHaveLength(3);
    expect(arrivals[0]).toBe(0);
    expect(arrivals[2]).toBeCloseTo(5 - 0.4, 6);
  });

  it('shares the glides by how far the view travels, the zoom counting for a pan', () => {
    // A long pan then a short one at the same zoom: the first hop takes longer.
    const out = cardsMotion(rest, null, [card(2, 0.4), card(2, 0), card(2, -0.1)], 0, 4)!;
    const [a, b, c] = arrivalMarks(out.framing, out.motion, 4);
    expect(b - a).toBeGreaterThan(c - b);
    expect((b - a) / (c - b)).toBeCloseTo(0.4 / 0.1, 1);
    // A push in with no pan still takes time.
    const push = cardsMotion(rest, null, [card(1, 0), card(2, 0)], 0, 4)!;
    expect(arrivalMarks(push.framing, push.motion, 4)).toEqual([0, 4]);
    expect(framingAt(push.framing, push.motion, 2, 4).scale).toBeGreaterThan(1);
  });

  it('shrinks the pauses before the glides drop under their floor', () => {
    const cards = [card(2, 0.3), card(2, 0), card(2, -0.3), rest];
    const out = cardsMotion(rest, null, cards, 2, 1)!;
    // Four cards asked for 2 s of pause each on a 1 s slide: the hold gives
    // way, and the glides keep at least their floor between them.
    const back = readCards(out.framing, out.motion, 1);
    expect(back.holdSeconds).toBeLessThan(0.01);
    const arrivals = arrivalMarks(out.framing, out.motion, 1);
    const glides = arrivals[arrivals.length - 1] - arrivals[0];
    expect(glides).toBeGreaterThanOrEqual(3 * Math.min(MIN_GLIDE_SECONDS, 1 / 3) - 1e-6);
  });

  it('keeps the easing and the start of the motion it rewrites', () => {
    const motion: FramingMotion = { keys: [{ at: 0, scale: 2, x: 0, y: 0 }], easing: 'steps', steps: 4, start: 'after-opener' };
    const out = cardsMotion(rest, motion, [card(2, 0), rest], 0, 5)!;
    expect(out.motion).toMatchObject({ easing: 'steps', steps: 4, start: 'after-opener' });
  });
});

describe('writeCard', () => {
  const motion = cardsMotion(rest, null, [card(2, 0.3), card(1.2, -0.1), rest], 0.4, 5)!.motion!;

  it('reframes one card at the instants it already has', () => {
    const out = writeCard(rest, motion, 1, card(3, 0.05, 0.02));
    expect(out.motion!.keys.map((k) => k.at)).toEqual(motion.keys.map((k) => k.at));
    const back = readCards(out.framing, out.motion, 5);
    expect(back.cards[1]).toEqual(card(3, 0.05, 0.02));
    expect(back.cards[0]).toEqual(card(2, 0.3));
    expect(out.framing).toEqual(rest);
  });

  it('writes the last card into the framing, its pause included', () => {
    const next = { ...rest, scale: 1.1, x: 0, y: 0 };
    const out = writeCard(rest, motion, 2, next);
    expect(out.framing).toEqual(next);
    expect(readCards(out.framing, out.motion, 5).cards).toHaveLength(3);
    expect(readCards(out.framing, out.motion, 5).holdSeconds).toBeCloseTo(0.4, 6);
  });

  it('sends rotation, mirror and fit to the rest whichever card is written', () => {
    const out = writeCard(rest, motion, 0, { ...card(2, 0.3), rotation: 12, flipX: true });
    expect(out.framing.rotation).toBe(12);
    expect(out.framing.flipX).toBe(true);
    expect(out.framing.scale).toBe(rest.scale);
  });

  it('is the plain write on a still picture, and writes nothing past the row', () => {
    const next = card(2, 0.3);
    expect(writeCard(rest, null, 0, next)).toEqual({ framing: next, motion: null });
    expect(writeCard(rest, motion, 9, next)).toEqual({ framing: rest, motion });
  });
});

describe('insertCard / removeCard', () => {
  const cards = [card(2, 0.3), rest];
  const motion = cardsMotion(rest, null, cards, 0, 5)!.motion;

  it('adds a card after the selected one, a touch closer so it reads as its own', () => {
    const out = insertCard(rest, motion, cards, 0, 5, 0)!;
    expect(out.selected).toBe(1);
    const back = readCards(out.framing, out.motion, 5);
    expect(back.cards).toHaveLength(3);
    expect(back.cards[1].scale).toBeCloseTo(2 * INSERT_ZOOM, 6);
    expect(back.cards[1].x / back.cards[1].scale).toBeCloseTo(0.3 / 2, 6);
    expect(back.cards[2]).toEqual(rest);
  });

  it('adds before the rest when the rest is selected, and the rest stays last', () => {
    const out = insertCard(rest, motion, cards, 0, 5, 1)!;
    expect(out.selected).toBe(1);
    expect(out.framing).toEqual(rest);
    expect(readCards(out.framing, out.motion, 5).cards).toHaveLength(3);
  });

  it('pulls out instead when the card is already as close as it goes', () => {
    const close = [card(8, 0), rest];
    const out = insertCard(rest, cardsMotion(rest, null, close, 0, 5)!.motion, close, 0, 5, 0)!;
    expect(readCards(out.framing, out.motion, 5).cards[1].scale).toBeCloseTo(8 / INSERT_ZOOM, 6);
  });

  it('refuses a ninth card', () => {
    const many = Array.from({ length: MAX_CARDS }, (_, i) => card(1 + i * 0.1, 0));
    expect(insertCard(rest, null, many, 0, 5, 0)).toBeNull();
  });

  it('takes a card off, never the last, and the last one off leaves no motion', () => {
    const three = [card(2, 0.3), card(1.2, -0.1), rest];
    const m3 = cardsMotion(rest, null, three, 0, 5)!.motion;
    const out = removeCard(rest, m3, three, 0, 5, 1)!;
    expect(readCards(out.framing, out.motion, 5).cards).toEqual([card(2, 0.3), rest]);
    expect(out.selected).toBe(1);
    expect(removeCard(rest, m3, three, 0, 5, 2)).toBeNull();
    const last = removeCard(rest, motion, cards, 0, 5, 0)!;
    expect(last.motion).toBeNull();
    expect(last.framing).toEqual(rest);
    expect(last.selected).toBe(0);
  });
});

describe('cardAtNeedle', () => {
  it('finds the card whose arrival is within the snap, the last owning the end of the slide', () => {
    const arrivals = [0, 2, 4.6];
    expect(cardAtNeedle(arrivals, 0.1, 0.15)).toBe(0);
    expect(cardAtNeedle(arrivals, 1, 0.15)).toBeNull();
    expect(cardAtNeedle(arrivals, 2.1, 0.15)).toBe(1);
    expect(cardAtNeedle(arrivals, 4.5, 0.15)).toBe(2);
    expect(cardAtNeedle(arrivals, 5, 0.15)).toBe(2);
    expect(cardAtNeedle([], 1, 0.15)).toBeNull();
  });

  it('agrees with the starter: its two cards sit at the two ends', () => {
    const m = starterMotion(rest);
    const arrivals = arrivalMarks(rest, m, 5);
    expect(cardAtNeedle(arrivals, 0, 0.15)).toBe(0);
    expect(cardAtNeedle(arrivals, 5, 0.15)).toBe(1);
  });
});
