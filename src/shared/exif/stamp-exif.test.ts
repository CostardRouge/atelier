import { describe, expect, it } from 'vitest';
import { buildExifBlock } from './exif-build';
import { readXmpPacket, withExifBlock } from './exif-block';
import { parseExif, type ExifData } from './exif-parser';
import { exifAccountText, exportExifBlock, stampExif } from './stamp-exif';

const me = { creator: 'Steeve Pommier', copyright: '© {year} {creator}. All rights reserved.' };

const delivered = { width: 1920, height: 1440 };

/** A JPEG with no metadata — what a canvas hands over. */
function canvasJpeg() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x07, 0x08, 0xff, 0xd9]);
}

/** A camera JPEG: its EXIF, and a maker note no struct here models. */
function cameraJpeg(exif: ExifData): Uint8Array {
  return withExifBlock(canvasJpeg(), buildExifBlock(exif));
}

/** A DNG: a TIFF stream, so its block cannot be moved — only its fields read. */
function dngHead(exif: ExifData): Uint8Array {
  return buildExifBlock(exif);
}

const capture: ExifData = {
  make: 'DJI',
  model: 'FC8482',
  lensModel: '24mm f/1.7',
  iso: 100,
  exposureTime: 0.005,
  fNumber: 1.7,
  dateTimeOriginal: '2026:07:14 18:32:05',
  gps: { lat: 64.1466, lon: -21.9426 },
  gpsAltitude: 128.4,
  orientation: 6,
  pixelWidth: 8064,
  pixelHeight: 6048,
};

/** What Winnow's row carries: no make, no model, no lens (`exif-from-row.ts`). */
const vouched: ExifData = {
  iso: 100,
  exposureTime: 0.005,
  fNumber: 1.7,
  dateTimeOriginal: '2026:07:14 18:32:05',
  gps: { lat: 64.1466, lon: -21.9426 },
  gpsAltitude: 128.4,
};

describe('exportExifBlock', () => {
  it('copies the original JPEG’s own block, and says so', () => {
    const chosen = exportExifBlock(cameraJpeg(capture), vouched, delivered);
    expect(chosen.account).toBe('block');
    const read = parseExif(chosen.block!.buffer);
    expect(read.make).toBe('DJI');
    expect(read.lensModel).toBe('24mm f/1.7');
    // Corrected on the way: the picture is delivered the way up it was looked at.
    expect(read.orientation).toBe(1);
    expect(read.pixelWidth).toBe(1920);
    expect(read.pixelHeight).toBe(1440);
  });

  it('marks every account as ours, the copied block included', () => {
    // The copied block is the one that had no mark: it was the camera's.
    const copied = exportExifBlock(cameraJpeg({ ...capture, software: 'v01.00.0800' }), null, delivered);
    expect(copied.account).toBe('block');
    expect(parseExif(copied.block!.buffer).software).toBe('Atelier');
    expect(parseExif(exportExifBlock(cameraJpeg(capture), null, delivered).block!.buffer).software).toBe('Atelier');
    expect(parseExif(exportExifBlock(dngHead(capture), null, delivered).block!.buffer).software).toBe('Atelier');
    expect(parseExif(exportExifBlock(null, vouched, delivered).block!.buffer).software).toBe('Atelier');
  });

  it('rebuilds from a RAW’s fields, whose block is the whole file', () => {
    const chosen = exportExifBlock(dngHead(capture), vouched, delivered);
    expect(chosen.account).toBe('fields');
    const read = parseExif(chosen.block!.buffer);
    expect(read.make).toBe('DJI');
    expect(read.gps?.lat).toBeCloseTo(64.1466, 6);
    expect(read.orientation).toBe(1);
    expect(read.pixelWidth).toBe(1920);
  });

  it('lets the original fill what the source does not know, and never the other way round', () => {
    const head = dngHead({ ...capture, iso: 800 });
    const read = parseExif(exportExifBlock(head, { ...vouched, iso: 100 }, delivered).block!.buffer);
    // The file wins on a field both hold; the source is only read where it is silent.
    expect(read.iso).toBe(800);
    expect(read.make).toBe('DJI');
  });

  it('falls back to what the source vouched for when the original is out of reach', () => {
    const chosen = exportExifBlock(null, vouched, delivered);
    expect(chosen.account).toBe('vouched');
    const read = parseExif(chosen.block!.buffer);
    expect(read.gps?.lon).toBeCloseTo(-21.9426, 6);
    expect(read.iso).toBe(100);
    // The poorest account: Winnow's row carries no body.
    expect(read.make).toBeUndefined();
  });

  it('still SIGNS a picture nothing is known about — a block of the signature alone', () => {
    const none = exportExifBlock(null, null, delivered);
    expect(none.account).toBe('none');
    const read = parseExif(none.block!.buffer);
    expect(read.software).toBe('Atelier');
    expect(read.make).toBeUndefined();
    expect(read.gps).toBeUndefined();
    expect(none.xmp).toContain('xmp:CreatorTool="Atelier"');
    expect(exportExifBlock(canvasJpeg(), null, delivered).account).toBe('none');
    expect(exportExifBlock(new Uint8Array(0), {}, delivered).account).toBe('none');
  });

  it('writes no rights until the author has a name', () => {
    const chosen = exportExifBlock(cameraJpeg(capture), null, delivered, { identity: { creator: '  ', copyright: me.copyright } });
    expect(chosen.rights).toEqual({ creator: null, copyright: null });
    expect(parseExif(chosen.block!.buffer).copyright).toBeUndefined();
    expect(chosen.xmp).not.toContain('dc:rights');
  });

  it('signs with the CAPTURE’s year, on every account', () => {
    const author = { identity: me, fallbackYear: 2031 };
    for (const chosen of [
      exportExifBlock(cameraJpeg(capture), null, delivered, author),
      exportExifBlock(dngHead(capture), null, delivered, author),
      exportExifBlock(null, capture, delivered, author),
    ]) {
      const read = parseExif(chosen.block!.buffer);
      expect(read.artist).toBe('Steeve Pommier');
      expect(read.copyright).toBe('© 2026 Steeve Pommier. All rights reserved.');
      expect(chosen.xmp).toContain('<dc:creator><rdf:Seq><rdf:li>Steeve Pommier</rdf:li></rdf:Seq></dc:creator>');
      expect(chosen.xmp).toContain('© 2026 Steeve Pommier. All rights reserved.');
    }
    // No capture time: the export's own year.
    const none = exportExifBlock(null, null, delivered, author);
    expect(parseExif(none.block!.buffer).copyright).toBe('© 2031 Steeve Pommier. All rights reserved.');
  });

  it('writes the author over the camera’s own owner setting, and keeps the maker’s block around it', () => {
    const owned = cameraJpeg({ ...capture, artist: 'CAMERA OWNER', copyright: 'x' });
    const read = parseExif(exportExifBlock(owned, null, delivered, { identity: me }).block!.buffer);
    expect(read.artist).toBe('Steeve Pommier');
    expect(read.copyright).toBe('© 2026 Steeve Pommier. All rights reserved.');
    expect(read.model).toBe('FC8482');
    expect(read.software).toBe('Atelier');
  });
});

