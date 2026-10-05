import { describe, expect, it } from 'vitest';
import { readPngSamples, unfilterRows } from './png-read';
import { crc32, encodePng16, filterRows16, pngChunkTypes } from './png-write';

function ramp(width: number, height: number): Uint16Array {
  const rgb = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      rgb[i] = Math.round((x / (width - 1)) * 65535);
      rgb[i + 1] = Math.round((y / (height - 1)) * 65535);
      rgb[i + 2] = (x * 977 + y * 331) % 65536;
    }
  }
  return rgb;
}

describe('crc32', () => {
  it('is the PNG polynomial', () => {
    // The CRC of "IEND" with no data is the one every PNG ends with.
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
});

describe('filterRows16', () => {
  it('is undone by png-read’s unfilterRows, byte for byte', () => {
    const width = 7;
    const height = 5;
    const rgb = ramp(width, height);
    const filtered = filterRows16(rgb, width, height);
    const stride = width * 6;
    const back = new Uint8Array(height * stride);
    unfilterRows(filtered, back, height, stride, 6);
    const view = new DataView(back.buffer);
    for (let i = 0; i < width * height * 3; i += 1) expect(view.getUint16(i * 2)).toBe(rgb[i]);
  });
});

describe('encodePng16', () => {
  it('writes a 16-bit RGB PNG that reads back sample for sample, with its chunks in order', async () => {
    const width = 33;
    const height = 21;
    const rgb = ramp(width, height);
    const exif = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0]);
    const icc = new Uint8Array(64).fill(7);
    const bytes = await encodePng16(rgb, width, height, { exif, xmp: '<x:xmpmeta/>', icc });
    expect(pngChunkTypes(bytes)).toEqual(['IHDR', 'iCCP', 'eXIf', 'iTXt', 'IDAT', 'IEND']);
    const read = await readPngSamples(bytes);
    expect(read.bitDepth).toBe(16);
    expect(read.channels).toBe(3);
    expect(read.width).toBe(width);
    expect(read.height).toBe(height);
    for (let i = 0; i < rgb.length; i += 1) {
      if (read.data[i] !== rgb[i]) throw new Error(`sample ${i}: ${read.data[i]} ≠ ${rgb[i]}`);
    }
    // The eXIf chunk is the block verbatim.
    const at = bytes.indexOf(0x65, 8);
    expect(String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])).toBe('eXIf');
    expect(Array.from(bytes.subarray(at + 4, at + 4 + exif.length))).toEqual(Array.from(exif));
  });

  it('leaves out the chunks it is not given', async () => {
    const bytes = await encodePng16(ramp(4, 4), 4, 4);
    expect(pngChunkTypes(bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('refuses a picture with no pixels', async () => {
    await expect(encodePng16(new Uint16Array(0), 0, 0)).rejects.toThrow();
  });
});
