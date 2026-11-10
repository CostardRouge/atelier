import { describe, expect, it } from 'vitest';
import { cellDate, readWords } from './recap-cellwords';
import { createRecapDoc, readRecapDoc } from './recap-doc';
import { docOn, familyWords, hasFamily, scopeNames, withWords, withoutSlideWords, wordsOn } from './recap-scope';

describe('a cell’s date', () => {
  it('reads Monday 10 November 2025 in every format; auto and rank print the cell’s own number', () => {
    const day = '2025-11-10';
    expect(['d', 'wd', 'dMon', 'wdMon', 'full'].map((f) => cellDate(day, f as never, '3'))).toEqual(['10', 'Mon 10', '10 Nov', 'Mon 10 Nov', 'Monday 10 November 2025']);
    expect(cellDate(day, 'auto', '10')).toBe('10');
    expect(cellDate(day, 'rank', '3')).toBe('3');
    expect(cellDate(null, 'full', '3')).toBe('3');
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
    // The calendar's day numbers off, the highlights' still on: what he could not do before.
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
  });
});
