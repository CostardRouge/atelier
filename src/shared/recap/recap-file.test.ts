import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures } from './recap-doc';
import { parseRecapFile, recapFileName, serializeRecapFile, toRecapFile } from './recap-file';
import { readRecapSummary, recapSummary, summaryCard } from './recap-summary';

describe('recap file', () => {
  const doc = withPictures(createRecapDoc('month', 'local', { anchor: '2026-10-01', title: 'October 2026', now: 5 }), [
    { key: 'w:winnow.example:4', origin: 'winnow', instance: 'winnow.example', asset: 4, name: 'a.jpg', kind: 'photo', day: '2026-10-03' },
  ]);

  it('goes to disk and comes back as a NEW recap of the importing source', () => {
    const text = serializeRecapFile(toRecapFile([doc], 0));
    expect(text).not.toContain('"sourceId"');
    const parsed = parseRecapFile(text, 'winnow.example', 99);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recaps).toHaveLength(1);
    const back = parsed.recaps[0];
    expect(back.id).not.toBe(doc.id);
    expect(back.sourceId).toBe('winnow.example');
    expect(back.pictures).toEqual(doc.pictures);
    expect(back.anchor).toBe('2026-10-01');
  });

  it('refuses what is not a recap file', () => {
    expect(parseRecapFile('nope', 'local')).toEqual({ ok: false, error: expect.stringContaining('not JSON') });
    expect(parseRecapFile('{"kind":"atelier/mosaic"}', 'local')).toEqual({ ok: false, error: 'This is not a Recap file.' });
    expect(parseRecapFile('{"kind":"atelier/recap","version":99}', 'local').ok).toBe(false);
    expect(parseRecapFile('{"kind":"atelier/recap","recaps":[1]}', 'local').ok).toBe(false);
    expect(recapFileName('Octobre — été 2026')).toBe('octobre-ete-2026.recap.json');
  });

  it('lists a recap by its summary card', () => {
    const s = readRecapSummary(JSON.parse(JSON.stringify(recapSummary(doc))))!;
    expect(s).toEqual({ title: 'October 2026', template: 'month', anchor: '2026-10-01', createdAt: 5, updatedAt: doc.updatedAt, pictures: 1 });
    const card = summaryCard('id-1', 'winnow.example', s);
    expect(card.id).toBe('id-1');
    expect(card.pictures).toEqual([]);
    expect(card.title).toBe('October 2026');
    expect(readRecapSummary({ title: 3 })).toBeNull();
  });
});
