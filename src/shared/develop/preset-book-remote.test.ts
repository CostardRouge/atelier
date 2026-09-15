import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { bookFromWire } from './preset-book-remote';
import { bookToWire, createPresetBook, savePresetInBook } from './preset-book';

describe('bookFromWire', () => {
  it('takes the id and the source from the request, never from the body', () => {
    const book = savePresetInBook(createPresetBook('b1', 10), 'Dusk', { ...DEFAULT_DEVELOP, blacks: -5 }, 'p1', 20);
    const back = bookFromWire({ ...bookToWire(book), id: 'forged', sourceId: 'elsewhere' }, 'b1', 'winnow.example');
    expect(back.id).toBe('b1');
    expect(back.sourceId).toBe('winnow.example');
    expect(back.presets.map((p) => p.name)).toEqual(['Dusk']);
  });

  it('refuses a body that is not a book', () => {
    expect(() => bookFromWire(null, 'b1', 'w')).toThrow(/not a preset book/);
    expect(() => bookFromWire([], 'b1', 'w')).toThrow(/not a preset book/);
    expect(() => bookFromWire({ presets: 'no' }, 'b1', 'w')).toThrow(/not a preset book/);
  });
});
