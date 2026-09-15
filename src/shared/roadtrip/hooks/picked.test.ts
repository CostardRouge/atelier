import { describe, expect, it } from 'vitest';
import { readCoords, readPicked, sortPicked } from './picked';

const ref = (name: string) => ({ name, size: 10, lastModified: 0 });

describe('readCoords', () => {
  it('reads two finite numbers inside the globe', () => {
    expect(readCoords({ lat: -31.95, lon: 115.86 })).toEqual({ lat: -31.95, lon: 115.86 });
  });

  it('refuses anything else, quietly', () => {
    expect(readCoords(null)).toBeNull();
    expect(readCoords('here')).toBeNull();
    expect(readCoords({ lat: '1', lon: 2 })).toBeNull();
    expect(readCoords({ lat: NaN, lon: 2 })).toBeNull();
    expect(readCoords({ lat: 91, lon: 2 })).toBeNull();
    expect(readCoords({ lat: 1, lon: -181 })).toBeNull();
  });
});

describe('readPicked', () => {
  it('keeps a position that reads, and drops one that does not', () => {
    const list = readPicked([
      { ref: ref('a.jpg'), date: '2025-03-02', takenAt: 5, coords: { lat: 1, lon: 2 } },
      { ref: ref('b.jpg'), date: '2025-03-02', coords: { lat: 'x' } },
      { ref: ref('c.jpg'), date: '2025-03-02' },
    ]);
    expect(list).toEqual([
      { ref: ref('a.jpg'), date: '2025-03-02', takenAt: 5, coords: { lat: 1, lon: 2 } },
      { ref: ref('b.jpg'), date: '2025-03-02' },
      { ref: ref('c.jpg'), date: '2025-03-02' },
    ]);
  });

  it('drops an entry with no day, no ref, or the same picture twice', () => {
    expect(
      readPicked([
        { ref: ref('a.jpg'), date: 'yesterday' },
        { ref: null, date: '2025-03-02' },
        { ref: ref('a.jpg'), date: '2025-03-02' },
        { ref: ref('a.jpg'), date: '2025-03-03' },
        'junk',
      ]),
    ).toEqual([{ ref: ref('a.jpg'), date: '2025-03-02' }]);
    expect(readPicked('all')).toEqual([]);
  });

  it('keeps a ref’s identity and forgets keys it does not know', () => {
    const [one] = readPicked([
      { ref: { ...ref('a.jpg'), assetId: 'host/1', hash: 'h', extra: 1 }, date: '2025-03-02', mood: 'sunny' },
    ]);
    expect(one).toEqual({ ref: { ...ref('a.jpg'), assetId: 'host/1', hash: 'h' }, date: '2025-03-02' });
  });
});

describe('sortPicked', () => {
  it('orders by day, then instant, then name — an unknown instant last', () => {
    const sorted = sortPicked([
      { ref: ref('z.jpg'), date: '2025-03-02' },
      { ref: ref('b.jpg'), date: '2025-03-02', takenAt: 20 },
      { ref: ref('a.jpg'), date: '2025-03-02', takenAt: 10 },
      { ref: ref('early.jpg'), date: '2025-03-01', takenAt: 99 },
    ]);
    expect(sorted.map((p) => p.ref.name)).toEqual(['early.jpg', 'a.jpg', 'b.jpg', 'z.jpg']);
  });
});
