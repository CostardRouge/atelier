import { describe, expect, it } from 'vitest';
import { GRID_BYTES, encodeGrid } from '../../shared/mosaic/measure';
import { MOSAIC_DOC_VERSION, createMosaicDoc, withTiles } from '../../shared/mosaic/mosaic-doc';
import { MOSAIC_FILE_KIND, backupFileName, mosaicFileName, parseMosaicFile, serializeMosaicFile, toMosaicFile } from './mosaic-file';

const grid = encodeGrid(new Uint8Array(GRID_BYTES).fill(3));

describe('mosaic file', () => {
  const doc = { ...withTiles(createMosaicDoc('Sydney 2025', 'src-a', 1000), [{ id: 1, kind: 'photo', grid }, { id: 2, kind: 'clip' }], 2000), target: 1 };

  it('round-trips a mosaic with a fresh id, the importing source and today’s dates', () => {
    const text = serializeMosaicFile(toMosaicFile([doc], 5000));
    const file = JSON.parse(text);
    expect(file.kind).toBe(MOSAIC_FILE_KIND);
    expect(file.version).toBe(MOSAIC_DOC_VERSION);
    expect(file.mosaics[0].sourceId).toBeUndefined();
    const parsed = parseMosaicFile(text, 'src-b', 9000);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [back] = parsed.mosaics;
    expect(back.id).not.toBe(doc.id);
    expect(back.sourceId).toBe('src-b');
    expect(back.createdAt).toBe(9000);
    expect(back.title).toBe('Sydney 2025');
    expect(back.tiles).toEqual(doc.tiles);
    expect(back.target).toBe(1);
    expect(back.settings).toEqual(doc.settings);
    const again = parseMosaicFile(text, 'src-b', 9000);
    expect(again.ok && again.mosaics[0].id).not.toBe(back.id);
  });

  it('refuses what is not a mosaic file, and a newer one', () => {
    expect(parseMosaicFile('not json', 's')).toMatchObject({ ok: false });
    expect(parseMosaicFile('{"kind":"atelier/flight-atlas"}', 's')).toMatchObject({ ok: false, error: 'This is not a Mosaic file.' });
    expect(parseMosaicFile(JSON.stringify({ kind: MOSAIC_FILE_KIND, version: MOSAIC_DOC_VERSION + 1, mosaics: [] }), 's').ok).toBe(false);
    expect(parseMosaicFile(JSON.stringify({ kind: MOSAIC_FILE_KIND, mosaics: [{ title: 'no id but fine' }, 5] }), 's')).toMatchObject({ ok: true });
    expect(parseMosaicFile(JSON.stringify({ kind: MOSAIC_FILE_KIND, mosaics: [] }), 's')).toMatchObject({ ok: false });
  });

  it('names the file after the title', () => {
    expect(mosaicFileName('Été à Sydney 2025!')).toBe('ete-a-sydney-2025.mosaic.json');
    expect(mosaicFileName('   ')).toBe('mosaic.mosaic.json');
    expect(backupFileName(Date.UTC(2026, 9, 31))).toBe('atelier-mosaic-2026-10-31.mosaic.json');
  });
});
