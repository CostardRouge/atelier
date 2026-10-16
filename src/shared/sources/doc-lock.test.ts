import { describe, expect, it } from 'vitest';
import { canWrite, lockName, readLockMessage } from './doc-lock';

describe('lockName', () => {
  it('names a document per kind and id', () => {
    expect(lockName('trip', 'a1')).toBe('atelier:doc:trip:a1');
    expect(lockName('roll', 'a1')).not.toBe(lockName('trip', 'a1'));
  });
});

describe('readLockMessage', () => {
  it('reads the four messages', () => {
    expect(readLockMessage({ type: 'saved', name: 'n', updatedAt: 3 })).toEqual({ type: 'saved', name: 'n', updatedAt: 3 });
    expect(readLockMessage({ type: 'yield', name: 'n', asker: 't' })).toEqual({ type: 'yield', name: 'n', asker: 't' });
    expect(readLockMessage({ type: 'yielded', name: 'n', asker: 't' })).toEqual({ type: 'yielded', name: 'n', asker: 't' });
    expect(readLockMessage({ type: 'book', updatedAt: 9 })).toEqual({ type: 'book', updatedAt: 9 });
  });

  it('refuses anything else posted on the channel', () => {
    expect(readLockMessage(null)).toBeNull();
    expect(readLockMessage('saved')).toBeNull();
    expect(readLockMessage({ type: 'saved', name: '', updatedAt: 1 })).toBeNull();
    expect(readLockMessage({ type: 'saved', name: 'n', updatedAt: Number.NaN })).toBeNull();
    expect(readLockMessage({ type: 'yield', name: 'n' })).toBeNull();
    expect(readLockMessage({ type: 'steal', name: 'n' })).toBeNull();
  });
});

describe('canWrite', () => {
  it('lets the editor, a lockless browser and a first answer still out write, never a read-only tab', () => {
    expect(canWrite('editing')).toBe(true);
    expect(canWrite('free')).toBe(true);
    expect(canWrite('asking')).toBe(true);
    expect(canWrite('readonly')).toBe(false);
    expect(canWrite('taking')).toBe(false);
  });
});
