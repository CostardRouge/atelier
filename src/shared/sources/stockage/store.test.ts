import { describe, expect, it } from 'vitest';
import { bucketHolds } from '../winnow/client';
import { ASSUMED_SHEET, readSheet } from './store';

describe('the storage as a document source', () => {
  it('keeps every kind, where a Winnow keeps the kinds it lists', () => {
    expect(bucketHolds(ASSUMED_SHEET, 'mosaic')).toBe(true);
    expect(bucketHolds({ documents: { bucket: true, kinds: ['trip'] } }, 'mosaic')).toBe(false);
    expect(bucketHolds({ documents: { bucket: true } }, 'project')).toBe(true);
  });

  it('reads the sheet the storage answers, and refuses one with no document bucket', () => {
    const sheet = readSheet({
      service: 'stockage',
      version: '0.1.0',
      documents: { bucket: true, kinds: null, openKinds: true, maxBytes: 100, summaries: true },
      files: { bucket: true, maxBytes: 90 },
    });
    expect(sheet).toMatchObject({ version: '0.1.0', documents: { openKinds: true, maxBytes: 100, summaries: true }, files: { bucket: true } });
    expect(readSheet({ documents: { kinds: null, openKinds: true } })).toBeNull();
  });
});
