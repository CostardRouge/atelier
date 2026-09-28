import { describe, expect, it } from 'vitest';
import { createTextElement } from '../overlay/overlay-types';
import { DEFAULT_BADGE_DURATION, DEFAULT_BADGE_LAYOUT } from './badge-layout';
import { createShade } from './shades';
import {
  CHAPTER_MARK_SCALE,
  SLIDE_TEXT_SIZE,
  capacitiesOf,
  chapterMark,
  createSlideText,
  isSlideTextId,
  fullSlideBadge,
  isChapterMark,
  readSlideBadge,
  readSlideHook,
  readSlideShades,
  readSlideTexts,
} from './slide-capacities';
import { defaultPostBadge } from './trip-types';

describe('chapterMark', () => {
  const badge = defaultPostBadge('carousel');

  it('is the piece’s counter at a third of its size, in a corner of its own', () => {
    const mark = chapterMark(badge);
    expect(mark.mode).toBe(badge.mode);
    expect(mark.layout.sizeFrac).toBeCloseTo(badge.layout.sizeFrac * CHAPTER_MARK_SCALE);
    expect(mark.layout.anchor).toBe('top-left');
    expect(mark.durationSeconds).toBe(badge.durationSeconds);
  });

  it('starts computed and says nothing about when', () => {
    const mark = chapterMark({ ...badge, mode: 'stage-day' });
    expect(mark.textOverrides).toEqual({});
    expect(mark.timeAgo).toBe('off');
    expect(mark.mode).toBe('stage-day');
  });

  it('is told apart from a full badge by its size', () => {
    expect(isChapterMark(chapterMark(badge), badge)).toBe(true);
    expect(isChapterMark(fullSlideBadge(badge), badge)).toBe(false);
  });

  it('never shares a layout object with the piece it was seeded from', () => {
    const full = fullSlideBadge(badge);
    full.layout.x = 0.5;
    expect(badge.layout.x).toBe(DEFAULT_BADGE_LAYOUT.x);
  });
});

describe('readSlideHook', () => {
  it('is none for anything that is not a list, and for an empty one', () => {
    expect(readSlideHook(undefined)).toBeNull();
    expect(readSlideHook('map')).toBeNull();
    expect(readSlideHook([])).toBeNull();
    expect(readSlideHook([{ nope: 1 }, 7])).toBeNull();
  });

  it('keeps an id this build does not know, so a newer opener is not lost', () => {
    expect(readSlideHook([{ id: 'future', options: { a: 1 } }])).toEqual([
      { id: 'future', options: { a: 1 } },
    ]);
  });

  it('gives a layer with no options an empty record', () => {
    expect(readSlideHook([{ id: 'map' }])).toEqual([{ id: 'map', options: {} }]);
  });
});

describe('readSlideShades', () => {
  it('is empty for anything that is not a list', () => {
    expect(readSlideShades(null)).toEqual([]);
    expect(readSlideShades({})).toEqual([]);
  });

  it('keeps a stored shade and fills what it predates', () => {
    const stored = { id: 's1', direction: 'top', reach: 0.4, strength: 0.5, color: '#112233' };
    const [shade] = readSlideShades([stored, 'junk']);
    expect(shade.id).toBe('s1');
    expect(shade.direction).toBe('top');
    expect(shade.reach).toBe(0.4);
    expect(shade.invert).toBe(false);
    expect(shade.followHook).toBe(false);
  });

  it('clamps a strength and replaces a missing id', () => {
    const [shade] = readSlideShades([{ strength: 7, reach: 'far' }]);
    expect(shade.strength).toBe(1);
    expect(shade.reach).toBe(createShade().reach);
    expect(typeof shade.id).toBe('string');
    expect(shade.id).not.toBe('');
  });
});

