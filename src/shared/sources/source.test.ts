import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_ID,
  LOCAL_SOURCE,
  groupBySource,
  listSources,
  sourceById,
} from './source';

describe('the source registry', () => {
  it('holds exactly the local source today', () => {
    expect(listSources()).toEqual([LOCAL_SOURCE]);
  });

  it('resolves the local id and refuses an unknown one', () => {
    expect(sourceById('local')).toBe(LOCAL_SOURCE);
    expect(sourceById('winnow.steeve.website')).toBeNull();
  });

  it('documents written before sourceId existed belong to this browser', () => {
    expect(DEFAULT_SOURCE_ID).toBe('local');
  });

  it('local answers honestly: media and documents yes, scheduling no', () => {
    // A browser tab cannot run reminders; false here is what keeps the UI
    // from offering a button that would not work (bridge §3.5).
    expect(LOCAL_SOURCE.capabilities).toEqual({
      media: true,
      documents: true,
      scheduling: false,
    });
  });
});

describe('groupBySource', () => {
  it('keeps the local group even when it is empty, and local always leads', () => {
    const groups = groupBySource([{ sourceId: 'winnow.steeve.website' }]);
    expect(groups.map((g) => g.id)).toEqual(['local', 'winnow.steeve.website']);
    expect(groups[0].items).toEqual([]);
  });

  it('files a document with no sourceId under this browser', () => {
    const groups = groupBySource([{}, { sourceId: 'local' }]);
    expect(groups).toEqual([{ id: 'local', items: [{}, { sourceId: 'local' }] }]);
  });

  it('never hides an unknown source — its documents get their own group', () => {
    const docs = [{ sourceId: 'local' }, { sourceId: 'mika.dm-consulting.tech' }];
    const groups = groupBySource(docs);
    expect(groups.map((g) => g.id)).toEqual(['local', 'mika.dm-consulting.tech']);
  });

  it('keeps first-seen order among remote sources', () => {
    const groups = groupBySource([
      { sourceId: 'b.example' },
      { sourceId: 'a.example' },
      { sourceId: 'b.example' },
    ]);
    expect(groups.map((g) => g.id)).toEqual(['local', 'b.example', 'a.example']);
    expect(groups[1].items).toHaveLength(2);
  });
});
