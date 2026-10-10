import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip-store';

const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint16(at, true);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('zipStore', () => {
  it('writes local headers, a central directory and an end record that agree', () => {
    const zip = zipStore([
      { name: 'manifest.json', data: '{"a":1}' },
      { name: 'server/é.mjs', data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(u32(zip, 0)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(u32(zip, end)).toBe(0x06054b50);
    expect(u16(zip, end + 10)).toBe(2);
    const central = u32(zip, end + 16);
    expect(u32(zip, central)).toBe(0x02014b50);
    // The second entry's offset points at a local header holding its bytes.
    const secondCentral = central + 46 + 'manifest.json'.length;
    const local = u32(zip, secondCentral + 42);
    expect(u32(zip, local)).toBe(0x04034b50);
    const nameLen = u16(zip, local + 26);
    expect(new TextDecoder().decode(zip.slice(local + 30, local + 30 + nameLen))).toBe('server/é.mjs');
    expect([...zip.slice(local + 30 + nameLen, local + 33 + nameLen)]).toEqual([1, 2, 3]);
  });

  it('builds the same bytes twice and refuses a name that climbs out', () => {
    const entries = [{ name: 'a.txt', data: 'hi' }];
    expect(zipStore(entries)).toEqual(zipStore(entries));
    expect(() => zipStore([{ name: '../x', data: '' }])).toThrow(/bad entry name/);
    expect(() => zipStore([{ name: '/x', data: '' }])).toThrow(/bad entry name/);
  });
});