describe('readSlideBadge', () => {
  it('is none for anything that is not a record', () => {
    expect(readSlideBadge(null)).toBeNull();
    expect(readSlideBadge('mark')).toBeNull();
    expect(readSlideBadge([])).toBeNull();
  });

  it('keeps a sound badge exactly', () => {
    const mark = chapterMark(defaultPostBadge('carousel'));
    mark.textOverrides = { label: 'Noon', headline: '12' };
    expect(readSlideBadge(structuredClone(mark))).toEqual(mark);
  });

  it('lands junk in every field on its default, never on a capacity nobody placed', () => {
    const read = readSlideBadge({
      mode: 'everything',
      timeAgo: 'yesterday',
      layout: { anchor: 'somewhere', x: 9, y: -3, sizeFrac: 99 },
      durationSeconds: -1,
      textOverrides: { headline: 12, label: 'Noon', nonsense: 'x' },
    });
    expect(read).not.toBeNull();
    expect(read!.mode).toBe('day');
    expect(read!.timeAgo).toBe('off');
    expect(read!.layout.anchor).toBe('top-left');
    expect(read!.layout.x).toBe(1);
    expect(read!.layout.y).toBe(0);
    expect(read!.layout.sizeFrac).toBeLessThanOrEqual(0.4);
    expect(read!.durationSeconds).toBe(DEFAULT_BADGE_DURATION);
    expect(read!.textOverrides).toEqual({ label: 'Noon' });
  });
});

describe('readSlideTexts', () => {
  it('keeps text elements only', () => {
    const text = createTextElement('Pink Lake, 9am');
    const read = readSlideTexts([text, { kind: 'battery', text: 'x' }, { kind: 'text' }, 3]);
    expect(read).toHaveLength(1);
    expect(read[0]).toEqual(text);
  });

  it('fills a stored text from the element’s own defaults', () => {
    const [el] = readSlideTexts([{ kind: 'text', text: 'Hi', id: 'a', x: 0.3 }]);
    expect(el.id).toBe('a');
    expect(el.x).toBe(0.3);
    expect(el.sizeFrac).toBe(createTextElement('').sizeFrac);
  });

  it('gives a duplicate or a missing id a fresh one — the stage hit-tests by id', () => {
    const read = readSlideTexts([
      { kind: 'text', text: 'a', id: 'same' },
      { kind: 'text', text: 'b', id: 'same' },
      { kind: 'text', text: 'c' },
    ]);
    const ids = read.map((el) => el.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('same');
  });
});

describe('capacitiesOf', () => {
  const bare = { hook: null, badge: null, shades: [], texts: [] };

  it('is empty for a bare slide', () => {
    expect(capacitiesOf(bare)).toEqual({ opener: false, badge: false, shades: false, text: false });
  });

  it('does not count the badge variant as an opener — it draws nothing extra', () => {
    expect(capacitiesOf({ ...bare, hook: [{ id: 'badge', options: {} }] }).opener).toBe(false);
    expect(capacitiesOf({ ...bare, hook: [{ id: 'map', options: {} }] }).opener).toBe(true);
  });

  it('counts a shade only when it darkens something', () => {
    expect(capacitiesOf({ ...bare, shades: [createShade({ enabled: false })] }).shades).toBe(false);
    expect(capacitiesOf({ ...bare, shades: [createShade({ strength: 0 })] }).shades).toBe(false);
    expect(capacitiesOf({ ...bare, shades: [createShade()] }).shades).toBe(true);
  });

  it('counts text only when it says something — the caption included', () => {
    expect(capacitiesOf({ ...bare, texts: [createTextElement('  ')] }).text).toBe(false);
    expect(capacitiesOf({ ...bare, texts: [createTextElement('Noon')] }).text).toBe(true);
    expect(capacitiesOf({ ...bare, caption: 'Pink Lake' }).text).toBe(true);
  });
});

describe('createSlideText', () => {
  it('is a line of text in the middle of the frame, told apart by its id', () => {
    const el = createSlideText('Shark Bay');
    expect(el.kind).toBe('text');
    expect(el.text).toBe('Shark Bay');
    expect([el.anchor, el.x, el.y]).toEqual(['center', 0.5, 0.5]);
    expect(el.sizeFrac).toBe(SLIDE_TEXT_SIZE);
    expect(isSlideTextId(el.id)).toBe(true);
    expect(isSlideTextId('piece:headline')).toBe(false);
    expect(isSlideTextId('caption:0')).toBe(false);
  });

  it('keeps the badge’s glow and panel off it — those are the signature', () => {
    const el = createSlideText();
    expect(el.styleOverrides).toEqual(expect.arrayContaining(['legibility', 'glow']));
    expect(el.glowAmount).toBe(0);
    expect(el.legibility.mode).toBe('shadow');
  });

  it('survives the reader it is stored through', () => {
    const el = createSlideText('Noon');
    expect(readSlideTexts([el])).toEqual([el]);
  });

  it('never gives two lines the same id', () => {
    expect(createSlideText().id).not.toBe(createSlideText().id);
  });
});
