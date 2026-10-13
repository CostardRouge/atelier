import { describe, expect, it } from 'vitest';
import { aircraftName, parseMetadata, spaceWords } from './atlas-aircraft';

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const len = 8 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const bytes = (s: string) => new TextEncoder().encode(s);
const qt = (s: string) => {
  const t = bytes(s);
  const h = new Uint8Array(4);
  new DataView(h.buffer).setUint16(0, t.length);
  return new Uint8Array([...h, ...t]);
};

describe('aircraft from MP4 metadata', () => {
  it('reads a QuickTime model, a camera code becoming its aircraft', () => {
    const udta = box('udta', box('©mdl', qt('FC8482')), box('©mak', qt('DJI')));
    expect(aircraftName(parseMetadata([udta]))).toBe('DJI Mini 4 Pro');
  });

  it('keeps an unknown code as the code, and a plain model with its make', () => {
    expect(aircraftName(parseMetadata([box('udta', box('©mdl', qt('FC9999')))]))).toBe('DJI FC9999');
    expect(aircraftName(parseMetadata([box('udta', box('©mdl', qt('Avata2')), box('©mak', qt('DJI')))]))).toBe('DJI Avata 2');
  });

  it('reads Apple keys + ilst', () => {
    const key = (name: string) => box('mdta', bytes(name));
    const keys = box('keys', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), key('com.apple.quicktime.model'));
    const data = box('data', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]), bytes('DJI Air 3'));
    const item = box('\u0000\u0000\u0000\u0001', data);
    const meta = box('meta', box('hdlr', new Uint8Array(24)), keys, box('ilst', item));
    expect(aircraftName(parseMetadata([meta]))).toBe('DJI Air 3');
  });

  it('reads an MP4 meta FullBox with an iTunes ilst', () => {
    const ilst = box('ilst', box('©too', box('data', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]), bytes('DJIMini3Pro'))));
    const meta = box('meta', new Uint8Array(4), box('hdlr', new Uint8Array(24)), ilst);
    expect(aircraftName(parseMetadata([box('udta', meta)]))).toBe('DJI Mini 3 Pro');
  });

  it('says nothing when the file says nothing', () => {
    expect(aircraftName(parseMetadata([box('udta', box('free', new Uint8Array(16)))]))).toBeNull();
    expect(spaceWords('DJIMini4Pro')).toBe('DJI Mini 4 Pro');
  });
});
