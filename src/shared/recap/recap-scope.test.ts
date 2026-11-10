import { describe, expect, it } from 'vitest';
import { cellDate, daysRange, readWords } from './recap-cellwords';
import { createRecapDoc, readRecapDoc, withPictures, withRecap } from './recap-doc';
import { layoutRecap } from './recap-layout';
import { resolveRecap } from './recap-slots';
import { docOn, familyWords, hasFamily, scopeNames, withWords, withoutSlideWords, wordsOn } from './recap-scope';

describe('a cell’s date', () => {
  it('reads Monday 10 November 2025 in every format; auto and rank print the cell’s own number', () => {
    const day = '2025-11-10';
    expect(['d', 'wd', 'dMon', 'wdMon', 'full'].map((f) => cellDate(day, f as never, '3'))).toEqual(['10', 'Mon 10', '10 Nov', 'Mon 10 Nov', 'Monday 10 November 2025']);
    expect(cellDate(day, 'auto', '10')).toBe('10');
    expect(cellDate(day, 'rank', '3')).toBe('3');
    expect(cellDate(null, 'full', '3')).toBe('3');
  });

  it('says a slide’s days as a range', () => {
    const days = ['2025-11-08', '2025-11-03', '2025-11-07'];
    expect(daysRange(days, 'dMon')).toBe('3 – 8 Nov');
    expect(daysRange(days, 'auto')).toBe('3 – 8 Nov');
    expect(daysRange(days, 'wdMon')).toBe('Mon 3 – Sat 8 Nov');
    expect(daysRange(days, 'd')).toBe('3 – 8');
    expect(daysRange(days, 'full')).toBe('Mon 3 Nov – Saturday 8 November 2025');
    expect(daysRange(['2025-10-30', '2025-11-02'], 'dMon')).toBe('30 Oct – 2 Nov');
    expect(daysRange(['2025-11-10'], 'wd')).toBe('Mon 10');
    expect(daysRange([], 'dMon')).toBe('');
  });

  it('reads only the words it knows', () => {
    expect(readWords({ date: 'dMon', numberAt: 'foot', count: true, exifParts: ['iso', 'focal'], gap: 0.1, number: 'yes' })).toEqual({ date: 'dMon', numberAt: 'foot', count: true, exifParts: ['focal', 'iso'] });
    expect(readWords(null)).toEqual({});
  });
});

describe('who a cell setting belongs to', () => {
  it('a NEW month’s highlights say «10 Nov»; a month made before keeps what it printed', () => {
    const fresh = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    expect(fresh.carousel.cells).toEqual({ date: 'dMon' });
    expect(wordsOn(fresh, 'first').date).toBe('auto');
    expect(wordsOn(fresh, 'p:0').date).toBe('dMon');
    const old = JSON.parse(JSON.stringify(fresh));
    delete old.carousel.cells;
    delete old.cells.date;
    const read = readRecapDoc(old, 'local')!;
    expect(read.carousel.cells).toEqual({});
    expect(wordsOn(read, 'p:0')).toBe(read.cells);
    expect(docOn(read, 'p:0')).toBe(read);
  });

  it('merges the first slide’s, the family’s and a slide’s own; a slide’s value equal to its family’s is not kept', () => {
    let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    expect(hasFamily(doc)).toBe(true);
    expect(scopeNames(doc)).toEqual({ first: 'Calendar', family: 'Highlights', slide: 'This slide' });
    doc = withWords(doc, 'first', 'first', { number: false }, 2);
    expect(wordsOn(doc, 'first').number).toBe(false);
    // The calendar's day numbers off, the highlights' still on: what he could not do before — without touching them.
    expect(wordsOn(doc, 'p:1')).toMatchObject({ number: true, date: 'dMon' });
    expect(doc.carousel.cells).toEqual({ date: 'dMon', number: true });
    doc = withWords(doc, 'family', 'p:0', { number: true }, 3);
    expect(wordsOn(doc, 'p:1')).toMatchObject({ number: true, date: 'dMon' });
    doc = withWords(doc, 'slide', 'p:2', { date: 'full', numberAt: 'foot' }, 4);
    expect(wordsOn(doc, 'p:2')).toMatchObject({ number: true, date: 'full', numberAt: 'foot' });
    expect(wordsOn(doc, 'p:1').date).toBe('dMon');
    expect(docOn(doc, 'p:2').cells.date).toBe('full');
    expect(docOn(doc, 'p:2')).toBe(docOn(doc, 'p:2'));
    // Back to «as the highlights» row by row, then whole.
    const same = withWords(doc, 'slide', 'p:2', { date: 'dMon' }, 5);
    expect(same.carousel.slideCells['p:2']).toEqual({ numberAt: 'foot' });
    expect(withoutSlideWords(same, 'p:2', 'numberAt', 6).carousel.slideCells).toEqual({});
    expect(withoutSlideWords(doc, 'p:2', undefined, 6).carousel.slideCells).toEqual({});
    expect(familyWords(doc)).toMatchObject({ number: true, date: 'dMon' });
    // A slide's words survive a reload.
    expect(readRecapDoc(JSON.parse(JSON.stringify(doc)), 'local')!.carousel.slideCells).toEqual({ 'p:2': { date: 'full', numberAt: 'foot' } });
  });

  it('a sheet, a Wrapped, one second a day have no family; a dump calls its scopes Cover and Pictures', () => {
    expect(hasFamily(createRecapDoc('sheets', 'local', { now: 1 }))).toBe(false);
    expect(hasFamily(createRecapDoc('wrapped', 'local', { now: 1 }))).toBe(false);
    const dump = createRecapDoc('dump', 'local', { now: 1 });
    expect(hasFamily(dump)).toBe(true);
    expect(scopeNames(dump)).toMatchObject({ first: 'Cover', family: 'Pictures' });
    expect(hasFamily(createRecapDoc('grid', 'local', { now: 1 }))).toBe(false);
    // With no family, the first slide's words are simply the cells'.
    const grid = createRecapDoc('grid', 'local', { now: 1 });
    expect(withWords(grid, 'first', 'first', { count: true }, 2).carousel.cells).toEqual({});
  });
});

describe('the running head says its slide’s days', () => {
  it('in the slide’s date format, only when asked', () => {
    const pics = Array.from({ length: 30 }, (_, i) => ({ key: `p${i}`, origin: 'local' as const, name: `p${i}.jpg`, kind: 'photo' as const, day: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}`, minute: 600 + i }));
    let doc = withPictures(createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 }), pics);
    doc = withRecap(doc, { carousel: { ...doc.carousel, titles: 'head' } }, 2);
    const run = (d: typeof doc) => layoutRecap(d, resolveRecap(d)).pages[1].parts.find((p) => p.kind === 'text' && p.role === 'running');
    const off = run(doc);
    expect(off && off.kind === 'text' ? off.text : '').toMatch(/^\{?October/);
    expect(off && off.kind === 'text' ? off.text : '').not.toMatch(/Oct ·/);
    const on = run(withRecap(doc, { carousel: { ...doc.carousel, headDates: true } }, 3));
    expect(on && on.kind === 'text' ? on.text : '').toMatch(/^October · \d+ – \d+ Oct · 2\/\d+$/);
  });
});