describe('exportExifBlock — the picture’s words', () => {
  it('writes the caption as ImageDescription and both words in the XMP, on every account', () => {
    const words = { title: 'Pinnacles', caption: 'Nambung, at dawn — “limestone” & sand' };
    for (const chosen of [
      exportExifBlock(cameraJpeg({ ...capture, imageDescription: 'SONY DSC' }), null, delivered, words),
      exportExifBlock(dngHead(capture), null, delivered, words),
      exportExifBlock(null, null, delivered, words),
    ]) {
      expect(parseExif(chosen.block!.buffer).imageDescription).toBe(words.caption);
      expect(chosen.xmp).toContain('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Pinnacles</rdf:li></rdf:Alt></dc:title>');
      expect(chosen.xmp).toContain('<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Nambung, at dawn — “limestone” &amp; sand</rdf:li></rdf:Alt></dc:description>');
    }
  });

  it('keeps the capture’s own description when the picture has no caption', () => {
    const chosen = exportExifBlock(cameraJpeg({ ...capture, imageDescription: 'from the body' }), null, delivered, { caption: '  ' });
    expect(parseExif(chosen.block!.buffer).imageDescription).toBe('from the body');
    expect(chosen.xmp).not.toContain('dc:description');
  });
});

describe('stampExif', () => {
  it('hands back a JPEG the reader finds the capture in', async () => {
    const chosen = exportExifBlock(cameraJpeg(capture), null, delivered);
    const out = await stampExif(new Blob([canvasJpeg()], { type: 'image/jpeg' }), chosen, delivered);
    const read = parseExif(await out.arrayBuffer());
    expect(read.model).toBe('FC8482');
    expect(read.gps?.lat).toBeCloseTo(64.1466, 6);
    expect(out.type).toBe('image/jpeg');
  });

  it('signs a picture with nothing else to say, in the EXIF and the XMP', async () => {
    const jpeg = new Blob([canvasJpeg()], { type: 'image/jpeg' });
    const out = new Uint8Array(await (await stampExif(jpeg, exportExifBlock(null, null, delivered, { identity: me }), delivered)).arrayBuffer());
    expect(parseExif(out.buffer).software).toBe('Atelier');
    expect(parseExif(out.buffer).artist).toBe('Steeve Pommier');
    const xmp = readXmpPacket(out)!;
    expect(xmp).toContain('xmp:CreatorTool="Atelier"');
    expect(xmp).toContain('<rdf:li>Steeve Pommier</rdf:li>');
  });

  it('rebuilds rather than drops a block no segment could hold', async () => {
    // A copied block can be larger than a JPEG segment; what can be read of it
    // still has to travel.
    const huge = new Uint8Array(70_000);
    huge.set(buildExifBlock(capture), 0);
    const out = await stampExif(
      new Blob([canvasJpeg()], { type: 'image/jpeg' }),
      { block: huge, account: 'block', rights: { creator: null, copyright: null }, caption: null, xmp: '' },
      delivered,
    );
    const read = parseExif(await out.arrayBuffer());
    expect(read.make).toBe('DJI');
    expect(read.gps?.lat).toBeCloseTo(64.1466, 6);
  });
});

describe('exifAccountText', () => {
  it('names each account, so a panel never presents a row as the file’s own', () => {
    expect(exifAccountText('block')).toMatch(/copied whole/);
    expect(exifAccountText('fields')).toMatch(/rebuilt/);
    expect(exifAccountText('vouched')).toMatch(/the source knows/);
    expect(exifAccountText('none')).toMatch(/no camera EXIF/);
  });
});
